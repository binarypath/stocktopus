package model

import "time"

// PreMarket is the pre-market session snapshot derived from intraday bars.
// Found is false when no bar falls inside the pre-market window.
type PreMarket struct {
	Found         bool    `json:"found"`
	Price         float64 `json:"price"`
	ChangePercent float64 `json:"changePercent"`
	Time          string  `json:"time"` // RFC3339, UTC
}

// Pre-market window for US equities, in minutes since ET midnight:
// 04:00 (inclusive) through 09:30 (exclusive). 09:30 is the regular-session
// opening auction and is deliberately excluded.
const (
	preMarketStartMin = 4 * 60    // 04:00 ET
	preMarketEndMin   = 9*60 + 30 // 09:30 ET
	preMarketLayout   = "2006-01-02 15:04:05"
)

// ExtractPreMarket scans intraday 5-minute bars and returns the last bar that
// falls within the pre-market window [04:00, 09:30) ET, together with its
// percentage change versus the previous regular-session close.
//
// Bars carry FMP-style "2006-01-02 15:04:05" timestamps expressed in ET
// wall-clock with no offset. loc is the location those wall-clock strings are
// interpreted in (America/New_York in production); it governs the ET→UTC
// conversion of the returned Time. The window selection itself reads only the
// hour/minute of each bar, so it is independent of loc.
//
// The function is pure: no network, no clock, no globals. When no bar lands in
// the window (or all timestamps are unparseable) it returns PreMarket{Found:false}.
func ExtractPreMarket(bars []OHLCV, prevClose float64, loc *time.Location) PreMarket {
	if loc == nil {
		loc = time.UTC
	}

	var best time.Time
	var bestPrice float64
	found := false

	for _, b := range bars {
		t, err := time.ParseInLocation(preMarketLayout, b.Date, loc)
		if err != nil {
			continue
		}
		tod := t.Hour()*60 + t.Minute()
		if tod < preMarketStartMin || tod >= preMarketEndMin {
			continue
		}
		// Keep the chronologically latest pre-market bar.
		if !found || t.After(best) {
			best = t
			bestPrice = b.Close
			found = true
		}
	}

	if !found {
		return PreMarket{Found: false}
	}

	pct := 0.0
	if prevClose > 0 {
		pct = (bestPrice - prevClose) / prevClose * 100
	}

	return PreMarket{
		Found:         true,
		Price:         bestPrice,
		ChangePercent: pct,
		Time:          best.UTC().Format(time.RFC3339),
	}
}
