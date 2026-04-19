package newspoller

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"stocktopus/internal/hub"
	"stocktopus/internal/model"
	"stocktopus/internal/news"
)

// Poller periodically fetches news for subscribed categories and publishes
// new articles to the hub. All connected clients receive updates simultaneously.
type Poller struct {
	client   *news.Client
	hub      *hub.Hub
	logger   *slog.Logger
	interval time.Duration

	categories map[news.Category]bool
	lastSeen   map[news.Category]map[string]bool // category → set of seen URLs
	mu         sync.RWMutex
}

func New(client *news.Client, h *hub.Hub, interval time.Duration, logger *slog.Logger) *Poller {
	return &Poller{
		client:     client,
		hub:        h,
		logger:     logger.With("component", "newspoller"),
		interval:   interval,
		categories: make(map[news.Category]bool),
		lastSeen:   make(map[news.Category]map[string]bool),
	}
}

// OnFirstSubscribe is called when a client subscribes to a news topic (e.g. "news:stock").
func (p *Poller) OnFirstSubscribe(topic string) {
	cat := topicToCategory(topic)
	if cat == "" {
		return
	}

	p.mu.Lock()
	p.categories[cat] = true
	if p.lastSeen[cat] == nil {
		p.lastSeen[cat] = make(map[string]bool)
	}
	p.mu.Unlock()

	p.logger.Info("watching news category", "category", cat)

	// Fetch immediately for the new subscriber
	go p.pollCategory(context.Background(), cat)
}

// OnLastUnsubscribe is called when the last client unsubscribes from a news topic.
func (p *Poller) OnLastUnsubscribe(topic string) {
	cat := topicToCategory(topic)
	if cat == "" {
		return
	}

	p.mu.Lock()
	delete(p.categories, cat)
	p.mu.Unlock()

	p.logger.Info("unwatching news category", "category", cat)
}

// Run starts the polling loop.
func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	p.logger.Info("news poller started", "interval", p.interval)

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("news poller stopped")
			return
		case <-ticker.C:
			p.pollAll(ctx)
		}
	}
}

func (p *Poller) pollAll(ctx context.Context) {
	p.mu.RLock()
	cats := make([]news.Category, 0, len(p.categories))
	for cat := range p.categories {
		cats = append(cats, cat)
	}
	p.mu.RUnlock()

	for _, cat := range cats {
		p.pollCategory(ctx, cat)
	}
}

func (p *Poller) pollCategory(ctx context.Context, cat news.Category) {
	items, err := p.client.GetNews(ctx, cat, "", 0, 20)
	if err != nil {
		p.logger.Error("news poll failed", "category", cat, "error", err)
		return
	}

	p.mu.Lock()
	seen := p.lastSeen[cat]
	if seen == nil {
		seen = make(map[string]bool)
		p.lastSeen[cat] = seen
	}

	var newItems []model.NewsItem
	for _, item := range items {
		if !seen[item.URL] {
			seen[item.URL] = true
			newItems = append(newItems, item)
		}
	}
	p.mu.Unlock()

	if len(newItems) == 0 {
		return
	}

	p.logger.Debug("new articles", "category", cat, "count", len(newItems))

	msg := hub.OutboundMessage{
		Type:  "news_update",
		Topic: "news:" + string(cat),
	}
	payload, _ := json.Marshal(newItems)
	msg.Payload = payload

	data, err := json.Marshal(msg)
	if err != nil {
		p.logger.Error("failed to marshal news update", "error", err)
		return
	}
	p.hub.Publish("news:"+string(cat), data)
}

func topicToCategory(topic string) news.Category {
	if strings.HasPrefix(topic, "news:") {
		return news.Category(strings.TrimPrefix(topic, "news:"))
	}
	return ""
}
