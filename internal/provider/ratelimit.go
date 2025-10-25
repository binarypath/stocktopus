package provider

import (
	"context"
	"sync"
	"time"
)

// RateLimiter enforces request rate limits.
type RateLimiter interface {
	// Wait blocks until a token is available or context is cancelled
	// Returns error if context is cancelled before token is available
	Wait(ctx context.Context) error

	// Allow returns true if a token is immediately available (non-blocking)
	// Returns false if no tokens available
	Allow() bool
}

// TokenBucketLimiter implements a token bucket rate limiting algorithm
// Allows burst traffic up to capacity, refills tokens over time
type TokenBucketLimiter struct {
	tokens    float64       // Current number of tokens
	capacity  float64       // Maximum tokens (bucket capacity)
	refillPer time.Duration // Time to refill one token
	lastCheck time.Time     // Last time tokens were refilled
	mu        sync.Mutex
}

// NewTokenBucketLimiter creates a new token bucket rate limiter
// maxRequests: Maximum number of requests allowed (bucket capacity)
// window: Time window for the rate limit
//
// Example: NewTokenBucketLimiter(5, 1*time.Minute) = 5 requests per minute
func NewTokenBucketLimiter(maxRequests int, window time.Duration) *TokenBucketLimiter {
	refillPer := window / time.Duration(maxRequests)
	return &TokenBucketLimiter{
		tokens:    float64(maxRequests),
		capacity:  float64(maxRequests),
		refillPer: refillPer,
		lastCheck: time.Now(),
	}
}

// Wait blocks until a token is available or context is cancelled
func (tb *TokenBucketLimiter) Wait(ctx context.Context) error {
	for {
		tb.mu.Lock()

		// Refill tokens based on elapsed time
		now := time.Now()
		elapsed := now.Sub(tb.lastCheck)
		tokensToAdd := float64(elapsed) / float64(tb.refillPer)
		tb.tokens = min(tb.capacity, tb.tokens+tokensToAdd)
		tb.lastCheck = now

		// Check if we have a token available
		if tb.tokens >= 1.0 {
			tb.tokens--
			tb.mu.Unlock()
			return nil
		}

		// Calculate exact wait time for next token
		deficit := 1.0 - tb.tokens
		waitTime := time.Duration(deficit * float64(tb.refillPer))
		tb.mu.Unlock()

		// Wait for next token or context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(waitTime):
			// Try again
		}
	}
}

// Allow returns true if a token is immediately available
func (tb *TokenBucketLimiter) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	// Refill tokens based on elapsed time
	now := time.Now()
	elapsed := now.Sub(tb.lastCheck)
	tokensToAdd := float64(elapsed) / float64(tb.refillPer)

	tb.tokens = min(tb.capacity, tb.tokens+tokensToAdd)
	tb.lastCheck = now

	// Check if we have a token available
	if tb.tokens >= 1.0 {
		tb.tokens--
		return true
	}

	return false
}

// min returns the minimum of two float64 values
func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
