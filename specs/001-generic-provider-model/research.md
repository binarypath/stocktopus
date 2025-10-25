# Research: Generic Provider Model for Market Data

**Date**: 2025-10-19
**Feature**: 001-generic-provider-model

## Executive Summary

This document consolidates research findings for implementing a pluggable provider abstraction for stock market data APIs. Research covered three provider APIs (Alpha Vantage, Financial Modeling Prep, Polygon.io) and Go best practices for building production-ready, testable provider systems.

## Provider API Research

### 1. Alpha Vantage (Amateur Tier)

**Decision**: Use Alpha Vantage as the free/amateur-tier provider

**Rationale**:
- Free tier available (25 requests/day, 5 requests/minute)
- Simple query parameter authentication
- JSON response format
- Good documentation
- Suitable for hobby/learning use cases

**Key Implementation Details**:
- Authentication: Query parameter (`?apikey=YOUR_API_KEY`)
- Rate Limits: 5 req/min (free), up to 1200 req/min (premium $249.99/month)
- Endpoint: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={symbol}&apikey={key}`
- Response: Returns prices in dollars (4 decimal places), all fields as strings requiring parsing
- Data Refresh: End-of-day only for free tier (no real-time)
- Error Handling: Returns HTTP 200 for errors - must check response body for "Error Message", "Note", or "Information" fields

**Response Structure**:
```json
{
  "Global Quote": {
    "01. symbol": "IBM",
    "05. price": "158.5400",
    "06. volume": "6640217",
    "07. latest trading day": "2023-11-30",
    "09. change": "2.1300",
    "10. change percent": "1.3618%"
  }
}
```

**Alternatives Considered**: Tiingo, TradingView - rejected due to less comprehensive free tier

---

### 2. Financial Modeling Prep (Quantitative Tier)

**Decision**: Use FMP as the quantitative/professional-tier provider

**Rationale**:
- Excellent for algo trading (comprehensive historical data, WebSocket support on Ultimate plan)
- 4 parallel requests/second rate limit
- Rich data model (50+ fields including P/E, EPS, market cap, moving averages)
- Batch request support (multiple symbols comma-separated)
- Good Go library ecosystem

**Key Implementation Details**:
- Authentication: Query parameter (`?apikey=YOUR_API_KEY`)
- Rate Limits: 4 parallel requests/second, 10 calls/second max
- Bandwidth Limits: 500MB (free) to 1TB+ (enterprise) per 30-day rolling window
- Endpoint: `https://financialmodelingprep.com/api/v3/quote/{symbol}?apikey={key}`
- Response: JSON array (even for single symbol), numeric fields as float64/int64
- Data Refresh: Real-time on Ultimate plan, 15-minute delay on lower tiers
- WebSocket: Available on Ultimate plan for unlimited streaming

**Response Structure**:
```json
[{
  "symbol": "AAPL",
  "price": 178.45,
  "changesPercentage": 1.23,
  "volume": 52134567,
  "dayLow": 176.28,
  "dayHigh": 179.12,
  "timestamp": 1699435459
}]
```

**Alternatives Considered**: Alpaca - rejected as FMP has broader fundamental data coverage

---

### 3. Polygon.io (Professional Tier)

**Decision**: Refactor existing Polygon integration to implement StockProvider interface

**Rationale**:
- Already integrated in codebase (`internal/provider/polygon/polygon.go`)
- Professional/institutional quality
- Real-time data available
- Good balance of cost and features

**Key Implementation Details**:
- Authentication: Query parameter or header (more flexible)
- Rate Limits: Tier-dependent (5 req/min basic to unlimited enterprise)
- Endpoint: `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}`
- Response: Nested JSON structure
- Data Refresh: Real-time on paid tiers

---

## Go Provider Pattern Best Practices

### Interface Design

**Decision**: Define `StockProvider` interface with context-aware methods

```go
type StockProvider interface {
    GetQuote(ctx context.Context, symbol string) (*Quote, error)
    GetQuotes(ctx context.Context, symbols []string) ([]*Quote, error)
    Name() string
    HealthCheck(ctx context.Context) error
}
```

**Rationale**:
- Context enables cancellation and timeouts
- Batch method (`GetQuotes`) optimizes for providers supporting bulk requests
- `Name()` enables provider identification in logs
- `HealthCheck()` validates credentials at startup (fail-fast principle)

**Standardized Metric Model**:
```go
type Quote struct {
    Symbol    string
    Price     float64   // Always in dollars
    Volume    int64     // Always in shares
    Timestamp time.Time // Normalized to UTC
    Change    float64   // Absolute change in dollars
    ChangePercent float64 // As decimal (0.0123 = 1.23%)
}
```

---

### Error Handling Strategy

**Decision**: Custom error types with retry semantics

```go
type ProviderError struct {
    Provider   string
    Operation  string
    StatusCode int
    Err        error
    Retryable  bool  // Critical for exponential backoff
}
```

**Exponential Backoff Configuration**:
- MaxRetries: 3
- InitialBackoff: 100ms
- MaxBackoff: 10s
- Multiplier: 2.0
- Jitter: true (0-50% randomization to avoid thundering herd)

**Retryable Errors**:
- HTTP 429 (rate limit)
- HTTP 500-503 (server errors)
- Network timeouts
- Connection refused

**Non-Retryable Errors**:
- HTTP 401/403 (auth failures - fail fast)
- HTTP 404 (symbol not found)
- HTTP 400 (malformed request)

---

### Rate Limiting Implementation

**Decision**: Token bucket algorithm with configurable strategies

**Token Bucket for Alpha Vantage (5 req/min)**:
```go
rateLimiter := NewTokenBucket(5, 12*time.Second) // 1 token every 12 seconds
```

**Token Bucket for FMP (4 parallel/sec)**:
```go
rateLimiter := NewTokenBucket(4, 250*time.Millisecond) // 4 tokens, refill every 250ms
```

**Rationale**:
- Token bucket allows burst traffic up to capacity
- Simple to reason about and test
- Standard `golang.org/x/time/rate` package available as alternative
- Prevents API quota exhaustion (critical per clarification #3)

---

### HTTP Client Configuration

**Decision**: Properly configured client with connection pooling

```go
HTTPClientConfig{
    Timeout:               30 * time.Second,
    MaxIdleConns:          100,
    MaxIdleConnsPerHost:   10,
    IdleConnTimeout:       90 * time.Second,
    TLSHandshakeTimeout:   10 * time.Second,
}
```

**Rationale**:
- Connection pooling reduces latency for repeated requests
- Timeouts prevent hung requests
- TLS 1.2+ for security
- HTTP/2 support for multiplexing

---

### Testing Strategy

**Decision**: Three-tier testing approach

1. **Contract Tests**: Validate interface compliance
   ```go
   // tests/contract/provider_test.go
   func TestProviderContract(t *testing.T, provider StockProvider)
   ```

2. **Integration Tests**: Test against mock HTTP servers
   ```go
   // Use httptest.NewServer to simulate provider APIs
   ```

3. **Unit Tests**: Table-driven tests for normalization logic
   ```go
   tests := []struct {
       name     string
       input    string // Raw provider response
       expected *Quote
       wantErr  bool
   }{...}
   ```

**Mock Provider** for engine testing:
```go
type MockProvider struct {
    QuoteResponse *Quote
    QuoteError    error
    CallCount     int
}
```

---

### Configuration Management

**Decision**: YAML config with environment variable overrides

```yaml
provider:
  name: polygon                  # alphavantage, polygon, fmp
  apiKey: ${STOCK_API_KEY}      # From env var
  timeout: 30s

rateLimit:
  enabled: true
  strategy: token_bucket
  maxRequests: 5
  window: 1m
```

**Environment Variables**:
- `STOCK_API_KEY`: API credentials (never commit to repo)
- `STOCK_PROVIDER`: Override configured provider
- `RATE_LIMIT_MAX_REQUESTS`: Override rate limits

**Rationale**:
- Secrets never in version control
- Easy local development vs production configuration
- Validation on startup prevents runtime surprises

---

### Concurrent Request Patterns

**Decision**: Worker pool with bounded concurrency

```go
type BatchFetcher struct {
    provider    StockProvider
    workerCount int  // Typically 4 for FMP, 1 for AlphaVantage
}

func (bf *BatchFetcher) FetchAll(ctx context.Context, symbols []string) ([]*Quote, error)
```

**Rationale**:
- Respects provider rate limits via `workerCount`
- Channel-based communication prevents race conditions
- Context cancellation propagates to all workers
- Failed symbols don't block others (error collection)

---

### Circuit Breaker Pattern

**Decision**: Implement circuit breaker for provider resilience

```go
CircuitBreakerConfig{
    MaxFailures:  5,           // Open after 5 failures
    ResetTimeout: 60*time.Second, // Try half-open after 60s
}
```

**States**:
- Closed: Normal operation
- Open: All requests fail fast with `ErrCircuitOpen`
- Half-Open: Allow one test request

**Rationale**:
- Prevents cascading failures when provider is down
- Reduces unnecessary API calls during outages
- Automatic recovery detection (half-open → closed transition)
- Aligns with clarification #1 (retry with exponential backoff, then fail)

---

### Observability Implementation

**Decision**: Structured logging with metrics collection

```go
logger.Info("fetching quote",
    slog.String("provider", "polygon"),
    slog.String("symbol", "AAPL"),
    slog.Duration("duration", duration),
)
```

**Metrics**:
- Request count per provider/operation
- Error count per provider
- Average latency per provider
- Rate limit hit count
- Circuit breaker state changes

**Rationale**:
- Structured logs enable log aggregation/search
- Metrics inform capacity planning
- Provider-specific metrics enable comparison
- Satisfies Constitution Principle V (Observability)

---

### Provider Registry Pattern

**Decision**: Factory pattern with auto-registration

```go
func init() {
    provider.Register("alphavantage", func(config interface{}) (StockProvider, error) {
        cfg := config.(AlphaVantageConfig)
        return NewAlphaVantageProvider(cfg), nil
    })
}
```

**Usage**:
```go
provider, err := provider.Create("alphavantage", config)
```

**Builder Pattern for Middleware**:
```go
provider := NewProviderBuilder(baseProvider).
    WithRateLimit(limiter).
    WithRetry(retryConfig).
    WithCircuitBreaker(breaker).
    WithObservability(logger, metrics).
    Build()
```

**Rationale**:
- Adding new providers requires no changes to engine
- Middleware composability (rate limit + retry + circuit breaker + observability)
- Testable in isolation
- Clear separation of concerns

---

## Data Normalization Requirements

### Price Normalization

| Provider | Raw Format | Normalized |
|----------|------------|------------|
| Alpha Vantage | `"158.5400"` (string) | `158.54` (float64) |
| FMP | `178.45` (float64) | `178.45` (float64) |
| Polygon | `158.54` (float64) | `158.54` (float64) |

**Rule**: Always dollars, never cents. Parse strings to float64.

### Volume Normalization

| Provider | Raw Format | Normalized |
|----------|------------|------------|
| Alpha Vantage | `"6640217"` (string) | `6640217` (int64) |
| FMP | `52134567` (int64) | `52134567` (int64) |
| Polygon | `100000` (int) | `100000` (int64) |

**Rule**: Always integer shares traded. Parse strings to int64.

### Percentage Normalization

| Provider | Raw Format | Normalized |
|----------|------------|------------|
| Alpha Vantage | `"1.3618%"` (string with %) | `0.013618` (float64) |
| FMP | `1.23` (float64, already %) | `0.0123` (float64) |
| Polygon | `1.5` (float64) | `0.015` (float64) |

**Rule**: Always decimal (1.5% = 0.015). Remove % symbols, divide by 100 if needed.

### Timestamp Normalization

| Provider | Raw Format | Normalized |
|----------|------------|------------|
| Alpha Vantage | `"2023-11-30"` | `time.Time` (EOD, UTC) |
| FMP | `1699435459` (Unix) | `time.Time` (UTC) |
| Polygon | ISO 8601 | `time.Time` (UTC) |

**Rule**: Always `time.Time` in UTC timezone.

---

## Provider Capabilities Metadata

Each provider implementation should expose capabilities:

```go
type ProviderMeta struct {
    Name         string
    Tier         string  // "amateur", "professional", "quantitative"
    RateLimit    RateLimitInfo
    DataLatency  string  // "realtime", "15min", "eod"
    BatchSupport bool
    WebSocketSupport bool
}
```

**Alpha Vantage**:
- Tier: amateur
- RateLimit: 5 req/min (free), 1200 req/min (premium)
- DataLatency: eod (free), realtime (premium)
- BatchSupport: false
- WebSocketSupport: false

**Financial Modeling Prep**:
- Tier: quantitative
- RateLimit: 4 parallel/sec
- DataLatency: 15min (standard), realtime (ultimate)
- BatchSupport: true
- WebSocketSupport: true (Ultimate plan)

**Polygon**:
- Tier: professional
- RateLimit: tier-dependent
- DataLatency: realtime (paid), eod (free)
- BatchSupport: true
- WebSocketSupport: true

---

## Proactive Rate Adaptation (Clarification #3)

**Requirement**: System should proactively adapt refresh rates to provider plan capabilities to prevent quota exhaustion.

**Implementation Strategy**:

```go
type RefreshStrategy struct {
    Provider      StockProvider
    Capabilities  ProviderMeta
    RefreshRate   time.Duration // Computed from capabilities
}

func (rs *RefreshStrategy) ComputeRefreshRate() time.Duration {
    switch rs.Capabilities.DataLatency {
    case "realtime":
        // Match provider rate limit
        return rs.Capabilities.RateLimit.Window / time.Duration(rs.Capabilities.RateLimit.MaxRequests)
    case "15min":
        return 15 * time.Minute
    case "eod":
        return 24 * time.Hour
    }
}
```

**Example**:
- Alpha Vantage free (5 req/min, EOD): Refresh every 12 seconds OR every 24 hours (whichever is less wasteful)
- FMP Ultimate (4/sec, realtime): Refresh every 250ms
- Polygon premium (unlimited, realtime): Refresh every 1-5 seconds based on UI update rate

**Rationale**:
- Prevents users from hitting limits ("time costs money" - clarification #3)
- Maximizes data freshness within plan constraints
- Transparent to screening scripts (engine handles refresh timing)

---

## TUI Error Panel Requirements (Clarification #1)

**Requirement**: Display provider errors, warnings, and status in real-time TUI component.

**Component Spec**:
```go
type ErrorPanel struct {
    Errors   []ErrorMessage
    MaxSize  int // Circular buffer (e.g., last 50 errors)
}

type ErrorMessage struct {
    Timestamp time.Time
    Level     string  // "error", "warning", "info"
    Provider  string
    Message   string
    Retries   int     // How many retries attempted
}
```

**Display Format**:
```
┌─ Provider Status ──────────────────────────────┐
│ [INFO] polygon: Connected (latency: 120ms)     │
│ [WARN] alphavantage: Rate limit (retry in 10s) │
│ [ERROR] fmp: Auth failed (check API key)       │
└────────────────────────────────────────────────┘
```

**Integration**: Engine publishes errors to channel, TUI subscribes and updates panel.

---

## Mid-Session Provider Switching (Clarification #5)

**Requirement**: Allow provider switching mid-session with data inconsistency warning.

**Implementation**:

```go
func (e *Engine) SwitchProvider(ctx context.Context, newProvider StockProvider) error {
    // Display warning in TUI
    e.tui.ShowWarning("Switching providers may cause data inconsistency. " +
        "Results from different providers may not be directly comparable.")

    // Wait for current fetch to complete
    e.mu.Lock()
    defer e.mu.Unlock()

    // Swap provider
    e.provider = newProvider

    // Clear cached state (since data sources differ)
    e.state = make(map[string]*PreviousTick)

    // Log switch
    e.logger.Info("provider switched",
        slog.String("to", newProvider.Name()))

    return nil
}
```

**Warning Display**: Prominently show in TUI error panel for 10 seconds, require user acknowledgment.

---

## Summary & Next Steps

**Key Decisions**:
1. Three providers: Alpha Vantage (amateur), Polygon (professional), FMP (quantitative)
2. StockProvider interface with context-aware methods
3. Token bucket rate limiting
4. Exponential backoff retry (3 attempts, 100ms-10s)
5. Circuit breaker (5 failures → open, 60s reset)
6. YAML config + env var overrides
7. Structured logging + metrics
8. Factory registry + builder middleware pattern
9. Proactive refresh rate adaptation to provider capabilities
10. TUI error panel for real-time feedback

**Ready for Phase 1**: Data model design, contract definitions, and quickstart documentation.
