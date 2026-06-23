package backtest

import (
	"fmt"
	"testing"

	"stocktopus/internal/model"
)

// closes builds daily bars from a close-price series (OHLC flat = close).
func closes(prices ...float64) []model.OHLCV {
	out := make([]model.OHLCV, len(prices))
	for i, p := range prices {
		out[i] = model.OHLCV{
			Date:   fmt.Sprintf("2026-03-%02d", i+1),
			Open:   p, High: p, Low: p, Close: p,
			Volume: 1_000_000,
		}
	}
	return out
}

// A V-then-pop: price bottoms at index 2 (94), pops to ~109, then drifts down.
// Over a 3-bar horizon the bottom is the unambiguous best entry.
var vThenPop = closes(100, 97, 94, 104, 108, 109, 108, 107, 106, 105)

func TestFindOptimalEntry_PicksTheBottom(t *testing.T) {
	a := Assumptions{Horizon: 3, ExitJitter: 0, Sims: 1, SlippageBps: 0, Seed: 1}
	res, err := FindOptimalEntry(vThenPop, 4, a) // candidates 0..4
	if err != nil {
		t.Fatalf("FindOptimalEntry: %v", err)
	}
	if res.Optimal.Index != 2 {
		t.Fatalf("optimal entry = index %d (price %.0f); want index 2 (the 94 bottom). candidates: %+v",
			res.Optimal.Index, res.Optimal.EntryPrice, res.Candidates)
	}
	if res.Optimal.MeanReturn <= 0 {
		t.Fatalf("bottom entry should be profitable over horizon; got %.4f", res.Optimal.MeanReturn)
	}
	if len(res.Candidates) != 5 {
		t.Fatalf("want 5 candidates (indices 0..4); got %d", len(res.Candidates))
	}
}

func TestFindOptimalEntry_Deterministic(t *testing.T) {
	a := Assumptions{Horizon: 3, ExitJitter: 2, Sims: 300, SlippageBps: 5, Seed: 42}
	r1, err := FindOptimalEntry(vThenPop, 4, a)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := FindOptimalEntry(vThenPop, 4, a)
	if err != nil {
		t.Fatal(err)
	}
	if r1.Optimal != r2.Optimal {
		t.Fatalf("same seed must reproduce: %+v vs %+v", r1.Optimal, r2.Optimal)
	}
}

func TestEvaluateEntry_MCStats(t *testing.T) {
	// Deterministic (no jitter): std must be 0 and pWin a hard 0/1.
	a0 := Assumptions{Horizon: 3, ExitJitter: 0, Sims: 50, Seed: 1}
	res, err := FindOptimalEntry(vThenPop, 4, a0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Optimal.StdReturn > 1e-9 {
		t.Fatalf("no jitter ⇒ std ~0; got %g", res.Optimal.StdReturn)
	}
	if res.Optimal.PWin != 1 {
		t.Fatalf("profitable deterministic entry ⇒ pWin 1; got %.2f", res.Optimal.PWin)
	}

	// With jitter over a varying forward path the bottom entry stays a winner
	// but now carries dispersion.
	aj := Assumptions{Horizon: 3, ExitJitter: 2, Sims: 500, Seed: 7}
	rj, err := FindOptimalEntry(vThenPop, 4, aj)
	if err != nil {
		t.Fatal(err)
	}
	if rj.Optimal.StdReturn <= 0 {
		t.Fatalf("jitter over a varying path ⇒ std > 0; got %.6f", rj.Optimal.StdReturn)
	}
	if rj.Optimal.PWin <= 0 || rj.Optimal.PWin > 1 {
		t.Fatalf("pWin must be in (0,1]; got %.2f", rj.Optimal.PWin)
	}
}

func TestSlippage_LowersReturn(t *testing.T) {
	base := Assumptions{Horizon: 3, ExitJitter: 0, Sims: 1, SlippageBps: 0, Seed: 1}
	withCost := base
	withCost.SlippageBps = 100 // 1%

	r0, _ := FindOptimalEntry(vThenPop, 4, base)
	r1, _ := FindOptimalEntry(vThenPop, 4, withCost)
	// Same optimal bar, return lowered by exactly the slippage fraction.
	if r0.Optimal.Index != r1.Optimal.Index {
		t.Fatalf("slippage shouldn't change the winner here: %d vs %d", r0.Optimal.Index, r1.Optimal.Index)
	}
	got := r0.Optimal.MeanReturn - r1.Optimal.MeanReturn
	if diff := got - 0.01; diff < -1e-9 || diff > 1e-9 {
		t.Fatalf("100bps slippage should lower return by 0.01; lowered by %.6f", got)
	}
}

func TestFindOptimalEntry_Errors(t *testing.T) {
	if _, err := FindOptimalEntry(closes(100), 0, DefaultAssumptions()); err == nil {
		t.Fatal("want error for <2 bars")
	}
	// windowEnd past the data is clamped, not an error.
	if _, err := FindOptimalEntry(vThenPop, 999, DefaultAssumptions()); err != nil {
		t.Fatalf("windowEnd should clamp, not error: %v", err)
	}
}
