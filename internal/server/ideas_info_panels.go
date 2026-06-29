package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"stocktopus/internal/model"
	"stocktopus/internal/news"
)

// CompanyInfoPanel is one row in the response of GET /api/sketches/{id}/info-panels.
// It carries everything the ideas UI needs to render one company's info card:
// live quote, news pulse, and which of the company's metrics are pinned on this
// sketch (for the metric-chip strip).
type CompanyInfoPanel struct {
	Symbol           string   `json:"symbol"`
	CompanyName      string   `json:"companyName"`
	Price            float64  `json:"price"`
	PreviousClose    float64  `json:"previousClose"`
	ChangePercentage float64  `json:"changePercentage"`
	DayHigh          float64  `json:"dayHigh"`
	DayLow           float64  `json:"dayLow"`
	Volume           float64  `json:"volume"`
	Open             float64  `json:"open"`
	HasPreMarket     bool     `json:"hasPreMarket"`
	PreMarketPrice   float64  `json:"preMarketPrice"`
	PreMarketChange  float64  `json:"preMarketChange"`
	NewsCount24h     int      `json:"newsCount24h"`
	PinnedMetrics    []string `json:"pinnedMetrics"`
}

// handleSketchInfoPanels: GET /api/sketches/{id}/info-panels
//
// Walks the sketch's metrics, groups by companyPrefix(), and returns one panel
// per unique equity symbol. Non-equity metrics (commodities, forex, crypto,
// indices) are skipped — they're charted but don't get a company card.
//
// For each company we batch-quote and fetch news in parallel. News count is
// computed from the last 24h of stock-category news filtered to the symbol.
func (s *Server) handleSketchInfoPanels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil || s.news == nil {
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}
	sketchID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	sk, err := s.store.GetSketch(sketchID)
	if err != nil {
		http.Error(w, "sketch not found", http.StatusNotFound)
		return
	}

	// Group metrics by company prefix, preserving first-seen order so panels
	// render in the same order metrics were pinned.
	type group struct {
		symbol  string
		metrics []string
	}
	var ordered []*group
	bySymbol := make(map[string]*group)
	for _, m := range sk.Metrics {
		prefix := companyPrefix(m.Kind, m.Identifier)
		if prefix == "" {
			continue
		}
		g, ok := bySymbol[prefix]
		if !ok {
			g = &group{symbol: prefix}
			bySymbol[prefix] = g
			ordered = append(ordered, g)
		}
		g.metrics = append(g.metrics, m.Identifier)
	}
	if len(ordered) == 0 {
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}

	// Batch-quote all companies in one shot — same pattern as the screener.
	symbols := make([]string, len(ordered))
	for i, g := range ordered {
		symbols[i] = g.symbol
	}
	ctx := r.Context()
	quotes, err := s.batchQuotes(ctx, symbols)
	if err != nil {
		s.logger.Error("info-panels: batch-quote", "error", err)
		http.Error(w, "quote fetch failed", http.StatusBadGateway)
		return
	}

	// Parallel news fetches + company-name lookups. Fan out per symbol so we
	// don't serialise N FMP round-trips. Wrap each call with the request
	// context so the client disconnecting cancels the in-flight work.
	type enrichment struct {
		companyName  string
		newsCount24h int
		preMarket    model.PreMarket
	}
	enrichments := make(map[string]enrichment, len(symbols))
	var mu sync.Mutex
	var wg sync.WaitGroup
	since := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	until := time.Now().UTC().Format("2006-01-02")

	for _, sym := range symbols {
		sym := sym
		wg.Add(1)
		go func() {
			defer wg.Done()
			var en enrichment
			items, ierr := s.news.GetNewsWithDates(ctx, news.Stock, sym, 0, 50, since, until)
			if ierr == nil {
				en.newsCount24h = len(items)
			}
			if q, ok := quotes[sym]; ok {
				en.companyName = q.Name
				// Derive pre-market price/% from intraday 5-min bars; FMP's
				// /stable/quote carries no pre-market data. Best-effort: a
				// failure (or no pre-market session) just leaves it absent.
				if pm, perr := s.news.GetPreMarket(ctx, sym, q.PreviousClose); perr == nil {
					en.preMarket = pm
				}
			}
			mu.Lock()
			enrichments[sym] = en
			mu.Unlock()
		}()
	}
	wg.Wait()

	panels := make([]CompanyInfoPanel, 0, len(ordered))
	for _, g := range ordered {
		q := quotes[g.symbol]
		en := enrichments[g.symbol]
		panels = append(panels, CompanyInfoPanel{
			Symbol:           g.symbol,
			CompanyName:      en.companyName,
			Price:            q.Price,
			PreviousClose:    q.PreviousClose,
			ChangePercentage: q.ChangePercentage,
			DayHigh:          q.DayHigh,
			DayLow:           q.DayLow,
			Volume:           q.Volume,
			Open:             q.Open,
			HasPreMarket:     en.preMarket.Found,
			PreMarketPrice:   en.preMarket.Price,
			PreMarketChange:  en.preMarket.ChangePercent,
			NewsCount24h:     en.newsCount24h,
			PinnedMetrics:    g.metrics,
		})
	}

	_ = json.NewEncoder(w).Encode(panels)
}
