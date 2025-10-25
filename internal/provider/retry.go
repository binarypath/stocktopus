package provider

import (
	"context"
	"errors"
	"math"
	"math/rand"
	"stocktopus/internal/model"
	"time"
)

// RetryConfig holds retry behavior configuration
type RetryConfig struct {
	MaxAttempts    int           // Maximum number of retry attempts (default: 3)
	InitialBackoff time.Duration // Initial backoff duration (default: 100ms)
	MaxBackoff     time.Duration // Maximum backoff duration (default: 10s)
	Multiplier     float64       // Backoff multiplier (default: 2.0)
	Jitter         bool          // Add random jitter to backoff (default: true)
}

// DefaultRetryConfig returns sensible default retry configuration
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:    3,
		InitialBackoff: 100 * time.Millisecond,
		MaxBackoff:     10 * time.Second,
		Multiplier:     2.0,
		Jitter:         true,
	}
}

// RetryableProvider wraps a StockProvider with automatic retry logic
// Retries transient failures (timeouts, rate limits, server errors) with exponential backoff
// Does not retry permanent failures (auth errors, not found, bad requests)
type RetryableProvider struct {
	provider StockProvider
	config   RetryConfig
}

// NewRetryableProvider creates a provider wrapper with retry logic
func NewRetryableProvider(provider StockProvider, config RetryConfig) *RetryableProvider {
	return &RetryableProvider{
		provider: provider,
		config:   config,
	}
}

// GetQuote implements StockProvider with retry logic
func (r *RetryableProvider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	var lastErr error

	for attempt := 0; attempt < r.config.MaxAttempts; attempt++ {
		quote, err := r.provider.GetQuote(ctx, symbol)
		if err == nil {
			return quote, nil
		}

		lastErr = err

		// Check if error is retryable
		if !isRetryable(err) {
			return nil, err
		}

		// Don't wait after last attempt
		if attempt < r.config.MaxAttempts-1 {
			backoff := r.calculateBackoff(attempt)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
				// Continue to next attempt
			}
		}
	}

	return nil, lastErr
}

// GetQuotes implements StockProvider with retry logic
func (r *RetryableProvider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	var lastErr error

	for attempt := 0; attempt < r.config.MaxAttempts; attempt++ {
		quotes, err := r.provider.GetQuotes(ctx, symbols)
		if err == nil {
			return quotes, nil
		}

		lastErr = err

		// Check if error is retryable
		if !isRetryable(err) {
			return nil, err
		}

		// Don't wait after last attempt
		if attempt < r.config.MaxAttempts-1 {
			backoff := r.calculateBackoff(attempt)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
				// Continue to next attempt
			}
		}
	}

	return nil, lastErr
}

// Name implements StockProvider
func (r *RetryableProvider) Name() string {
	return r.provider.Name()
}

// HealthCheck implements StockProvider with retry logic
func (r *RetryableProvider) HealthCheck(ctx context.Context) error {
	var lastErr error

	for attempt := 0; attempt < r.config.MaxAttempts; attempt++ {
		err := r.provider.HealthCheck(ctx)
		if err == nil {
			return nil
		}

		lastErr = err

		// Check if error is retryable
		if !isRetryable(err) {
			return err
		}

		// Don't wait after last attempt
		if attempt < r.config.MaxAttempts-1 {
			backoff := r.calculateBackoff(attempt)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
				// Continue to next attempt
			}
		}
	}

	return lastErr
}

// calculateBackoff calculates exponential backoff with optional jitter
func (r *RetryableProvider) calculateBackoff(attempt int) time.Duration {
	// Exponential backoff: initialBackoff * multiplier^attempt
	backoff := float64(r.config.InitialBackoff) * math.Pow(r.config.Multiplier, float64(attempt))

	// Cap at max backoff
	if backoff > float64(r.config.MaxBackoff) {
		backoff = float64(r.config.MaxBackoff)
	}

	// Add jitter (0-50% random variation)
	if r.config.Jitter {
		jitter := rand.Float64() * 0.5 // 0-50%
		backoff = backoff * (1 + jitter)
	}

	return time.Duration(backoff)
}

// isRetryable checks if an error should be retried
func isRetryable(err error) bool {
	// Check if it's a ProviderError with Retryable flag
	var providerErr *ProviderError
	if ok := errors.As(err, &providerErr); ok {
		return providerErr.Retryable
	}

	// Default to not retryable for unknown errors
	return false
}
