package backtest

import "testing"

const start = 10_000.0

func approx(a, b, tol float64) bool { return a-b < tol && b-a < tol }

// Buy-&-hold ending equity is exactly start × priceRatio (no slippage).
func TestBuyHold_EndingEquityExact(t *testing.T) {
	bars := closes(100, 120, 160, 200) // 2× over the window
	r := Simulate(bars, BuyHold(), start, 0)
	if !approx(r.EndEquity, 20_000, 1e-6) {
		t.Fatalf("buy-hold on a 2× series should end at $20k; got $%.2f", r.EndEquity)
	}
	if !approx(r.TotalReturn, 1.0, 1e-9) {
		t.Fatalf("total return should be +100%%; got %.4f", r.TotalReturn)
	}
	if len(r.Trace) != len(bars) {
		t.Fatalf("trace should have one decision per bar; got %d", len(r.Trace))
	}
}

func TestAllCash_PreservesCapital(t *testing.T) {
	r := Simulate(closes(100, 50, 200), AllCash(), start, 50)
	if !approx(r.EndEquity, start, 1e-6) {
		t.Fatalf("all-cash must preserve $%.0f; got $%.2f", start, r.EndEquity)
	}
}

// The crux: a lookahead-free momentum policy must beat buy-&-hold on a series
// that runs up then craters — it exits into cash and dodges the drawdown.
func TestMomentum_BeatsBuyHold_OnCrash(t *testing.T) {
	// Up-run, then a sustained crash that ends well below the start.
	bars := closes(100, 105, 115, 130, 150, 150, 120, 95, 75, 70)

	bh := Simulate(bars, BuyHold(), start, 0)
	mo := Simulate(bars, MomentumPolicy(3), start, 0)

	if bh.EndEquity >= start {
		t.Fatalf("setup invalid: buy-hold should LOSE here (100→70); got $%.2f", bh.EndEquity)
	}
	if mo.EndEquity <= bh.EndEquity {
		t.Fatalf("momentum should beat buy-hold by dodging the crash; momentum $%.2f vs buy-hold $%.2f",
			mo.EndEquity, bh.EndEquity)
	}
}

// The hindsight ceiling must dominate every realizable policy on the same path.
func TestHindsight_IsCeiling(t *testing.T) {
	bars := closes(100, 105, 115, 130, 150, 150, 120, 95, 75, 70)
	ceiling := HindsightOptimalEquity(bars, start)

	for _, p := range []struct {
		name string
		pol  Policy
	}{
		{"buyhold", BuyHold()},
		{"momentum", MomentumPolicy(3)},
		{"allcash", AllCash()},
	} {
		got := Simulate(bars, p.pol, start, 0).EndEquity
		if got > ceiling+1e-6 {
			t.Fatalf("%s ($%.2f) exceeded the hindsight ceiling ($%.2f) — impossible",
				p.name, got, ceiling)
		}
	}
	if ceiling <= start {
		t.Fatalf("series has up-moves; hindsight ceiling should exceed start; got $%.2f", ceiling)
	}
}

func TestSimulate_Deterministic(t *testing.T) {
	bars := closes(100, 105, 115, 130, 150, 150, 120, 95, 75, 70)
	a := Simulate(bars, MomentumPolicy(3), start, 10)
	b := Simulate(bars, MomentumPolicy(3), start, 10)
	if a.EndEquity != b.EndEquity || len(a.Trace) != len(b.Trace) {
		t.Fatalf("Simulate must be deterministic")
	}
}
