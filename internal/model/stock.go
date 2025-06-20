package model

// Stock represents a single stock's data.
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
