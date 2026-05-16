package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"stocktopus/internal/econ"
	"stocktopus/internal/store"
)

// handleEconomics serves the /economics page (calendar + catalog).
func (s *Server) handleEconomics(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, r, "economics.html", map[string]any{
		"Title":  "Economics",
		"Active": "economics",
	})
}

// handleEconomicsCatalog returns the curated indicator list with the latest
// observation per code from cache (for sparkline rendering on the catalog tab).
// The optional ?country=US filter scopes the response to one central bank.
func (s *Server) handleEconomicsCatalog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	type row struct {
		Identifier  string  `json:"identifier"`
		Country     string  `json:"country"`
		Code        string  `json:"code"`
		Name        string  `json:"name"`
		Category    string  `json:"category"`
		Frequency   string  `json:"frequency"`
		Units       string  `json:"units"`
		LatestDate  string  `json:"latestDate,omitempty"`
		LatestValue float64 `json:"latestValue,omitempty"`
		HasCache    bool    `json:"hasCache"`
	}

	country := strings.ToUpper(r.URL.Query().Get("country"))
	entries := econ.Catalog
	if country != "" {
		entries = econ.IndicatorsByCountry(country)
	}

	out := make([]row, 0, len(entries))
	for _, entry := range entries {
		id := entry.Identifier()
		r := row{
			Identifier: id,
			Country:    entry.Country,
			Code:       entry.Code,
			Name:       entry.Name,
			Category:   entry.Category,
			Frequency:  entry.Frequency,
			Units:      entry.Units,
		}
		if s.store != nil {
			if es, _ := s.store.GetEconomicSeries(id); es != nil && len(es.Observations) > 0 {
				last := es.Observations[len(es.Observations)-1]
				r.LatestDate = last.Date
				r.LatestValue = last.Value
				r.HasCache = true
				if es.Frequency != "" {
					r.Frequency = es.Frequency
				}
				if es.Units != "" {
					r.Units = es.Units
				}
			}
		}
		out = append(out, r)
	}
	json.NewEncoder(w).Encode(out)
}

// handleEconomicsCentralBanks lists the central banks covered by the catalog
// — the entry point for the catalog drill-down.
func (s *Server) handleEconomicsCentralBanks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(econ.CentralBanks())
}

// handleEconomicsSeries returns a single series — full observations, suitable
// for chart rendering. Path identifier is "COUNTRY.CODE" (e.g. US.UNRATE).
// Cache-through: serves from store if fresh, else hits the appropriate
// provider via the econ.Fetcher and persists. 404 if not in the catalog.
func (s *Server) handleEconomicsSeries(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	identifier := strings.ToUpper(r.PathValue("identifier"))
	entry := econ.LookupCatalog(identifier)
	if entry == nil {
		http.Error(w, "unknown series", http.StatusNotFound)
		return
	}

	es, err := s.fetchOrLoadSeries(r, entry)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	json.NewEncoder(w).Encode(es)
}

// serveEconomicSeriesObservations is the chart-layer projection — emits the
// [{date, value}, ...] shape that the sketchpad historical handler expects,
// so an `economic` metric kind interleaves with prices and financials cleanly.
func (s *Server) serveEconomicSeriesObservations(w http.ResponseWriter, r *http.Request, rawIdentifier string) {
	identifier := strings.ToUpper(rawIdentifier)
	entry := econ.LookupCatalog(identifier)
	if entry == nil {
		http.Error(w, "unknown economic series", http.StatusNotFound)
		return
	}
	es, err := s.fetchOrLoadSeries(r, entry)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	out := make([]map[string]any, 0, len(es.Observations))
	for _, o := range es.Observations {
		out = append(out, map[string]any{"date": o.Date, "value": o.Value})
	}
	json.NewEncoder(w).Encode(out)
}

// fetchOrLoadSeries returns the stored series if fresh, otherwise fetches via
// the econ.Fetcher (which dispatches to FRED, DBnomics, …), persists, and
// returns the fresh copy. Cache key is the full identifier (US.UNRATE).
func (s *Server) fetchOrLoadSeries(r *http.Request, entry *econ.CatalogEntry) (*store.EconomicSeries, error) {
	if s.store == nil {
		return nil, httpErr("store unavailable")
	}

	id := entry.Identifier()
	cached, _ := s.store.GetEconomicSeries(id)
	freq := entry.Frequency
	if cached != nil && cached.Frequency != "" {
		freq = cached.Frequency
	}
	if cached != nil && s.store.IsEconomicFresh(id, econ.TTLForFrequency(freq)) {
		return cached, nil
	}

	if s.econ == nil {
		if cached != nil {
			return cached, nil
		}
		return nil, httpErr("econ fetcher not configured")
	}

	ctx, cancel := contextWithTimeout(r, 30*time.Second)
	defer cancel()
	series, err := s.econ.FetchEntry(ctx, entry)
	if err != nil {
		if cached != nil {
			return cached, nil // soft-fail to stale cache
		}
		return nil, err
	}

	row := econSeriesToStoreRow(series)
	if err := s.store.PutEconomicSeries(row); err != nil {
		s.logger.Warn("economic series put failed", "id", id, "error", err)
	}
	return row, nil
}

// econSeriesToStoreRow mirrors econ.seriesToStoreRow — duplicated here to
// keep the prefetcher's helper unexported. Both shapes match field-for-field.
func econSeriesToStoreRow(s *econ.Series) *store.EconomicSeries {
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

// handleEconomicsCalendar proxies the FMP economic calendar for a date window.
// Defaults to a ±7-day window around today (UTC) so the calendar shows both
// recent actuals and upcoming releases.
func (s *Server) handleEconomicsCalendar(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" {
		from = time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")
	}
	if to == "" {
		to = time.Now().UTC().AddDate(0, 0, 7).Format("2006-01-02")
	}
	raw, err := s.news.GetEconomicCalendar(r.Context(), from, to)
	if err != nil {
		http.Error(w, "fmp calendar error", http.StatusBadGateway)
		return
	}
	w.Write(raw)
}
