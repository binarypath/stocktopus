package provider

import (
	"context"
	"stocktopus/internal/model"
	"sync"
	"time"
)

// CircuitState represents the current state of the circuit breaker
type CircuitState int

const (
	StateClosed   CircuitState = iota // Normal operation, requests pass through
	StateOpen                          // Circuit open, requests fail fast
	StateHalfOpen                      // Testing if service recovered
)

// CircuitBreakerConfig holds circuit breaker configuration
type CircuitBreakerConfig struct {
	MaxFailures  int           // Number of consecutive failures before opening circuit (default: 5)
	ResetTimeout time.Duration // Time to wait in open state before attempting half-open (default: 60s)
}

// DefaultCircuitBreakerConfig returns sensible defaults
func DefaultCircuitBreakerConfig() CircuitBreakerConfig {
	return CircuitBreakerConfig{
		MaxFailures:  5,
		ResetTimeout: 60 * time.Second,
	}
}

// CircuitBreakerProvider wraps a StockProvider with circuit breaker logic
// Prevents cascading failures by failing fast when provider is consistently down
type CircuitBreakerProvider struct {
	provider        StockProvider
	config          CircuitBreakerConfig
	state           CircuitState
	failures        int
	lastFailureTime time.Time
	mu              sync.RWMutex
}

// NewCircuitBreakerProvider creates a provider wrapper with circuit breaker
func NewCircuitBreakerProvider(provider StockProvider, config CircuitBreakerConfig) *CircuitBreakerProvider {
	return &CircuitBreakerProvider{
		provider: provider,
		config:   config,
		state:    StateClosed,
	}
}

// GetQuote implements StockProvider with circuit breaker logic
func (cb *CircuitBreakerProvider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	if err := cb.beforeRequest(); err != nil {
		return nil, err
	}

	quote, err := cb.provider.GetQuote(ctx, symbol)
	cb.afterRequest(err)

	return quote, err
}

// GetQuotes implements StockProvider with circuit breaker logic
func (cb *CircuitBreakerProvider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	if err := cb.beforeRequest(); err != nil {
		return nil, err
	}

	quotes, err := cb.provider.GetQuotes(ctx, symbols)
	cb.afterRequest(err)

	return quotes, err
}

// Name implements StockProvider
func (cb *CircuitBreakerProvider) Name() string {
	return cb.provider.Name()
}

// HealthCheck implements StockProvider with circuit breaker logic
func (cb *CircuitBreakerProvider) HealthCheck(ctx context.Context) error {
	if err := cb.beforeRequest(); err != nil {
		return err
	}

	err := cb.provider.HealthCheck(ctx)
	cb.afterRequest(err)

	return err
}

// beforeRequest checks circuit state before allowing a request
func (cb *CircuitBreakerProvider) beforeRequest() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		// Normal operation, allow request
		return nil

	case StateOpen:
		// Check if we should transition to half-open
		if time.Since(cb.lastFailureTime) > cb.config.ResetTimeout {
			cb.state = StateHalfOpen
			return nil // Allow test request in half-open state
		}
		// Still in open state, fail fast
		return ErrCircuitOpen

	case StateHalfOpen:
		// Allow single test request
		return nil

	default:
		return ErrCircuitOpen
	}
}

// afterRequest updates circuit state based on request result
func (cb *CircuitBreakerProvider) afterRequest(err error) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err == nil {
		// Success
		cb.onSuccess()
	} else {
		// Failure
		cb.onFailure()
	}
}

// onSuccess handles successful request
func (cb *CircuitBreakerProvider) onSuccess() {
	switch cb.state {
	case StateClosed:
		// Reset failure count on success
		cb.failures = 0

	case StateHalfOpen:
		// Test request succeeded, close circuit
		cb.state = StateClosed
		cb.failures = 0

	case StateOpen:
		// Shouldn't happen, but reset if it does
		cb.state = StateClosed
		cb.failures = 0
	}
}

// onFailure handles failed request
func (cb *CircuitBreakerProvider) onFailure() {
	cb.failures++
	cb.lastFailureTime = time.Now()

	switch cb.state {
	case StateClosed:
		// Check if we've hit failure threshold
		if cb.failures >= cb.config.MaxFailures {
			cb.state = StateOpen
		}

	case StateHalfOpen:
		// Test request failed, reopen circuit
		cb.state = StateOpen
	}
}

// GetState returns the current circuit state (for monitoring)
func (cb *CircuitBreakerProvider) GetState() CircuitState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// Reset manually resets the circuit breaker to closed state
func (cb *CircuitBreakerProvider) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.state = StateClosed
	cb.failures = 0
}
