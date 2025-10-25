package model

import "time"

// Stock represents a single stock's data.
// LEGACY: This struct is deprecated in favor of Quote/Snapshot
// TODO: Migrate all code to use Quote/Snapshot instead
type Stock struct {
	Ticker        string
	High          float64
	Low           float64
	Open          float64
	Close         float64
	Price         float64
	Volume        int64
	Change_1D_pct float64
}

// Quote represents a standardized real-time stock quote.
// All providers must normalize their data to this format.
//
// Field conventions:
// - Price: Always in dollars (float64), never cents
// - Volume: Always in shares (int64)
// - ChangePercent: Always as decimal (0.0123 = 1.23%)
// - Timestamp: Always in UTC timezone
//
// Validation rules:
// - Symbol: Non-empty, uppercase, alphanumeric
// - Price: Must be > 0
// - Volume: Must be >= 0
// - Timestamp: Must not be in future
type Quote struct {
	Symbol        string    // Stock ticker symbol (e.g., "AAPL")
	Price         float64   // Current price in dollars
	Bid           float64   // Bid price
	Ask           float64   // Ask price
	Volume        int64     // Trading volume in shares
	Timestamp     time.Time // Quote timestamp (UTC)
	Change        float64   // Absolute price change from previous close (dollars)
	ChangePercent float64   // Percentage change as decimal (0.0123 = 1.23%)
}

// Snapshot represents an extended market snapshot with daily metrics.
// Extends Quote with additional day-level data.
//
// Validation rules (in addition to Quote rules):
// - DayHigh >= DayLow
// - DayHigh >= Price >= DayLow (within trading day)
type Snapshot struct {
	Quote                // Embedded Quote fields
	DayOpen   float64    // Opening price for trading day
	DayHigh   float64    // Highest price for trading day
	DayLow    float64    // Lowest price for trading day
	PrevClose float64    // Previous trading day's close price
}
