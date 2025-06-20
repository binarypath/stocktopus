package provider

import (
	"math/rand"
	"time"

	"stocktopus/internal/model"
)

// MockProvider is a fake data provider for testing purposes.
// It satisfies the MarketDataProvider interface.
type MockProvider struct{}

// NewMockProvider creates a new instance of our mock provider.
func NewMockProvider() *MockProvider {
	return &MockProvider{}
}

// FetchStocks returns a hardcoded list of stocks.
func (p *MockProvider) FetchStocks() ([]model.Stock, error) {
	// Simulate some light fluctuation for realism
	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	stocks := []model.Stock{
		{Ticker: "AAPL", Price: 175.25 + r.Float64(), Volume: 50123456, Change_1D_pct: 1.2},
		{Ticker: "GOOGL", Price: 140.76 - r.Float64(), Volume: 25000000, Change_1D_pct: -0.5},
		{Ticker: "TSLA", Price: 250.10 + r.Float64(), Volume: 110000000, Change_1D_pct: 3.1},
		{Ticker: "MSFT", Price: 330.50 - r.Float64(), Volume: 35000000, Change_1D_pct: -1.1},
		{Ticker: "AMZN", Price: 135.00 + r.Float64(), Volume: 60000000, Change_1D_pct: 0.8},
	}

	return stocks, nil
}
