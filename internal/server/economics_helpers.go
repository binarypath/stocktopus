package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"stocktopus/internal/fred"
	"stocktopus/internal/store"
)

func httpErr(msg string) error { return errors.New(msg) }

func contextWithTimeout(r *http.Request, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), d)
}

// seriesToRow turns a fresh FRED response into the store row, falling back to
// catalog values for anything FRED didn't provide. id is the full identifier
// used as the cache key (e.g. "US.UNRATE").
func seriesToRow(id string, entry *fred.CatalogEntry, series *fred.Series) *store.EconomicSeries {
	obs := make([]store.EconomicObservation, len(series.Observations))
	for i, o := range series.Observations {
		obs[i] = store.EconomicObservation{Date: o.Date, Value: o.Value}
	}
	title := series.Meta.Title
	if title == "" {
		title = entry.Name
	}
	freq := series.Meta.FrequencyShort
	if freq == "" {
		freq = entry.Frequency
	}
	units := series.Meta.UnitsShort
	if units == "" {
		units = entry.Units
	}
	return &store.EconomicSeries{
		Code:            id,
		Title:           title,
		Category:        entry.Category,
		Frequency:       freq,
		Units:           units,
		Observations:    obs,
		SourceUpdatedAt: series.Meta.LastUpdated,
	}
}
