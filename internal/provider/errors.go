package provider

import (
	"errors"
	"fmt"
)

// ProviderError represents a domain error with retry semantics.
// Provides structured error information for provider operations.
type ProviderError struct {
	Provider   string // Which provider failed
	Operation  string // What operation failed ("GetQuote", "HealthCheck")
	StatusCode int    // HTTP status code (0 for non-HTTP errors)
	Err        error  // Underlying error
	Retryable  bool   // Whether error warrants retry
}

// Error implements the error interface
func (e *ProviderError) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("%s %s failed (HTTP %d): %v", e.Provider, e.Operation, e.StatusCode, e.Err)
	}
	return fmt.Sprintf("%s %s failed: %v", e.Provider, e.Operation, e.Err)
}

// Unwrap returns the underlying error for errors.Is and errors.As
func (e *ProviderError) Unwrap() error {
	return e.Err
}

// IsRetryable returns whether this error should be retried
func (e *ProviderError) IsRetryable() bool {
	return e.Retryable
}

// Common provider errors
var (
	ErrRateLimitExceeded    = errors.New("rate limit exceeded")
	ErrAuthenticationFailed = errors.New("authentication failed")
	ErrSymbolNotFound       = errors.New("symbol not found")
	ErrInvalidRequest       = errors.New("invalid request")
	ErrServerError          = errors.New("provider server error")
	ErrNetworkTimeout       = errors.New("network timeout")
	ErrCircuitOpen          = errors.New("circuit breaker open")
)

// NewProviderError creates a new ProviderError with retry semantics based on status code
func NewProviderError(provider, operation string, statusCode int, err error) *ProviderError {
	retryable := isRetryableStatusCode(statusCode)
	return &ProviderError{
		Provider:   provider,
		Operation:  operation,
		StatusCode: statusCode,
		Err:        err,
		Retryable:  retryable,
	}
}

// isRetryableStatusCode determines if an HTTP status code should be retried
// HTTP 429 (rate limit), 500-503 (server errors), and timeouts are retryable
// HTTP 401/403 (auth), 404 (not found), 400 (bad request) are not retryable
func isRetryableStatusCode(statusCode int) bool {
	switch statusCode {
	case 429: // Too Many Requests
		return true
	case 500, 502, 503, 504: // Server errors
		return true
	case 0: // Network errors (timeout, connection refused)
		return true
	case 401, 403: // Authentication/authorization failures
		return false
	case 404: // Not found
		return false
	case 400: // Bad request
		return false
	default:
		return statusCode >= 500 // Retry on server errors
	}
}
