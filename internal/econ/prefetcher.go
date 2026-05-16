package econ

import (
	"context"
	"log/slog"
	"time"

	"stocktopus/internal/store"
)

// Prefetcher walks the unified catalog and keeps it warm. Dispatches per
// entry to the right provider via the Fetcher — the prefetcher itself
// stays provider-agnostic.
type Prefetcher struct {
	fetcher  *Fetcher
	store    *store.Store
	logger   *slog.Logger
	interval time.Duration
}

func NewPrefetcher(fetcher *Fetcher, st *store.Store, logger *slog.Logger, interval time.Duration) *Prefetcher {
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	return &Prefetcher{
		fetcher:  fetcher,
		store:    st,
		logger:   logger.With("component", "econ-prefetcher"),
		interval: interval,
	}
}

// Run primes the cache at boot and refreshes on every tick. Blocks until
// ctx is cancelled.
func (p *Prefetcher) Run(ctx context.Context) {
	p.logger.Info("econ prefetcher starting", "indicators", len(Catalog), "tick", p.interval)
	p.refreshAll(ctx)

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			p.logger.Info("econ prefetcher stopped")
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
		id := entry.Identifier()
		// Skip if cache is still inside its TTL window. Frequency from the
		// stored copy takes precedence (it's what the upstream told us last
		// time); fall back to the catalog's hint on a cold cache.
		freq := entry.Frequency
		if existing, _ := p.store.GetEconomicSeries(id); existing != nil && existing.Frequency != "" {
			freq = existing.Frequency
		}
		if p.store.IsEconomicFresh(id, TTLForFrequency(freq)) {
			continue
		}

		fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		series, err := p.fetcher.FetchEntry(fetchCtx, &entry)
		cancel()
		if err != nil {
			p.logger.Warn("econ fetch failed", "id", id, "error", err)
			continue
		}

		row := seriesToStoreRow(series)
		if err := p.store.PutEconomicSeries(row); err != nil {
			p.logger.Warn("econ store failed", "id", id, "error", err)
			continue
		}
		p.logger.Debug("econ refreshed", "id", id, "points", len(series.Observations))
	}
}

// seriesToStoreRow converts the domain Series into the SQLite store row.
// Both shapes mirror each other field-for-field — this is a copy with
// type-renaming, not a transformation.
func seriesToStoreRow(s *Series) *store.EconomicSeries {
	obs := make([]store.EconomicObservation, len(s.Observations))
	for i, o := range s.Observations {
		obs[i] = store.EconomicObservation{Date: o.Date, Value: o.Value}
	}
	return &store.EconomicSeries{
		Code:            s.Identifier,
		Title:           s.Title,
		Category:        s.Category,
		Frequency:       s.Frequency,
		Units:           s.Units,
		Observations:    obs,
		SourceUpdatedAt: s.UpdatedAt,
	}
}
