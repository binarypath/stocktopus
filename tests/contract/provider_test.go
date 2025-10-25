package contract

import (
	"context"
	"errors"
	"stocktopus/internal/provider"
	"strings"
	"testing"
	"time"
	"unicode"
)

// TestProviderContract runs the contract test suite against any StockProvider implementation
// All providers MUST pass these tests to ensure they comply with the StockProvider interface contract
//
// Usage:
//
//	func TestAlphaVantageProvider(t *testing.T) {
//	    prov := alphavantage.NewProvider(config)
//	    contract.RunProviderContractTests(t, prov)
//	}
func RunProviderContractTests(t *testing.T, prov provider.StockProvider) {
	ctx := context.Background()

	t.Run("GetQuote_ValidSymbol_ReturnsQuote", func(t *testing.T) {
		quote, err := prov.GetQuote(ctx, "AAPL")
		if err != nil {
			t.Fatalf("GetQuote failed: %v", err)
		}

		if quote == nil {
			t.Fatal("GetQuote returned nil quote")
		}

		// Validate required fields
		if quote.Symbol == "" {
			t.Error("Quote.Symbol is empty")
		}
		if quote.Price <= 0 {
			t.Error("Quote.Price must be > 0")
		}
		if quote.Volume < 0 {
			t.Error("Quote.Volume must be >= 0")
		}
		if quote.Timestamp.IsZero() {
			t.Error("Quote.Timestamp is zero")
		}
		if quote.Timestamp.After(time.Now().UTC()) {
			t.Error("Quote.Timestamp is in the future")
		}
	})

	t.Run("GetQuote_InvalidSymbol_ReturnsError", func(t *testing.T) {
		_, err := prov.GetQuote(ctx, "INVALID_SYMBOL_XYZ")
		if err == nil {
			t.Error("GetQuote should return error for invalid symbol")
		}

		// Should be a non-retryable error (404)
		var provErr *provider.ProviderError
		if errors.As(err, &provErr) {
			if provErr.Retryable {
				t.Error("Symbol not found error should not be retryable")
			}
		}
	})

	t.Run("GetQuote_ContextCanceled_ReturnsError", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel() // Cancel immediately

		_, err := prov.GetQuote(ctx, "AAPL")
		if err == nil {
			t.Error("GetQuote should return error when context is canceled")
		}
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Expected context.Canceled error, got: %v", err)
		}
	})

	t.Run("GetQuotes_ValidSymbols_ReturnsAllQuotes", func(t *testing.T) {
		symbols := []string{"AAPL", "MSFT", "GOOGL"}
		quotes, err := prov.GetQuotes(ctx, symbols)
		if err != nil {
			t.Fatalf("GetQuotes failed: %v", err)
		}

		if len(quotes) != len(symbols) {
			t.Errorf("Expected %d quotes, got %d", len(symbols), len(quotes))
		}

		// Validate each quote
		for i, quote := range quotes {
			if quote == nil {
				continue // Partial success allowed
			}

			if quote.Symbol != symbols[i] {
				t.Errorf("Quote %d: expected symbol %s, got %s", i, symbols[i], quote.Symbol)
			}
			if quote.Price <= 0 {
				t.Errorf("Quote %d: Price must be > 0", i)
			}
		}
	})

	t.Run("GetQuotes_EmptyList_ReturnsEmpty", func(t *testing.T) {
		quotes, err := prov.GetQuotes(ctx, []string{})
		if err != nil {
			t.Fatalf("GetQuotes with empty list failed: %v", err)
		}

		if len(quotes) != 0 {
			t.Errorf("Expected empty quotes, got %d", len(quotes))
		}
	})

	t.Run("Name_ReturnsLowercaseString", func(t *testing.T) {
		name := prov.Name()
		if name == "" {
			t.Error("Name() returned empty string")
		}

		// Validate lowercase
		if name != strings.ToLower(name) {
			t.Errorf("Name() should return lowercase, got: %s", name)
		}

		// Validate alphanumeric
		for _, c := range name {
			if !unicode.IsLetter(c) && !unicode.IsNumber(c) {
				t.Errorf("Name() should be alphanumeric, got: %s", name)
				break
			}
		}
	})

	t.Run("HealthCheck_ValidCredentials_ReturnsNil", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		err := prov.HealthCheck(ctx)
		if err != nil {
			t.Fatalf("HealthCheck failed: %v", err)
		}
	})
}
