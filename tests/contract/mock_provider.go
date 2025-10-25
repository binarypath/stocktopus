package contract

import (
	"context"
	"stocktopus/internal/model"
	"stocktopus/internal/provider"
	"time"
)

// MockProvider is a test implementation of StockProvider
// Useful for engine testing and integration tests
type MockProvider struct {
	NameValue     string
	QuoteResponse *model.Quote
	QuoteError    error
	HealthError   error
	CallCount     int
}

// NewMockProvider creates a new mock provider with default values
func NewMockProvider() *MockProvider {
	return &MockProvider{
		NameValue: "mock",
	}
}

// GetQuote implements StockProvider
func (m *MockProvider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	m.CallCount++

	if m.QuoteError != nil {
		return nil, m.QuoteError
	}

	if m.QuoteResponse != nil {
		// Return a copy with the requested symbol
		quote := *m.QuoteResponse
		quote.Symbol = symbol
		return &quote, nil
	}

	// Return default quote if no response configured
	return &model.Quote{
		Symbol:        symbol,
		Price:         100.0,
		Volume:        1000000,
		Timestamp:     time.Now().UTC(),
		Change:        1.50,
		ChangePercent: 0.015,
	}, nil
}

// GetQuotes implements StockProvider
func (m *MockProvider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	m.CallCount++

	if m.QuoteError != nil {
		return nil, m.QuoteError
	}

	quotes := make([]*model.Quote, len(symbols))
	for i, symbol := range symbols {
		quote, err := m.GetQuote(ctx, symbol)
		if err != nil {
			return nil, err
		}
		quotes[i] = quote
	}

	return quotes, nil
}

// Name implements StockProvider
func (m *MockProvider) Name() string {
	if m.NameValue == "" {
		return "mock"
	}
	return m.NameValue
}

// HealthCheck implements StockProvider
func (m *MockProvider) HealthCheck(ctx context.Context) error {
	m.CallCount++
	return m.HealthError
}

// Reset resets the mock's state
func (m *MockProvider) Reset() {
	m.CallCount = 0
	m.QuoteError = nil
	m.HealthError = nil
}

// WithQuote configures the mock to return a specific quote
func (m *MockProvider) WithQuote(quote *model.Quote) *MockProvider {
	m.QuoteResponse = quote
	return m
}

// WithError configures the mock to return an error
func (m *MockProvider) WithError(err error) *MockProvider {
	m.QuoteError = err
	return m
}

// WithHealthError configures the mock to return a health check error
func (m *MockProvider) WithHealthError(err error) *MockProvider {
	m.HealthError = err
	return m
}

// Verify that MockProvider implements StockProvider
var _ provider.StockProvider = (*MockProvider)(nil)
