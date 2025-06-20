package provider

import "stocktopus/internal/model"

// MarketDataProvider defines the interface for any stock data provider.
// Any provider we want to use (AlphaVantage, Polygon, etc.) MUST implement this interface.
type MarketDataProvider interface {
	FetchStocks() ([]model.Stock, error)
}
