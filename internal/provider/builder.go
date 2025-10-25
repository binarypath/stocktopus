package provider

import (
	"context"
	"log/slog"
	"stocktopus/internal/model"
)

// ProviderBuilder composes middleware around a base provider
// Follows the builder pattern for clean, flexible provider construction
//
// Example usage:
//
//	provider := NewProviderBuilder(baseProvider).
//	    WithRateLimit(limiter).
//	    WithRetry(retryConfig).
//	    WithCircuitBreaker(breakerConfig).
//	    WithObservability(logger).
//	    Build()
type ProviderBuilder struct {
	provider StockProvider
}

// NewProviderBuilder creates a new builder with the base provider
func NewProviderBuilder(baseProvider StockProvider) *ProviderBuilder {
	return &ProviderBuilder{
		provider: baseProvider,
	}
}

// WithRateLimit wraps the provider with rate limiting
func (b *ProviderBuilder) WithRateLimit(limiter RateLimiter) *ProviderBuilder {
	b.provider = NewRateLimitedProvider(b.provider, limiter)
	return b
}

// WithRetry wraps the provider with automatic retry logic
func (b *ProviderBuilder) WithRetry(config RetryConfig) *ProviderBuilder {
	b.provider = NewRetryableProvider(b.provider, config)
	return b
}

// WithCircuitBreaker wraps the provider with circuit breaker logic
func (b *ProviderBuilder) WithCircuitBreaker(config CircuitBreakerConfig) *ProviderBuilder {
	b.provider = NewCircuitBreakerProvider(b.provider, config)
	return b
}

// WithObservability wraps the provider with structured logging and metrics
func (b *ProviderBuilder) WithObservability(logger *slog.Logger) *ProviderBuilder {
	b.provider = NewObservableProvider(b.provider, logger)
	return b
}

// Build returns the fully composed provider
func (b *ProviderBuilder) Build() StockProvider {
	return b.provider
}

// RateLimitedProvider wraps a provider with rate limiting
// Note: This is a simple wrapper that integrates the RateLimiter interface
type RateLimitedProvider struct {
	provider  StockProvider
	limiter   RateLimiter
}

// NewRateLimitedProvider creates a provider wrapper with rate limiting
func NewRateLimitedProvider(provider StockProvider, limiter RateLimiter) *RateLimitedProvider {
	return &RateLimitedProvider{
		provider: provider,
		limiter:  limiter,
	}
}

// GetQuote implements StockProvider with rate limiting
func (r *RateLimitedProvider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	// Wait for rate limit token
	if err := r.limiter.Wait(ctx); err != nil {
		return nil, err
	}

	return r.provider.GetQuote(ctx, symbol)
}

// GetQuotes implements StockProvider with rate limiting
func (r *RateLimitedProvider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	// Wait for rate limit token (counts as single batch request)
	if err := r.limiter.Wait(ctx); err != nil {
		return nil, err
	}

	return r.provider.GetQuotes(ctx, symbols)
}

// Name implements StockProvider
func (r *RateLimitedProvider) Name() string {
	return r.provider.Name()
}

// HealthCheck implements StockProvider with rate limiting
func (r *RateLimitedProvider) HealthCheck(ctx context.Context) error {
	// Wait for rate limit token
	if err := r.limiter.Wait(ctx); err != nil {
		return err
	}

	return r.provider.HealthCheck(ctx)
}
