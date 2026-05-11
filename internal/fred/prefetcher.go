package fred

import (
	"context"
	"log/slog"
	"time"

	"stocktopus/internal/store"
)

// Prefetcher keeps the curated catalog warm in the store. It runs an initial
// pass on Run, then wakes on a ticker to refresh anything older than its
// frequency-aware TTL.
type Prefetcher struct {
	client   *Client
	store    *store.Store
	logger   *slog.Logger
	interval time.Duration
}

func NewPrefetcher(client *Client, st *store.Store, logger *slog.Logger, interval time.Duration) *Prefetcher {
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	return &Prefetcher{
		client:   client,
		store:    st,
		logger:   logger.With("component", "fred-prefetcher"),
		interval: interval,
	}
}

// Run primes the cache at boot and refreshes on every tick. Blocks until ctx
// is cancelled. If the client has no API key this is a no-op (logged once).
func (p *Prefetcher) Run(ctx context.Context) {
	if !p.client.HasKey() {
		p.logger.Warn("FRED_API_KEY not set — economic series prefetch disabled")
		return
	}

	p.logger.Info("fred prefetcher starting", "indicators", len(Catalog), "tick", p.interval)
	p.refreshAll(ctx)

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			p.logger.Info("fred prefetcher stopped")
			return
		case <-ticker.C:
			p.refreshAll(ctx)
		}
	}
}

func (p *Prefetcher) refreshAll(ctx context.Context) {
	for _, entry := range Catalog {
		if ctx.Err() != nil {
			return
		}
		// Store keys are the full identifier (US.UNRATE); FRED itself is
		// queried with the bare code (UNRATE). Future-proofs the cache for
		// when v2 adds EZ.UNRATE etc. from a different provider.
		id := entry.Identifier()
		freq := entry.Frequency
		if existing, _ := p.store.GetEconomicSeries(id); existing != nil && existing.Frequency != "" {
			freq = existing.Frequency
		}
		if p.store.IsEconomicFresh(id, TTLForFrequency(freq)) {
			continue
		}

		fetchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		series, err := p.client.GetSeries(fetchCtx, entry.Code)
		cancel()
		if err != nil {
			p.logger.Warn("fred fetch failed", "id", id, "error", err)
			continue
		}

		obs := make([]store.EconomicObservation, len(series.Observations))
		for i, o := range series.Observations {
			obs[i] = store.EconomicObservation{Date: o.Date, Value: o.Value}
		}
		row := &store.EconomicSeries{
			Code:            id,
			Title:           coalesce(series.Meta.Title, entry.Name),
			Category:        entry.Category,
			Frequency:       coalesce(series.Meta.FrequencyShort, entry.Frequency),
			Units:           coalesce(series.Meta.UnitsShort, entry.Units),
			Observations:    obs,
			SourceUpdatedAt: series.Meta.LastUpdated,
		}
		if err := p.store.PutEconomicSeries(row); err != nil {
			p.logger.Warn("fred store failed", "id", id, "error", err)
			continue
		}
		p.logger.Debug("fred refreshed", "id", id, "points", len(obs))
	}
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
