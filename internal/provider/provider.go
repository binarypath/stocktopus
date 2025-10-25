package provider

import (
	"context"
	"stocktopus/internal/model"
)

// StockProvider is the core abstraction for all market data providers.
// Every provider implementation MUST implement all methods with the specified contracts.
//
// Contract requirements:
// - GetQuote: Returns standardized Quote or ProviderError
// - GetQuotes: Batch operation, may use provider's batch API or fan-out
// - Name: Returns lowercase provider identifier
// - HealthCheck: Validates credentials, returns error if invalid
type StockProvider interface {
	// GetQuote fetches a single stock quote for the given symbol
	// Returns standardized Quote with all fields populated or ProviderError
	// Must respect context cancellation and return context.Canceled
	GetQuote(ctx context.Context, symbol string) (*model.Quote, error)

	// GetQuotes fetches multiple stock quotes in a single operation
	// Providers MAY optimize this using batch APIs or fan-out requests
	// Returns quotes in same order as input symbols
	// Must respect context cancellation and stop in-flight requests
	GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error)

	// Name returns the lowercase provider identifier
	// Examples: "alphavantage", "polygon", "fmp"
	Name() string

	// HealthCheck validates provider credentials and connectivity
	// Called at startup to fail-fast on configuration issues
	// Must complete within context timeout (typically 5-10 seconds)
	HealthCheck(ctx context.Context) error
}

// Legacy interface - kept for backward compatibility
// TODO: Remove once all code migrated to StockProvider
type MarketDataProvider interface {
	FetchStocks() ([]model.Stock, error)
}
