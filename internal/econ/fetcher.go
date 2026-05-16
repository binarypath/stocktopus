package econ

import (
	"context"
	"errors"
	"strings"

	"stocktopus/internal/dbnomics"
	"stocktopus/internal/fred"
)

// Fetcher resolves a CatalogEntry's Route to an actual observation series.
// The implementation here is the only place that knows about specific
// providers; everything else in the codebase consumes via this interface.
type Fetcher struct {
	fred     *fred.Client
	dbnomics *dbnomics.Client
}

func NewFetcher(fc *fred.Client, dc *dbnomics.Client) *Fetcher {
	return &Fetcher{fred: fc, dbnomics: dc}
}

// FetchEntry resolves the entry's Route and pulls the series. Returned
// Series is fully populated — title falls back to entry.Name when the
// upstream's title is empty, frequency is normalised to our D/W/M/Q/A,
// units come from the catalog (upstream rarely carries them in a usable form).
func (f *Fetcher) FetchEntry(ctx context.Context, e *CatalogEntry) (*Series, error) {
	source, opts, ok := splitRoute(e.Route)
	if !ok {
		return nil, errors.New("malformed route: " + e.Route)
	}
	switch source {
	case "fred":
		if f.fred == nil || !f.fred.HasKey() {
			return nil, errors.New("FRED_API_KEY not configured")
		}
		s, err := f.fred.GetSeries(ctx, opts)
		if err != nil {
			return nil, err
		}
		return fredToSeries(e, s), nil

	case "dbnomics":
		if f.dbnomics == nil {
			return nil, errors.New("dbnomics client not configured")
		}
		parts := strings.SplitN(opts, "/", 3)
		if len(parts) != 3 {
			return nil, errors.New("dbnomics route requires PROVIDER/DATASET/CODE")
		}
		s, err := f.dbnomics.GetSeries(ctx, parts[0], parts[1], parts[2])
		if err != nil {
			return nil, err
		}
		return dbnomicsToSeries(e, s), nil

	default:
		return nil, errors.New("unknown route source: " + source)
	}
}

// splitRoute parses "source:opts" into its parts. The first colon is the
// separator; opts may itself contain colons / slashes.
func splitRoute(route string) (source, opts string, ok bool) {
	i := strings.IndexByte(route, ':')
	if i < 0 {
		return "", "", false
	}
	return route[:i], route[i+1:], true
}

func fredToSeries(e *CatalogEntry, s *fred.Series) *Series {
	obs := make([]Observation, len(s.Observations))
	for i, o := range s.Observations {
		obs[i] = Observation{Date: o.Date, Value: o.Value}
	}
	title := s.Meta.Title
	if title == "" {
		title = e.Name
	}
	freq := NormaliseFrequency(s.Meta.FrequencyShort)
	if freq == "" {
		freq = e.Frequency
	}
	units := s.Meta.UnitsShort
	if units == "" {
		units = e.Units
	}
	return &Series{
		Identifier:   e.Identifier(),
		Title:        title,
		Category:     e.Category,
		Frequency:    freq,
		Units:        units,
		UpdatedAt:    s.Meta.LastUpdated,
		Observations: obs,
	}
}

func dbnomicsToSeries(e *CatalogEntry, s *dbnomics.Series) *Series {
	obs := make([]Observation, len(s.Observations))
	for i, o := range s.Observations {
		obs[i] = Observation{Date: o.Date, Value: o.Value}
	}
	title := s.Name
	if title == "" {
		title = e.Name
	}
	freq := NormaliseFrequency(s.Frequency)
	if freq == "" {
		freq = e.Frequency
	}
	// DBnomics doesn't surface a unit field per series in a uniform place;
	// the curated catalog is the source of truth for units.
	return &Series{
		Identifier:   e.Identifier(),
		Title:        title,
		Category:     e.Category,
		Frequency:    freq,
		Units:        e.Units,
		UpdatedAt:    s.UpdatedAt,
		Observations: obs,
	}
}
