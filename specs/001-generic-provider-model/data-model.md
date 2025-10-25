# Data Model: Generic Provider Model

**Feature**: 001-generic-provider-model
**Date**: 2025-10-19

## Core Entities

### Quote
Standardized real-time stock quote.

**Fields**:
- `Symbol` (string): Stock ticker symbol (e.g., "AAPL")
- `Price` (float64): Current price in dollars
- `Bid` (float64): Bid price
- `Ask` (float64): Ask price
- `Volume` (int64): Trading volume in shares
- `Timestamp` (time.Time): Quote timestamp (UTC)
- `Change` (float64): Absolute price change from previous close (dollars)
- `ChangePercent` (float64): Percentage change as decimal (0.0123 = 1.23%)

**Validation Rules**:
- Symbol: Non-empty, uppercase, alphanumeric
- Price: Must be > 0
- Volume: Must be >= 0
- Timestamp: Must not be in future

---

### Snapshot
Extended market snapshot with daily metrics.

**Fields**:
- Inherits all Quote fields
- `DayOpen` (float64): Opening price for trading day
- `DayHigh` (float64): Highest price for trading day
- `DayLow` (float64): Lowest price for trading day
- `PrevClose` (float64): Previous trading day's close price

**Validation Rules**:
- DayHigh >= DayLow
- DayHigh >= Price >= DayLow (within trading day)

---

### Provider
Represents a market data provider implementation.

**Fields**:
- `Name` (string): Provider identifier ("alphavantage", "polygon", "fmp")
- `Tier` (string): Provider tier ("amateur", "professional", "quantitative")
- `RateLimit` (RateLimitInfo): Rate limiting configuration
- `RefreshInterval` (time.Duration): Data update frequency
- `DataLatency` (string): Data freshness ("realtime", "15min", "eod")
- `SupportedExchanges` ([]string): Exchanges covered (e.g., ["NASDAQ", "NYSE"])

**Relationships**:
- One active Provider per Engine instance
- Provider implements StockProvider interface

---

### ProviderConfig
User configuration for a specific provider.

**Fields**:
- `Name` (string): Which provider to use
- `APIKey` (string): Authentication credential (from env var recommended)
- `BaseURL` (string): API endpoint base URL
- `Timeout` (time.Duration): HTTP request timeout
- `Options` (map[string]string): Provider-specific options

**Validation Rules**:
- Name: Must be registered in provider registry
- APIKey: Non-empty (validated at startup via HealthCheck)
- Timeout: Must be > 0

---

### RateLimitInfo
Rate limiting metadata for a provider.

**Fields**:
- `MaxRequests` (int): Maximum requests allowed
- `Window` (time.Duration): Time window for rate limit
- `Strategy` (string): Algorithm ("token_bucket", "leaky_bucket")

**Example**:
- Alpha Vantage free: MaxRequests=5, Window=1m
- FMP standard: MaxRequests=4, Window=1s (parallel)

---

### ProviderError
Domain error with retry semantics.

**Fields**:
- `Provider` (string): Which provider failed
- `Operation` (string): What operation failed ("GetQuote", "HealthCheck")
- `StatusCode` (int): HTTP status code
- `Err` (error): Underlying error
- `Retryable` (bool): Whether error warrants retry

**State Transitions**:
- HTTP 429/500-503 → Retryable=true
- HTTP 401/403/404/400 → Retryable=false

---

## Interface Contracts

### StockProvider
Primary abstraction for all market data providers.

**Methods**:
```go
GetQuote(ctx context.Context, symbol string) (*Quote, error)
GetQuotes(ctx context.Context, symbols []string) ([]*Quote, error)
Name() string
HealthCheck(ctx context.Context) error
```

**Contract**:
- GetQuote: Returns standardized Quote or ProviderError
- GetQuotes: Batch operation, may use provider's batch API or fan-out
- Name: Returns lowercase provider identifier
- HealthCheck: Validates credentials, returns error if invalid

---

### RateLimiter
Enforces request rate limits.

**Methods**:
```go
Wait(ctx context.Context) error
Allow() bool
```

**Contract**:
- Wait: Blocks until token available or context cancelled
- Allow: Returns true if token immediately available (non-blocking)

---

## Data Flow

```
User Config (YAML)
    ↓
Provider Registry → Create Provider Instance
    ↓
Wrap with Middleware:
    - RateLimitedProvider
    - RetryableProvider
    - CircuitBreakerProvider
    - ObservableProvider
    ↓
Engine.FetchStocks()
    ↓
Provider.GetQuotes(symbols) → [Raw JSON]
    ↓
Normalize to Quote (dollars, int64 volume, UTC time)
    ↓
VM.Execute(screening script, standardized metrics)
    ↓
TUI.Render(matching stocks)
```

---

## Normalization Rules

### Price Fields
- **Input**: String "158.5400" (Alpha Vantage) OR float64 158.54 (FMP/Polygon)
- **Output**: float64 in dollars (158.54)
- **Transform**: Parse string if needed, ensure 2-4 decimal precision

### Volume Fields
- **Input**: String "6640217" (Alpha Vantage) OR int64 (FMP/Polygon)
- **Output**: int64 shares
- **Transform**: Parse string to int64, no decimals

### Percentage Fields
- **Input**: String "1.3618%" (Alpha Vantage) OR float64 1.23 (FMP)
- **Output**: float64 decimal (0.013618)
- **Transform**: Remove "%", divide by 100

### Timestamp Fields
- **Input**: "2023-11-30" (Alpha Vantage) OR Unix int64 (FMP) OR ISO8601 (Polygon)
- **Output**: time.Time in UTC
- **Transform**: Parse format, convert to UTC

---

## State Management

### Engine State
```go
type Engine struct {
    provider StockProvider
    state    map[string]*PreviousTick
    mu       sync.RWMutex
}

type PreviousTick struct {
    Price     float64
    Volume    int64
    Timestamp time.Time
}
```

**Lifecycle**:
1. Startup: Load config, create provider, call HealthCheck()
2. Runtime: Fetch → Normalize → Store in state → Pass to VM
3. Provider Switch: Clear state map (data sources incompatible)
4. Shutdown: Graceful context cancellation

---

## Error States

### Provider Failures
- **Timeout**: Retry with exponential backoff
- **Rate Limit**: Wait based on provider's rate limit window
- **Auth Failure**: Fail fast, display in TUI error panel
- **Not Found**: Log warning, continue with other symbols
- **Circuit Open**: Fail fast, wait for reset timeout

### Data Quality Issues
- **Missing Fields**: Log warning, use zero values
- **Out-of-Range Values**: Validate and reject (e.g., negative price)
- **Stale Timestamps**: Warn if > 1 hour old (for "realtime" providers)

---

## Testing Data

### Mock Quote
```go
&Quote{
    Symbol:        "AAPL",
    Price:         150.00,
    Volume:        1000000,
    Timestamp:     time.Now().UTC(),
    Change:        2.50,
    ChangePercent: 0.0169,
}
```

### Mock Provider Error
```go
&ProviderError{
    Provider:   "alphavantage",
    Operation:  "GetQuote",
    StatusCode: 429,
    Err:        ErrRateLimitExceeded,
    Retryable:  true,
}
```

---

## Summary

**Key Entities**: Quote, Snapshot, Provider, ProviderConfig, RateLimitInfo, ProviderError

**Primary Interface**: StockProvider with 4 methods

**Normalization**: Always dollars, shares (int64), UTC timestamps, percentages as decimals

**State**: Engine maintains previous tick for delta calculations

**Errors**: Typed with retry semantics, displayed in TUI error panel
