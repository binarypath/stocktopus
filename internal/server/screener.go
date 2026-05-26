package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// nativeScreenerParams lists the FMP company-screener query parameters we pass
// through verbatim. Anything not in this set is treated as a custom filter and
// applied post-fetch against the batch-quote pass.
var nativeScreenerParams = map[string]bool{
	"marketCapMoreThan":  true,
	"marketCapLowerThan": true,
	"priceMoreThan":      true,
	"priceLowerThan":     true,
	"betaMoreThan":       true,
	"betaLowerThan":      true,
	"volumeMoreThan":     true,
	"volumeLowerThan":    true,
	"dividendMoreThan":   true,
	"dividendLowerThan":  true,
	"sector":             true,
	"industry":           true,
	"country":            true,
	"exchange":           true,
	"isEtf":              true,
	"isFund":             true,
	"isActivelyTrading":  true,
	"limit":              true,
}

// screenerResult is the per-row payload returned to the UI. It includes both
// the native screener fields and the derived intraday metrics computed from
// the batch-quote post-pass.
type screenerResult struct {
	Symbol             string  `json:"symbol"`
	CompanyName        string  `json:"companyName"`
	Sector             string  `json:"sector"`
	Industry           string  `json:"industry"`
	Exchange           string  `json:"exchange"`
	Country            string  `json:"country"`
	MarketCap          float64 `json:"marketCap"`
	Beta               float64 `json:"beta"`
	Price              float64 `json:"price"`
	Volume             float64 `json:"volume"`
	Open               float64 `json:"open"`
	PreviousClose      float64 `json:"previousClose"`
	DayHigh            float64 `json:"dayHigh"`
	DayLow             float64 `json:"dayLow"`
	ChangeFromOpen     float64 `json:"changeFromOpen"`     // percent
	ChangeFromPrevDay  float64 `json:"changeFromPrevDay"`  // percent (== FMP changePercentage)
	ChangeVsMarket     float64 `json:"changeVsMarket"`     // percent points (own change - SPY change)
}

// batchQuoteRow mirrors the relevant subset of FMP's /stable/batch-quote item.
type batchQuoteRow struct {
	Symbol           string  `json:"symbol"`
	Name             string  `json:"name"`
	Price            float64 `json:"price"`
	ChangePercentage float64 `json:"changePercentage"`
	Volume           float64 `json:"volume"`
	DayHigh          float64 `json:"dayHigh"`
	DayLow           float64 `json:"dayLow"`
	Open             float64 `json:"open"`
	PreviousClose    float64 `json:"previousClose"`
}

// screenerCandidate mirrors the FMP company-screener item.
type screenerCandidate struct {
	Symbol      string  `json:"symbol"`
	CompanyName string  `json:"companyName"`
	MarketCap   float64 `json:"marketCap"`
	Sector      string  `json:"sector"`
	Industry    string  `json:"industry"`
	Beta        float64 `json:"beta"`
	Price       float64 `json:"price"`
	Volume      float64 `json:"volume"`
	Exchange    string  `json:"exchange"`
	Country     string  `json:"country"`
}

// handleScreenerAPI: GET /api/screener?<filters>
//
// Filters split into two groups:
//   - Native FMP company-screener params (see nativeScreenerParams): pass through
//   - Derived/intraday filters (changeFromOpenMin/Max, changeFromPrevDayMin/Max,
//     changeVsMarketMin/Max): applied client-side against batch-quote data
//
// Returns up to `limit` rows (default 50, max 250).
func (s *Server) handleScreenerAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.news == nil {
		http.Error(w, "news client unavailable", http.StatusServiceUnavailable)
		return
	}

	q := r.URL.Query()

	// Split native vs custom; build the FMP request.
	fmpParams := url.Values{}
	for key, vals := range q {
		if nativeScreenerParams[key] && len(vals) > 0 && vals[0] != "" {
			fmpParams.Set(key, vals[0])
		}
	}
	// Sensible defaults for native limit if the user didn't set one.
	if fmpParams.Get("limit") == "" {
		fmpParams.Set("limit", "250")
	}

	ctx := r.Context()
	rawCandidates, err := s.news.GetCompanyScreener(ctx, fmpParams)
	if err != nil {
		s.logger.Error("screener: company-screener fetch", "error", err)
		http.Error(w, "screener fetch failed", http.StatusBadGateway)
		return
	}
	var candidates []screenerCandidate
	if err := json.Unmarshal(rawCandidates, &candidates); err != nil {
		s.logger.Error("screener: candidates unmarshal", "error", err)
		http.Error(w, "bad upstream response", http.StatusBadGateway)
		return
	}
	if len(candidates) == 0 {
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}

	// Batch-quote the candidates + SPY for the market-relative calc.
	symbols := make([]string, 0, len(candidates)+1)
	symbols = append(symbols, "SPY")
	for _, c := range candidates {
		symbols = append(symbols, c.Symbol)
	}
	quotes, err := s.batchQuotes(ctx, symbols)
	if err != nil {
		s.logger.Error("screener: batch-quote fetch", "error", err)
		http.Error(w, "quote fetch failed", http.StatusBadGateway)
		return
	}
	spy, hasSPY := quotes["SPY"]

	// Custom filter thresholds (any may be missing).
	custom := parseCustomFilters(q)

	results := make([]screenerResult, 0, len(candidates))
	for _, c := range candidates {
		qRow, ok := quotes[c.Symbol]
		if !ok {
			continue // skip if no quote (illiquid / suspended / off-hours rounding)
		}
		row := buildScreenerResult(c, qRow, spy, hasSPY)
		if !custom.match(row) {
			continue
		}
		results = append(results, row)
	}

	// Final limit cap (after custom filters drop rows). Default 50.
	displayLimit := 50
	if l, err := strconv.Atoi(q.Get("displayLimit")); err == nil && l > 0 && l <= 250 {
		displayLimit = l
	}
	if len(results) > displayLimit {
		results = results[:displayLimit]
	}

	_ = json.NewEncoder(w).Encode(results)
}

// batchQuotes fetches /stable/batch-quote for the given symbols and returns
// them keyed by symbol. Chunks at 200 to stay friendly with the URL length.
func (s *Server) batchQuotes(ctx context.Context, symbols []string) (map[string]batchQuoteRow, error) {
	out := make(map[string]batchQuoteRow, len(symbols))
	const chunkSize = 200
	for i := 0; i < len(symbols); i += chunkSize {
		end := i + chunkSize
		if end > len(symbols) {
			end = len(symbols)
		}
		raw, err := s.news.GetBatchQuote(ctx, symbols[i:end])
		if err != nil {
			return nil, fmt.Errorf("batch-quote chunk: %w", err)
		}
		var rows []batchQuoteRow
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, fmt.Errorf("batch-quote unmarshal: %w", err)
		}
		for _, r := range rows {
			out[r.Symbol] = r
		}
	}
	return out, nil
}

// buildScreenerResult fuses screener candidate + quote into the response row,
// computing the derived intraday metrics. Robust against zero-valued open /
// previousClose (returns 0 rather than +Inf).
func buildScreenerResult(c screenerCandidate, q batchQuoteRow, spy batchQuoteRow, hasSPY bool) screenerResult {
	cfo := 0.0
	if q.Open != 0 {
		cfo = (q.Price - q.Open) / q.Open * 100
	}
	cfp := q.ChangePercentage
	cvm := 0.0
	if hasSPY {
		cvm = cfp - spy.ChangePercentage
	}
	return screenerResult{
		Symbol:            c.Symbol,
		CompanyName:       c.CompanyName,
		Sector:            c.Sector,
		Industry:          c.Industry,
		Exchange:          c.Exchange,
		Country:           c.Country,
		MarketCap:         c.MarketCap,
		Beta:              c.Beta,
		Price:             q.Price,
		Volume:            q.Volume,
		Open:              q.Open,
		PreviousClose:     q.PreviousClose,
		DayHigh:           q.DayHigh,
		DayLow:            q.DayLow,
		ChangeFromOpen:    cfo,
		ChangeFromPrevDay: cfp,
		ChangeVsMarket:    cvm,
	}
}

// customFilters captures the post-fetch numeric thresholds. Each pointer is
// nil if the user didn't specify that bound.
type customFilters struct {
	cfoMin, cfoMax *float64 // change from open %
	cfpMin, cfpMax *float64 // change from previous-day close %
	cvmMin, cvmMax *float64 // change vs market (percent points)
}

func parseCustomFilters(q url.Values) customFilters {
	parse := func(k string) *float64 {
		s := strings.TrimSpace(q.Get(k))
		if s == "" {
			return nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return &f
	}
	return customFilters{
		cfoMin: parse("changeFromOpenMin"),
		cfoMax: parse("changeFromOpenMax"),
		cfpMin: parse("changeFromPrevDayMin"),
		cfpMax: parse("changeFromPrevDayMax"),
		cvmMin: parse("changeVsMarketMin"),
		cvmMax: parse("changeVsMarketMax"),
	}
}

func (f customFilters) match(r screenerResult) bool {
	if f.cfoMin != nil && r.ChangeFromOpen < *f.cfoMin {
		return false
	}
	if f.cfoMax != nil && r.ChangeFromOpen > *f.cfoMax {
		return false
	}
	if f.cfpMin != nil && r.ChangeFromPrevDay < *f.cfpMin {
		return false
	}
	if f.cfpMax != nil && r.ChangeFromPrevDay > *f.cfpMax {
		return false
	}
	if f.cvmMin != nil && r.ChangeVsMarket < *f.cvmMin {
		return false
	}
	if f.cvmMax != nil && r.ChangeVsMarket > *f.cvmMax {
		return false
	}
	return true
}
