package backtest

import "stocktopus/internal/model"

// portfolio.go — the "$10k, decide at every candle, make the most profit"
// simulation. This is both the validation harness (does a policy beat
// buy-&-hold? how close to the hindsight ceiling?) and the shape of the
// agent's product output (a per-candle decision trace with rationale).
//
// Long-only, fractional positions. A Policy sees only bars[0..i] — NO
// lookahead — so a simulated result is what a trader could actually have
// achieved in real time. The hindsight ceiling (HindsightOptimalEquity) is
// computed separately and DOES peek; it's the upper bound, not a policy.

// Decision is one bar's action in a simulation trace.
type Decision struct {
	Index    int     `json:"index"`
	Date     string  `json:"date"`
	Price    float64 `json:"price"`
	Target   float64 `json:"target"`   // post-decision fraction of equity in the stock (0..1)
	Traded   float64 `json:"traded"`   // signed shares traded this bar (+buy / -sell)
	Cash     float64 `json:"cash"`     // cash after the trade
	Shares   float64 `json:"shares"`   // shares held after the trade
	Equity   float64 `json:"equity"`   // mark-to-market equity at this bar's close
}

// SimResult is the outcome of walking a policy across the bars.
type SimResult struct {
	StartCash   float64    `json:"startCash"`
	EndEquity   float64    `json:"endEquity"`
	TotalReturn float64    `json:"totalReturn"` // EndEquity/StartCash - 1
	Trace       []Decision `json:"trace"`
}

// Policy decides the target fraction of equity to hold in the stock at bar i,
// using ONLY bars[0..i]. Returns a value in [0,1] (long-only).
type Policy interface {
	Target(bars []model.OHLCV, i int, equity float64) float64
}

// PolicyFunc adapts a function to a Policy.
type PolicyFunc func(bars []model.OHLCV, i int, equity float64) float64

func (f PolicyFunc) Target(bars []model.OHLCV, i int, equity float64) float64 {
	return f(bars, i, equity)
}

// Simulate walks the policy across every bar, rebalancing to its target
// fraction (paying slippage on traded notional), and returns the trace +
// ending equity.
func Simulate(bars []model.OHLCV, p Policy, startCash, slippageBps float64) SimResult {
	slip := slippageBps / 10000.0
	cash := startCash
	shares := 0.0
	trace := make([]Decision, 0, len(bars))

	for i := range bars {
		px := bars[i].Close
		if px <= 0 {
			continue
		}
		equity := cash + shares*px
		target := clamp01(p.Target(bars, i, equity))
		desired := target * equity / px
		traded := desired - shares
		cost := abs(traded) * px * slip
		cash -= traded*px + cost
		shares = desired
		equity = cash + shares*px // re-mark after costs
		trace = append(trace, Decision{
			Index: i, Date: bars[i].Date, Price: px,
			Target: target, Traded: traded, Cash: cash, Shares: shares, Equity: equity,
		})
	}

	end := startCash
	if n := len(trace); n > 0 {
		end = trace[n-1].Equity
	}
	return SimResult{StartCash: startCash, EndEquity: end, TotalReturn: end/startCash - 1, Trace: trace}
}

// BuyHold buys fully at the first bar and holds.
func BuyHold() Policy { return PolicyFunc(func(_ []model.OHLCV, _ int, _ float64) float64 { return 1 }) }

// AllCash never invests (baseline floor).
func AllCash() Policy { return PolicyFunc(func(_ []model.OHLCV, _ int, _ float64) float64 { return 0 }) }

// MomentumPolicy is fully invested while the close is above its trailing
// SMA(n) and flat otherwise — a simple, lookahead-free trend filter used to
// demonstrate that a policy can dodge drawdowns and beat buy-&-hold.
func MomentumPolicy(n int) Policy {
	return PolicyFunc(func(bars []model.OHLCV, i int, _ float64) float64 {
		if i < n {
			return 0
		}
		var sum float64
		for k := i - n + 1; k <= i; k++ {
			sum += bars[k].Close
		}
		if bars[i].Close > sum/float64(n) {
			return 1
		}
		return 0
	})
}

// HindsightOptimalEquity is the upper bound for long-only, all-in/all-out
// trading with perfect foresight: capture every up-day, sit out every
// down-day. equity ×= close[i]/close[i-1] for each up move.
func HindsightOptimalEquity(bars []model.OHLCV, startCash float64) float64 {
	eq := startCash
	for i := 1; i < len(bars); i++ {
		if bars[i-1].Close > 0 && bars[i].Close > bars[i-1].Close {
			eq *= bars[i].Close / bars[i-1].Close
		}
	}
	return eq
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
