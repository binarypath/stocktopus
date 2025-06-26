package model

// Stock represents a single stock's data.
type Stock struct {
	Ticker        string  // Stock symbol (e.g., "AAPL")
	High          float64 // High price for the current period
	Low           float64 // Low price for the current period
	Open          float64 // Opening price for the current period
	Close         float64 // Closing price for the current period
	Price         float64 // Current price (may be last trade or real-time)
	Volume        int64   // Trading volume for the current period
	Change_1D_pct float64 // Percentage change over the last day
}
