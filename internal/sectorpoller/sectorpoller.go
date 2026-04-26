package sectorpoller

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"stocktopus/internal/hub"
	"stocktopus/internal/news"
	"stocktopus/internal/store"
)

// Poller periodically refreshes sector intelligence data.
type Poller struct {
	client   *news.Client
	hub      *hub.Hub
	store    *store.Store
	logger   *slog.Logger
	interval time.Duration

	sectors map[string]bool
	mu      sync.RWMutex
}

func New(client *news.Client, h *hub.Hub, st *store.Store, interval time.Duration, logger *slog.Logger) *Poller {
	return &Poller{
		client:   client,
		hub:      h,
		store:    st,
		logger:   logger.With("component", "sectorpoller"),
		interval: interval,
		sectors:  make(map[string]bool),
	}
}

// OnFirstSubscribe is called when a client subscribes to a sector topic.
func (p *Poller) OnFirstSubscribe(topic string) {
	sector := topicToSector(topic)
	if sector == "" {
		return
	}
	p.mu.Lock()
	p.sectors[sector] = true
	p.mu.Unlock()
	p.logger.Info("sector bot 9000: activated", "sector", sector, "trigger", "on-demand")

	go p.pollSector(context.Background(), sector)
}

// OnLastUnsubscribe is called when the last client unsubscribes.
func (p *Poller) OnLastUnsubscribe(topic string) {
	sector := topicToSector(topic)
	if sector == "" {
		return
	}
	p.mu.Lock()
	delete(p.sectors, sector)
	p.mu.Unlock()
	p.logger.Info("sector bot 9000: deactivated", "sector", sector)
}

// Run starts the polling loop.
func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	p.logger.Info("sector poller started", "interval", p.interval)

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("sector poller stopped")
			return
		case <-ticker.C:
			p.pollAll(ctx)
		}
	}
}

func (p *Poller) pollAll(ctx context.Context) {
	p.mu.RLock()
	sectors := make([]string, 0, len(p.sectors))
	for s := range p.sectors {
		sectors = append(sectors, s)
	}
	p.mu.RUnlock()

	for _, sector := range sectors {
		p.pollSector(ctx, sector)
	}
}

func (p *Poller) pollSector(ctx context.Context, sector string) {
	if p.store != nil && p.store.IsSectorFresh(sector, p.interval) {
		p.logger.Debug("sector fresh, skipping", "sector", sector)
		return
	}

	p.logger.Info("sector bot 9000: starting", "sector", sector)
	start := time.Now()

	si := &store.SectorIntelligence{
		Sector:      sector,
		GeneratedAt: time.Now().UTC(),
	}

	if p.store != nil {
		if err := p.store.PutSector(si); err != nil {
			p.logger.Error("sector bot 9000: store failed", "sector", sector, "error", err)
		} else {
			p.logger.Info("sector bot 9000: data stored", "sector", sector, "duration", time.Since(start))
		}
	}

	msg, _ := json.Marshal(map[string]interface{}{
		"type":   "sector_update",
		"topic":  "sector:" + sector,
		"sector": sector,
	})
	p.hub.Publish("sector:"+sector, msg)
	p.logger.Info("sector bot 9000: complete", "sector", sector, "duration", time.Since(start))
}

// TriggerSector kicks off sector analysis if not already cached.
func (p *Poller) TriggerSector(sector string) {
	if sector == "" {
		return
	}
	p.mu.Lock()
	p.sectors[sector] = true
	p.mu.Unlock()
	go p.pollSector(context.Background(), sector)
}

func topicToSector(topic string) string {
	if strings.HasPrefix(topic, "sector:") {
		return strings.TrimPrefix(topic, "sector:")
	}
	return ""
}
