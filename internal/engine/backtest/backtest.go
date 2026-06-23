// Package backtest evaluates, on historical price bars, where the optimal
// entry was inside a selected window — the engine behind the ideas-board
// "agent-led optimal entry" analysis.
//
// The core question: for a symbol over a selected window, which entry bar
// gave the best risk-adjusted return over a holding horizon H? Because the
// answer is sensitive to exit timing and costs, each candidate entry is
// scored over a Monte-Carlo cloud of jittered exits (around H) on the real
// forward path, yielding an outcome distribution (mean / std / Sharpe /
// win-rate) rather than a brittle point estimate.
//
// v1 keeps the cost function to risk-adjusted return (Sharpe-like) and the
// Monte-Carlo to exit-timing jitter over the actual historical path. Later
// passes can bootstrap forward returns and add drawdown / target-stop exit
// rules — the EntryEval distribution and Assumptions knobs are the seam.
package backtest

import (
	"errors"
	"math"
	"math/rand"

	"stocktopus/internal/model"
)

// Assumptions are the (deliberately explicit) inputs the "optimal entry" is
// optimal *with respect to*. Surfacing them is the point — the agent narrates
// over them and the user can perturb them.
type Assumptions struct {
	Horizon     int     `json:"horizon"`     // target holding period, in bars
	ExitJitter  int     `json:"exitJitter"`  // MC exits land within ±this many bars of Horizon
	Sims        int     `json:"sims"`        // Monte-Carlo simulations per candidate entry
	SlippageBps float64 `json:"slippageBps"` // round-trip slippage + cost, basis points
	PerBarRF    float64 `json:"perBarRf"`    // risk-free return per bar (Sharpe numerator)
	Seed        int64   `json:"seed"`        // RNG seed for reproducibility
}

// DefaultAssumptions is a reasonable daily-bars starting point.
func DefaultAssumptions() Assumptions {
	return Assumptions{Horizon: 10, ExitJitter: 3, Sims: 500, SlippageBps: 10, PerBarRF: 0, Seed: 1}
}

// EntryEval is the scored outcome distribution for entering at one bar.
type EntryEval struct {
	Index      int     `json:"index"`
	Date       string  `json:"date"`
	EntryPrice float64 `json:"entryPrice"`
	MeanReturn float64 `json:"meanReturn"` // mean net return across sims
	StdReturn  float64 `json:"stdReturn"`
	Sharpe     float64 `json:"sharpe"`
	PWin       float64 `json:"pWin"` // P(net return > 0)
	Score      float64 `json:"score"`
}

// Result is the full analysis: the winning entry plus every candidate's
// distribution (so the board can plot the score curve across the window).
type Result struct {
	Optimal     EntryEval   `json:"optimal"`
	Candidates  []EntryEval `json:"candidates"`
	Assumptions Assumptions `json:"assumptions"`
}

// FindOptimalEntry scores every candidate entry in bars[0..windowEnd] and
// returns the highest-scoring one. bars must include a forward outcome window
// past windowEnd (that's where the holding-period returns come from).
func FindOptimalEntry(bars []model.OHLCV, windowEnd int, a Assumptions) (Result, error) {
	if len(bars) < 2 {
		return Result{}, errors.New("backtest: need at least 2 bars")
	}
	if windowEnd < 0 {
		windowEnd = 0
	}
	if windowEnd > len(bars)-2 {
		windowEnd = len(bars) - 2 // every entry needs ≥1 forward bar
	}
	if a.Sims <= 0 {
		a.Sims = 1
	}
	if a.Horizon < 1 {
		a.Horizon = 1
	}
	rng := rand.New(rand.NewSource(a.Seed))

	cands := make([]EntryEval, 0, windowEnd+1)
	for i := 0; i <= windowEnd; i++ {
		if e, ok := evaluateEntry(bars, i, a, rng); ok {
			cands = append(cands, e)
		}
	}
	if len(cands) == 0 {
		return Result{}, errors.New("backtest: no scorable entries in window")
	}
	best := cands[0]
	for _, c := range cands[1:] {
		if c.Score > best.Score {
			best = c
		}
	}
	return Result{Optimal: best, Candidates: cands, Assumptions: a}, nil
}

// evaluateEntry simulates entering at bar i and exiting near i+Horizon, with
// exit timing jittered ±ExitJitter bars, on the real forward path.
func evaluateEntry(bars []model.OHLCV, i int, a Assumptions, rng *rand.Rand) (EntryEval, bool) {
	entry := bars[i].Close
	if entry <= 0 || i+1 >= len(bars) {
		return EntryEval{}, false
	}
	slip := a.SlippageBps / 10000.0
	rets := make([]float64, 0, a.Sims)
	for s := 0; s < a.Sims; s++ {
		jitter := 0
		if a.ExitJitter > 0 {
			jitter = rng.Intn(2*a.ExitJitter+1) - a.ExitJitter
		}
		exitIdx := i + a.Horizon + jitter
		if exitIdx <= i {
			exitIdx = i + 1
		}
		if exitIdx >= len(bars) {
			exitIdx = len(bars) - 1
		}
		exit := bars[exitIdx].Close
		rets = append(rets, (exit/entry-1.0)-slip) // round-trip net return
	}
	m := mean(rets)
	sd := std(rets, m)
	sharpe := 0.0
	if sd > 0 {
		sharpe = (m - a.PerBarRF*float64(a.Horizon)) / sd
	} else if m > 0 {
		// Zero-variance positive outcome (e.g. no exit jitter): reward it so a
		// deterministic winner still scores above a deterministic loser.
		sharpe = m
	}
	return EntryEval{
		Index: i, Date: bars[i].Date, EntryPrice: entry,
		MeanReturn: m, StdReturn: sd, Sharpe: sharpe,
		PWin:  frac(rets, func(r float64) bool { return r > 0 }),
		Score: sharpe,
	}, true
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}

func std(xs []float64, m float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	var ss float64
	for _, x := range xs {
		d := x - m
		ss += d * d
	}
	return math.Sqrt(ss / float64(len(xs)-1))
}

func frac(xs []float64, pred func(float64) bool) float64 {
	if len(xs) == 0 {
		return 0
	}
	n := 0
	for _, x := range xs {
		if pred(x) {
			n++
		}
	}
	return float64(n) / float64(len(xs))
}
