# Contract: StockProvider Interface

**Feature**: 001-generic-provider-model
**Date**: 2025-10-19

## Interface Definition

The `StockProvider` interface is the core abstraction for all market data providers. Every provider implementation MUST implement all methods with the specified contracts.

```go
type StockProvider interface {
    // GetQuote fetches a single stock quote for the given symbol
    GetQuote(ctx context.Context, symbol string) (*Quote, error)

    // GetQuotes fetches multiple stock quotes in a single operation
    // Providers MAY optimize this using batch APIs or fan-out requests
    GetQuotes(ctx context.Context, symbols []string) ([]*Quote, error)

    // Name returns the lowercase provider identifier
    // Examples: "alphavantage", "polygon", "fmp"
    Name() string

    // HealthCheck validates provider credentials and connectivity
    // Called at startup to fail-fast on configuration issues
    HealthCheck(ctx context.Context) error
}
```

---

## Method Contracts

### GetQuote

**Purpose**: Fetch real-time or most recent quote for a single stock symbol

**Input**:
- `ctx context.Context`: Cancellation context (MUST respect cancellation)
- `symbol string`: Stock ticker symbol (e.g., "AAPL", "MSFT")

**Output**:
- `*Quote`: Standardized quote data (see data-model.md)
- `error`: ProviderError if operation fails, nil on success

**Behavior**:
- MUST return normalized Quote with all fields populated (see data-model.md)
- MUST respect context cancellation and return context.Canceled
- MUST return ProviderError with Retryable=true for transient failures (429, 500-503, timeouts)
- MUST return ProviderError with Retryable=false for permanent failures (401, 403, 404, 400)
- MUST NOT cache results - always fetch fresh data
- Symbol lookup MUST be case-insensitive but return Quote.Symbol in uppercase

**Example Success**:
```go
quote, err := provider.GetQuote(ctx, "AAPL")
// quote = &Quote{
//     Symbol: "AAPL",
//     Price: 178.45,
//     Volume: 52134567,
//     Timestamp: time.Now().UTC(),
//     Change: 2.34,
//     ChangePercent: 0.0133,
// }
// err = nil
```

**Example Failure (Rate Limit)**:
```go
quote, err := provider.GetQuote(ctx, "AAPL")
// quote = nil
// err = &ProviderError{
//     Provider: "alphavantage",
//     Operation: "GetQuote",
//     StatusCode: 429,
//     Err: ErrRateLimitExceeded,
//     Retryable: true,
// }
```

**Example Failure (Invalid Symbol)**:
```go
quote, err := provider.GetQuote(ctx, "INVALID")
// quote = nil
// err = &ProviderError{
//     Provider: "polygon",
//     Operation: "GetQuote",
//     StatusCode: 404,
//     Err: ErrSymbolNotFound,
//     Retryable: false,
// }
```

---

### GetQuotes

**Purpose**: Fetch quotes for multiple symbols, optimized for batch operations

**Input**:
- `ctx context.Context`: Cancellation context (MUST respect cancellation)
- `symbols []string`: Stock ticker symbols (e.g., ["AAPL", "MSFT", "GOOGL"])

**Output**:
- `[]*Quote`: Array of normalized quotes (same order as input symbols)
- `error`: ProviderError if operation fails completely, nil on success

**Behavior**:
- MUST return quotes in the same order as input symbols
- MUST use provider's batch API if available (e.g., FMP comma-separated symbols)
- MAY fan out to multiple GetQuote calls if no batch API exists
- MUST respect context cancellation and stop in-flight requests
- If one symbol fails, implementation MAY either:
  - Return partial results (successful quotes) with nil entries for failed symbols
  - Return error if any symbol fails (fail-fast approach)
- RECOMMENDED: Return partial results for transient failures, fail-fast for auth failures
- MUST apply rate limiting across all requests in the batch

**Example Success (All Symbols)**:
```go
quotes, err := provider.GetQuotes(ctx, []string{"AAPL", "MSFT"})
// quotes = []*Quote{
//     {Symbol: "AAPL", Price: 178.45, ...},
//     {Symbol: "MSFT", Price: 389.12, ...},
// }
// err = nil
```

**Example Partial Success**:
```go
quotes, err := provider.GetQuotes(ctx, []string{"AAPL", "INVALID", "MSFT"})
// quotes = []*Quote{
//     {Symbol: "AAPL", Price: 178.45, ...},
//     nil,  // INVALID symbol not found
//     {Symbol: "MSFT", Price: 389.12, ...},
// }
// err = nil (partial success allowed)
```

**Example Complete Failure (Auth)**:
```go
quotes, err := provider.GetQuotes(ctx, []string{"AAPL", "MSFT"})
// quotes = nil
// err = &ProviderError{
//     Provider: "fmp",
//     Operation: "GetQuotes",
//     StatusCode: 401,
//     Err: ErrAuthenticationFailed,
//     Retryable: false,
// }
```

---

### Name

**Purpose**: Return unique lowercase provider identifier for logging and diagnostics

**Input**: None

**Output**: `string` - Provider name

**Behavior**:
- MUST return lowercase alphanumeric identifier
- MUST be unique across all registered providers
- MUST be stable across application restarts
- RECOMMENDED: Match configuration file provider key

**Examples**:
```go
provider.Name() // "alphavantage"
provider.Name() // "polygon"
provider.Name() // "fmp"
```

---

### HealthCheck

**Purpose**: Validate provider configuration and credentials at startup

**Input**:
- `ctx context.Context`: Timeout context (typically 5-10 seconds)

**Output**:
- `error`: Error if provider is not healthy, nil if ready

**Behavior**:
- MUST validate API credentials (make test API call)
- MUST verify network connectivity to provider endpoints
- MUST complete within context timeout
- MUST return descriptive error messages for debugging
- SHOULD use lightweight endpoint (e.g., account info, not full quote)
- Called once at application startup (fail-fast principle)

**Example Success**:
```go
err := provider.HealthCheck(ctx)
// err = nil (provider ready)
```

**Example Failure (Invalid API Key)**:
```go
err := provider.HealthCheck(ctx)
// err = &ProviderError{
//     Provider: "alphavantage",
//     Operation: "HealthCheck",
//     StatusCode: 401,
//     Err: errors.New("invalid API key"),
//     Retryable: false,
// }
```

**Example Failure (Network Timeout)**:
```go
err := provider.HealthCheck(ctx)
// err = &ProviderError{
//     Provider: "polygon",
//     Operation: "HealthCheck",
//     StatusCode: 0,
//     Err: context.DeadlineExceeded,
//     Retryable: true,
// }
```

---

## Implementation Requirements

All StockProvider implementations MUST:

1. **Context Handling**:
   - Respect context cancellation in all methods
   - Propagate context to HTTP requests
   - Return context.Canceled or context.DeadlineExceeded when appropriate

2. **Error Handling**:
   - Return typed ProviderError (not generic errors)
   - Set Retryable flag correctly (see data-model.md)
   - Include HTTP status codes when available
   - Provide actionable error messages

3. **Data Normalization**:
   - Always return prices in dollars (float64)
   - Always return volumes in shares (int64)
   - Always return percentages as decimals (0.0123 = 1.23%)
   - Always return timestamps in UTC
   - Validate Quote fields before returning

4. **Thread Safety**:
   - All methods MUST be safe for concurrent calls
   - Use appropriate synchronization for shared state
   - Rate limiters MUST be thread-safe

5. **Observability**:
   - Log all API calls with provider name, operation, symbol(s)
   - Log errors with full context
   - Emit metrics for request count, latency, errors

---

## Testing Requirements

### Contract Tests

All providers MUST pass the following contract tests:

```go
// tests/contract/provider_test.go

func TestProviderContract(t *testing.T, newProvider func() StockProvider) {
    t.Run("GetQuote_ValidSymbol_ReturnsQuote", ...)
    t.Run("GetQuote_InvalidSymbol_ReturnsError", ...)
    t.Run("GetQuote_ContextCanceled_ReturnsError", ...)

    t.Run("GetQuotes_ValidSymbols_ReturnsAllQuotes", ...)
    t.Run("GetQuotes_EmptyList_ReturnsEmpty", ...)

    t.Run("Name_ReturnsLowercaseString", ...)

    t.Run("HealthCheck_ValidCredentials_ReturnsNil", ...)
    t.Run("HealthCheck_InvalidCredentials_ReturnsError", ...)
}
```

### Mock Provider

Reference mock implementation for testing:

```go
type MockProvider struct {
    NameValue     string
    QuoteResponse *Quote
    QuoteError    error
    HealthError   error
    CallCount     int
}

func (m *MockProvider) GetQuote(ctx context.Context, symbol string) (*Quote, error) {
    m.CallCount++
    if m.QuoteError != nil {
        return nil, m.QuoteError
    }
    return m.QuoteResponse, nil
}

func (m *MockProvider) GetQuotes(ctx context.Context, symbols []string) ([]*Quote, error) {
    m.CallCount++
    quotes := make([]*Quote, len(symbols))
    for i := range symbols {
        quotes[i] = m.QuoteResponse
    }
    return quotes, m.QuoteError
}

func (m *MockProvider) Name() string {
    return m.NameValue
}

func (m *MockProvider) HealthCheck(ctx context.Context) error {
    return m.HealthError
}
```

---

## Versioning

**Interface Version**: 1.0.0
**Stability**: Stable - breaking changes require major version bump
**Backward Compatibility**: New optional methods may be added with default implementations in future minor versions
