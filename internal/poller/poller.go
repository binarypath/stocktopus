package poller

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"log/slog"
	"strings"
	"sync"
	"time"

	"stocktopus/internal/hub"
	"stocktopus/internal/model"
	"stocktopus/internal/provider"
)

type Poller struct {
	provider provider.StockProvider
	hub      *hub.Hub
	logger   *slog.Logger
	interval time.Duration
	tmpl     *template.Template

	symbols map[string]int // symbol -> ref count
	mu      sync.RWMutex
	cancel  context.CancelFunc
}

func New(p provider.StockProvider, h *hub.Hub, interval time.Duration, logger *slog.Logger) *Poller {
	tmpl := template.Must(template.New("quote_row").Parse(quoteRowTemplate))

	poller := &Poller{
		provider: p,
		hub:      h,
		logger:   logger.With("component", "poller"),
		interval: interval,
		tmpl:     tmpl,
		symbols:  make(map[string]int),
	}

	h.SetSubscriptionHandler(poller)
	return poller
}

// OnFirstSubscribe is called by the hub when a topic gets its first subscriber.
func (p *Poller) OnFirstSubscribe(topic string) {
	symbol := topicToSymbol(topic)
	if symbol == "" {
		return
	}

	p.mu.Lock()
	p.symbols[symbol]++
	p.mu.Unlock()

	p.logger.Info("watching symbol", "symbol", symbol)

	// Fetch immediately for the new subscriber
	go p.fetchAndPublish(context.Background(), []string{symbol})
}

// OnLastUnsubscribe is called by the hub when a topic loses its last subscriber.
func (p *Poller) OnLastUnsubscribe(topic string) {
	symbol := topicToSymbol(topic)
	if symbol == "" {
		return
	}

	p.mu.Lock()
	delete(p.symbols, symbol)
	p.mu.Unlock()

	p.logger.Info("unwatching symbol", "symbol", symbol)
}

// Run starts the polling loop.
func (p *Poller) Run(ctx context.Context) {
	ctx, p.cancel = context.WithCancel(ctx)
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	p.logger.Info("poller started", "interval", p.interval)

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("poller stopped")
			return
		case <-ticker.C:
			symbols := p.activeSymbols()
			if len(symbols) == 0 {
				continue
			}
			p.fetchAndPublish(ctx, symbols)
		}
	}
}

func (p *Poller) activeSymbols() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	symbols := make([]string, 0, len(p.symbols))
	for s := range p.symbols {
		symbols = append(symbols, s)
	}
	return symbols
}

func (p *Poller) fetchAndPublish(ctx context.Context, symbols []string) {
	quotes, err := p.provider.GetQuotes(ctx, symbols)
	if err != nil {
		p.logger.Error("fetch failed", "error", err, "symbols", symbols)
		return
	}

	for _, q := range quotes {
		html, err := p.renderQuoteRow(q)
		if err != nil {
			p.logger.Error("render failed", "symbol", q.Symbol, "error", err)
			continue
		}
		p.hub.PublishHTML("quote:"+q.Symbol, html)
	}
}

func (p *Poller) renderQuoteRow(q *model.Quote) (string, error) {
	data := quoteRowData{
		Symbol:        q.Symbol,
		Price:         fmt.Sprintf("%.2f", q.Price),
		Change:        fmt.Sprintf("%+.2f", q.Change),
		ChangePercent: fmt.Sprintf("%+.2f%%", q.ChangePercent*100),
		Volume:        formatVolume(q.Volume),
		Updated:       q.Timestamp.Format("15:04:05"),
		PriceClass:    priceClass(q.Change),
	}

	var buf bytes.Buffer
	if err := p.tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

type quoteRowData struct {
	Symbol        string
	Price         string
	Change        string
	ChangePercent string
	Volume        string
	Updated       string
	PriceClass    string
}

const quoteRowTemplate = `<tr id="quote-{{.Symbol}}" hx-swap-oob="true"><td><a href="/stock/{{.Symbol}}">{{.Symbol}}</a></td><td class="{{.PriceClass}}">{{.Price}}</td><td class="{{.PriceClass}}">{{.Change}}</td><td class="{{.PriceClass}}">{{.ChangePercent}}</td><td>{{.Volume}}</td><td>{{.Updated}}</td></tr>`

func topicToSymbol(topic string) string {
	if strings.HasPrefix(topic, "quote:") {
		return strings.TrimPrefix(topic, "quote:")
	}
	return ""
}

func priceClass(change float64) string {
	switch {
	case change > 0:
		return "price-up"
	case change < 0:
		return "price-down"
	default:
		return "price-flat"
	}
}

func formatVolume(v int64) string {
	switch {
	case v >= 1_000_000_000:
		return fmt.Sprintf("%.1fB", float64(v)/1_000_000_000)
	case v >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(v)/1_000_000)
	case v >= 1_000:
		return fmt.Sprintf("%.1fK", float64(v)/1_000)
	default:
		return fmt.Sprintf("%d", v)
	}
}
