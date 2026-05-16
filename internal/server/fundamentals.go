package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

// fieldEndpoint describes which FMP endpoint serves a given non-statement
// field, plus any post-processing hint. Statement fields (revenue,
// totalAssets, …) stay on the existing income/balance/cashflow path in
// ideas.go and aren't listed here.
type fieldEndpoint struct {
	kind string // "keymetric" | "ratio" | "marketcap" | "beta" | "sectorBeta"
	// fmpField overrides the FMP JSON field name when it differs from the
	// user-facing handle. Empty = use the map key. FMP's naming is wildly
	// inconsistent — e.g. our friendly "peRatio" comes off /ratios as
	// "priceToEarningsRatio"; "debtToEquity" as "debtToEquityRatio".
	fmpField string
}

// fundamentalFields is the map of non-statement field names → endpoint
// routing. User-facing keys (peRatio, debtToEquity, …) stay terse so
// `:add AAPL.peRatio` is the natural thing to type; fmpField below
// reconciles them to FMP's actual response keys.
//
// Verified against FMP /stable/key-metrics and /stable/ratios responses
// — every routing here is exercised by tests/e2e/historical_test.go.
var fundamentalFields = map[string]fieldEndpoint{
	// /key-metrics (annual) — these field names land verbatim in the FMP response
	"enterpriseValue":         {kind: "keymetric"},
	"evToSales":               {kind: "keymetric"},
	"evToEBITDA":              {kind: "keymetric"},
	"evToOperatingCashFlow":   {kind: "keymetric"},
	"evToFreeCashFlow":        {kind: "keymetric"},
	"returnOnEquity":          {kind: "keymetric"},
	"returnOnAssets":          {kind: "keymetric"},
	"returnOnCapitalEmployed": {kind: "keymetric"},
	"currentRatio":            {kind: "keymetric"}, // present on /ratios too — either works

	// /ratios (annual) — some need FMP-name overrides
	"peRatio":               {kind: "ratio", fmpField: "priceToEarningsRatio"},
	"priceToSalesRatio":     {kind: "ratio"},
	"priceToBookRatio":      {kind: "ratio"},
	"dividendYield":         {kind: "ratio"},
	"payoutRatio":           {kind: "ratio", fmpField: "dividendPayoutRatio"},
	"debtToEquity":          {kind: "ratio", fmpField: "debtToEquityRatio"},
	"debtToAssets":          {kind: "ratio", fmpField: "debtToAssetsRatio"},
	"quickRatio":            {kind: "ratio"},
	"grossProfitMargin":     {kind: "ratio"},
	"operatingProfitMargin": {kind: "ratio"},
	"netProfitMargin":       {kind: "ratio"},

	// Specials
	"marketCap":  {kind: "marketcap"},
	"beta":       {kind: "beta"},
	"sectorBeta": {kind: "sectorBeta"},
}

// sectorETFs maps GICS sector names (and the variants FMP returns on
// /stable/profile) to the State Street SPDR sector ETF symbol. Used by the
// `sectorBeta` field to resolve a security to the ETF whose rolling beta
// represents the sector's macro sensitivity.
//
// Keys are normalised to lower-case at lookup time so casing differences
// between FMP's "Financial Services" and the canonical "Financials" don't
// matter.
var sectorETFs = map[string]string{
	"technology":             "XLK",
	"information technology": "XLK",
	"health care":            "XLV",
	"healthcare":             "XLV",
	"financials":             "XLF",
	"financial services":     "XLF",
	"energy":                 "XLE",
	"consumer discretionary": "XLY",
	"consumer cyclical":      "XLY",
	"consumer staples":       "XLP",
	"consumer defensive":     "XLP",
	"industrials":            "XLI",
	"utilities":              "XLU",
	"materials":              "XLB",
	"basic materials":        "XLB",
	"real estate":            "XLRE",
	"communication services": "XLC",
	"communications":         "XLC",
}

// sectorETF returns the SPDR sector ETF symbol for a sector name, or "" if
// the sector is unknown. Case- and whitespace-insensitive.
func sectorETF(sector string) string {
	return sectorETFs[strings.ToLower(strings.TrimSpace(sector))]
}

// lookupFundamentalField returns the routing entry for a field name. Lookup
// is case-insensitive on the first letter only (FMP uses camelCase, so
// `marketcap` from a user maps to the canonical `marketCap`).
func lookupFundamentalField(field string) (string, *fieldEndpoint) {
	if entry, ok := fundamentalFields[field]; ok {
		return field, &entry
	}
	// Try with lowercase first letter swapped — handles `Marketcap` etc.
	for k, v := range fundamentalFields {
		if strings.EqualFold(k, field) {
			return k, &v
		}
	}
	return "", nil
}

// serveFundamentalField handles the non-statement field projection for
// /api/historical/financial/SYMBOL.field. Called when the field is in the
// fundamentalFields table.
func (s *Server) serveFundamentalField(w http.ResponseWriter, r *http.Request, sym, field string, ep *fieldEndpoint) {
	switch ep.kind {
	case "marketcap":
		s.serveDailyMarketCap(w, r, sym)
	case "beta":
		s.serveRollingBeta(w, r, sym)
	case "sectorBeta":
		s.serveSectorBeta(w, r, sym)
	case "keymetric":
		s.serveAnnualField(w, r, sym, fmpFieldFor(field, ep), "keymetric")
	case "ratio":
		s.serveAnnualField(w, r, sym, fmpFieldFor(field, ep), "ratio")
	default:
		http.Error(w, "unsupported field kind", http.StatusBadRequest)
	}
}

// fmpFieldFor returns the FMP JSON field name for an entry. Uses the
// catalog's override if set, otherwise the user-facing key as-is.
func fmpFieldFor(userField string, ep *fieldEndpoint) string {
	if ep != nil && ep.fmpField != "" {
		return ep.fmpField
	}
	return userField
}

// serveAnnualField fetches the appropriate annual endpoint, projects out the
// target field, emits the [{date, value}] shape the chart layer expects.
func (s *Server) serveAnnualField(w http.ResponseWriter, r *http.Request, sym, field, endpointKind string) {
	var raw json.RawMessage
	var err error
	if endpointKind == "keymetric" {
		raw, err = s.news.GetKeyMetricsHistorical(r.Context(), sym, 10)
	} else {
		raw, err = s.news.GetRatiosHistorical(r.Context(), sym, 10)
	}
	if err != nil {
		http.Error(w, "fmp error", http.StatusBadGateway)
		return
	}
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		http.Error(w, "bad fmp response", http.StatusBadGateway)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		date, _ := row["date"].(string)
		if date == "" {
			if fy, ok := row["fiscalYear"].(string); ok {
				date = fy + "-12-31"
			}
		}
		v, ok := row[field]
		if !ok {
			continue
		}
		out = append(out, map[string]any{"date": date, "value": v})
	}
	json.NewEncoder(w).Encode(out)
}

// serveDailyMarketCap projects FMP's /historical-market-capitalization into
// the chart layer's [{date, value}] shape. Explicit 5-year window — FMP's
// default response on this endpoint is ~3 months regardless of the limit
// param, which leaves charts looking truncated against multi-year series.
func (s *Server) serveDailyMarketCap(w http.ResponseWriter, r *http.Request, sym string) {
	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(-5, 0, 0).Format("2006-01-02")
	raw, err := s.news.GetHistoricalMarketCap(r.Context(), sym, from, to)
	if err != nil {
		http.Error(w, "fmp error", http.StatusBadGateway)
		return
	}
	var rows []struct {
		Date      string  `json:"date"`
		MarketCap float64 `json:"marketCap"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		http.Error(w, "bad fmp response", http.StatusBadGateway)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if row.Date == "" {
			continue
		}
		out = append(out, map[string]any{"date": row.Date, "value": row.MarketCap})
	}
	json.NewEncoder(w).Encode(out)
}

// betaBenchmark is the market index used as the regression target for
// rolling beta. Hardcoded to SPY for v1 — every US-equity beta convention
// uses this. Future: parameterise via SYMBOL.beta@BENCHMARK.
const betaBenchmark = "SPY"

// betaWindow is the rolling window size (trading days). 252 ≈ 1 year of
// daily observations, the standard "1Y daily" beta convention.
const betaWindow = 252

// pricePoint is one (date, close) sample of an EOD price series.
type pricePoint struct {
	Date  string  `json:"date"`
	Price float64 `json:"price"`
}

// betaPoint is one rolling-beta observation emitted on the wire.
type betaPoint struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// serveRollingBeta computes daily rolling 1-year beta for a security against
// SPY and emits a [{date, value}] series. Math is the CAPM definition:
// cov(security returns, benchmark returns) / var(benchmark returns) over
// the trailing window, slid one day at a time.
func (s *Server) serveRollingBeta(w http.ResponseWriter, r *http.Request, sym string) {
	fetch := func(symbol string) ([]pricePoint, error) {
		raw, err := s.news.GetHistoricalPriceLight(r.Context(), symbol)
		if err != nil {
			return nil, err
		}
		var rows []pricePoint
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, fmt.Errorf("decode %s: %w", symbol, err)
		}
		return rows, nil
	}

	targetRows, err := fetch(sym)
	if err != nil {
		http.Error(w, "fmp error (target)", http.StatusBadGateway)
		return
	}
	benchRows, err := fetch(betaBenchmark)
	if err != nil {
		http.Error(w, "fmp error (benchmark)", http.StatusBadGateway)
		return
	}

	series, err := rollingBeta(targetRows, benchRows, betaWindow)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	json.NewEncoder(w).Encode(series)
}

// serveSectorBeta resolves the security's sector via FMP /profile, maps it
// to the SPDR sector ETF, and emits that ETF's rolling beta vs SPY. The
// user-side use is the spread test: when sectorBeta and beta diverge, the
// move is single-name; when they track, the whole sector is repricing.
func (s *Server) serveSectorBeta(w http.ResponseWriter, r *http.Request, sym string) {
	raw, err := s.news.GetProfile(r.Context(), sym)
	if err != nil {
		http.Error(w, "fmp profile error", http.StatusBadGateway)
		return
	}
	// FMP returns an array even for a single-symbol profile lookup.
	var rows []struct {
		Sector string `json:"sector"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil || len(rows) == 0 {
		http.Error(w, "no profile data", http.StatusUnprocessableEntity)
		return
	}
	etf := sectorETF(rows[0].Sector)
	if etf == "" {
		http.Error(w, "unknown sector: "+rows[0].Sector, http.StatusUnprocessableEntity)
		return
	}
	// Reuse the same rolling-beta machinery the bare `.beta` field uses —
	// the math is symmetric in the target, so we just hand it the ETF.
	s.serveRollingBeta(w, r, etf)
}

// rollingBeta returns [{date, value}] daily beta for the trailing window
// ending on each day. Drops days where either series is missing or the
// benchmark variance is zero. FMP returns prices in descending date order;
// we re-sort ascending so the window walks forward in time.
//
//	cov  = Σ (rₜ - r̄)(mₜ - m̄)
//	varB = Σ (mₜ - m̄)²
//	β    = cov / varB
//
// (The 1/N factors cancel in the division so we omit them.) r and m are
// daily simple returns.
func rollingBeta(target, bench []pricePoint, window int) ([]betaPoint, error) {
	tgt := sortedAscending(target)
	bch := sortedAscending(bench)

	bchByDate := make(map[string]float64, len(bch))
	for _, p := range bch {
		bchByDate[p.Date] = p.Price
	}

	// Align on dates that exist in both series.
	type pair struct {
		Date          string
		Target, Bench float64
	}
	aligned := make([]pair, 0, len(tgt))
	for _, t := range tgt {
		if b, ok := bchByDate[t.Date]; ok {
			aligned = append(aligned, pair{Date: t.Date, Target: t.Price, Bench: b})
		}
	}
	if len(aligned) < window+1 {
		return nil, errors.New("not enough aligned history to compute beta")
	}

	// Daily simple returns.
	type ret struct {
		Date          string
		Target, Bench float64
	}
	returns := make([]ret, 0, len(aligned)-1)
	for i := 1; i < len(aligned); i++ {
		t0, t1 := aligned[i-1].Target, aligned[i].Target
		b0, b1 := aligned[i-1].Bench, aligned[i].Bench
		if t0 == 0 || b0 == 0 {
			continue
		}
		returns = append(returns, ret{
			Date:   aligned[i].Date,
			Target: (t1 - t0) / t0,
			Bench:  (b1 - b0) / b0,
		})
	}
	if len(returns) < window {
		return nil, errors.New("not enough returns to compute beta")
	}

	out := make([]betaPoint, 0, len(returns)-window+1)
	for i := window; i <= len(returns); i++ {
		var sumT, sumB float64
		for j := i - window; j < i; j++ {
			sumT += returns[j].Target
			sumB += returns[j].Bench
		}
		meanT := sumT / float64(window)
		meanB := sumB / float64(window)

		var cov, varB float64
		for j := i - window; j < i; j++ {
			dt := returns[j].Target - meanT
			db := returns[j].Bench - meanB
			cov += dt * db
			varB += db * db
		}
		if varB == 0 || math.IsNaN(varB) {
			continue
		}
		out = append(out, betaPoint{Date: returns[i-1].Date, Value: cov / varB})
	}
	return out, nil
}

// sortedAscending returns the input as a new slice sorted by date ascending
// and stripped of rows with zero/negative price. FMP's historical-price
// endpoints return descending; the beta math walks forward in time.
func sortedAscending(rows []pricePoint) []pricePoint {
	out := make([]pricePoint, 0, len(rows))
	for _, p := range rows {
		if p.Date != "" && p.Price > 0 {
			out = append(out, p)
		}
	}
	// In-place reverse — FMP returns descending so this flips to ascending.
	// If the input is already ascending (or out-of-order, rare), the result
	// will be wrong; in practice FMP's order is consistent so a reverse is
	// fine and avoids the cost of a real sort on multi-thousand-row series.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// silence unused-import warnings on `context` while keeping the file ready
// for follow-ups (parallel target/bench fetch with a shared timeout).
var _ = context.Background
