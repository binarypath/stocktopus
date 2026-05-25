// Package paper implements the rules-enforced manual paper-trading layer:
// per-instrument position sizing math, ticket validation, and the trade
// lifecycle (open → mark → close) backed by the SQLite store.
package paper

import (
	"errors"
	"fmt"
	"math"
)

// InstrumentType discriminates how sizing math should be applied.
type InstrumentType string

const (
	InstrumentEquity InstrumentType = "equity"
	InstrumentFuture InstrumentType = "future"
	InstrumentOption InstrumentType = "option"
	InstrumentCFD    InstrumentType = "cfd"
	InstrumentForex  InstrumentType = "forex"
)

// Side captures direction. Stop is below entry for long, above for short.
type Side string

const (
	SideLong  Side = "long"
	SideShort Side = "short"
)

// TicketInput is everything ComputeSize needs to produce a size.
//
// Conventions per instrument:
//   - equity / cfd      : multiplier=1, entry and stop in quote currency per share
//   - future            : multiplier=contract spec ($/point), e.g. ES=50, CL=1000
//   - option (defined)  : multiplier=100 (US), entry=premium per share, stop=0
//   - forex             : multiplier = currency-per-pip * lot-size, e.g. micro EURUSD = $0.10/pip
type TicketInput struct {
	InstrumentType InstrumentType
	Multiplier     float64
	Side           Side
	EntryPrice     float64
	StopPrice      float64
	AccountSize    float64
	RiskPct        float64 // fraction, 0.02 = 2%
}

// SizingResult is the output of ComputeSize.
type SizingResult struct {
	Size         float64 // whole units (shares or contracts)
	RiskAmount   float64 // currency at risk at this size
	StopDistance float64 // abs(entry - stop) in quote terms
}

var (
	ErrInvalidAccount    = errors.New("account size must be positive")
	ErrInvalidRisk       = errors.New("risk pct must be in (0, 1]")
	ErrInvalidEntry      = errors.New("entry price must be positive")
	ErrInvalidStop       = errors.New("stop price must be non-negative")
	ErrZeroStopDistance  = errors.New("entry equals stop — sizing is undefined")
	ErrInvalidMultiplier = errors.New("multiplier must be positive")
	ErrInvalidSide       = errors.New("side must be long or short")
	ErrSideStopMismatch  = errors.New("long stop must be below entry; short stop must be above entry")
)

// ComputeSize returns the largest whole-unit position that keeps loss-at-stop ≤ account × risk%.
//
// size = floor((account × risk%) / (|entry - stop| × multiplier))
//
// For options modelled as defined-risk longs, set stop=0 — the formula then
// degenerates to size = floor(riskAmount / (premium × 100)) which is the
// premium-paid sizing rule.
func ComputeSize(t TicketInput) (SizingResult, error) {
	if err := validate(t); err != nil {
		return SizingResult{}, err
	}

	stopDistance := math.Abs(t.EntryPrice - t.StopPrice)
	riskBudget := t.AccountSize * t.RiskPct
	perUnitRisk := stopDistance * t.Multiplier

	size := math.Floor(riskBudget / perUnitRisk)
	if size < 0 {
		size = 0
	}

	return SizingResult{
		Size:         size,
		RiskAmount:   size * perUnitRisk,
		StopDistance: stopDistance,
	}, nil
}

func validate(t TicketInput) error {
	if t.AccountSize <= 0 {
		return ErrInvalidAccount
	}
	if t.RiskPct <= 0 || t.RiskPct > 1 {
		return ErrInvalidRisk
	}
	if t.EntryPrice <= 0 {
		return ErrInvalidEntry
	}
	if t.StopPrice < 0 {
		return ErrInvalidStop
	}
	if t.Multiplier <= 0 {
		return ErrInvalidMultiplier
	}
	if t.Side != SideLong && t.Side != SideShort {
		return ErrInvalidSide
	}
	if math.Abs(t.EntryPrice-t.StopPrice) < 1e-9 {
		return ErrZeroStopDistance
	}
	// Side/stop sanity — options stop=0 is allowed for either side.
	if t.StopPrice > 0 {
		if t.Side == SideLong && t.StopPrice >= t.EntryPrice {
			return ErrSideStopMismatch
		}
		if t.Side == SideShort && t.StopPrice <= t.EntryPrice {
			return ErrSideStopMismatch
		}
	}
	return nil
}

// DefaultMultiplier returns a reasonable default per instrument.
// Forex and futures often need user overrides (per contract spec / per lot).
func DefaultMultiplier(it InstrumentType) float64 {
	switch it {
	case InstrumentOption:
		return 100
	case InstrumentEquity, InstrumentCFD:
		return 1
	default:
		return 1
	}
}

// ParseInstrument is a small helper for handler code.
func ParseInstrument(s string) (InstrumentType, error) {
	it := InstrumentType(s)
	switch it {
	case InstrumentEquity, InstrumentFuture, InstrumentOption, InstrumentCFD, InstrumentForex:
		return it, nil
	default:
		return "", fmt.Errorf("unknown instrument type %q", s)
	}
}
