package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"stocktopus/internal/engine/backtest"
)

// backtestResponse is the optimal-entry analysis the ideas board pins as a
// "way-to-trade" card. Deterministic (no LLM): the engine over real OHLCV.
type backtestResponse struct {
	Symbol     string               `json:"symbol"`
	From       string               `json:"from"`
	To         string               `json:"to"`
	Horizon    int                  `json:"horizon"`
	Bars       int                  `json:"bars"`
	StartCash  float64              `json:"startCash"`
	Optimal    backtest.EntryEval   `json:"optimal"`     // best historical entry (hindsight)
	Candidates []backtest.EntryEval `json:"candidates"`  // score curve across the window
	Policy     backtest.SimResult   `json:"policy"`      // the $10k lookahead-free walk + decision trace
	BuyHold    float64              `json:"buyHoldEquity"`
	Hindsight  float64              `json:"hindsightEquity"`
}

// GET /api/backtest/optimal-entry/{symbol}?from=&to=&horizon=
// from/to bound the *selected window*; we fetch through to the latest bar so the
// holding-horizon outcomes (the bars past `to`) are available to score entries.
func (s *Server) handleBacktestOptimalEntry(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	horizon := 10
	if h := r.URL.Query().Get("horizon"); h != "" {
		if n, err := strconv.Atoi(h); err == nil && n > 0 {
			horizon = n
		}
	}
	w.Header().Set("Content-Type", "application/json")
	writeErr := func(code int, msg string) {
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}

	bars, err := s.news.GetHistoricalEOD(r.Context(), symbol, from, "")
	if err != nil {
		s.logger.Error("backtest eod failed", "symbol", symbol, "error", err)
		writeErr(http.StatusBadGateway, err.Error())
		return
	}
	if len(bars) < 2 {
		writeErr(http.StatusUnprocessableEntity, "not enough price history for "+symbol)
		return
	}

	// windowEnd = last bar at or before `to` (the selection end); bars after it
	// are the forward outcome window. Empty `to` → use all but the last bar.
	windowEnd := len(bars) - 2
	if to != "" {
		windowEnd = 0
		for i, b := range bars {
			if b.Date <= to {
				windowEnd = i
			} else {
				break
			}
		}
		if windowEnd > len(bars)-2 {
			windowEnd = len(bars) - 2
		}
	}

	a := backtest.DefaultAssumptions()
	a.Horizon = horizon
	res, err := backtest.FindOptimalEntry(bars, windowEnd, a)
	if err != nil {
		writeErr(http.StatusUnprocessableEntity, err.Error())
		return
	}

	// The $10k walk + baselines run over the selected window (lookahead-free).
	const startCash = 10_000.0
	window := bars[:windowEnd+1]
	policy := backtest.Simulate(window, backtest.MomentumPolicy(5), startCash, a.SlippageBps)
	buyHold := backtest.Simulate(window, backtest.BuyHold(), startCash, 0).EndEquity
	hindsight := backtest.HindsightOptimalEquity(window, startCash)

	cands := res.Candidates
	if len(cands) > 400 { // cap payload on long windows
		cands = cands[len(cands)-400:]
	}

	json.NewEncoder(w).Encode(backtestResponse{
		Symbol: symbol, From: from, To: to, Horizon: horizon, Bars: len(bars),
		StartCash: startCash, Optimal: res.Optimal, Candidates: cands,
		Policy: policy, BuyHold: buyHold, Hindsight: hindsight,
	})
}
