# Contract: Provider API Response Schemas

**Feature**: 001-generic-provider-model
**Date**: 2025-10-19

## Overview

This document defines the expected API response formats from each supported market data provider and the normalization rules to convert them to the standardized Quote structure.

---

## Alpha Vantage API

### Endpoint

```
GET https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={symbol}&apikey={apikey}
```

### Authentication

Query parameter: `apikey={apikey}`

### Success Response

**Status**: 200 OK
**Content-Type**: application/json

```json
{
  "Global Quote": {
    "01. symbol": "IBM",
    "02. open": "157.8500",
    "03. high": "158.9700",
    "04. low": "157.4200",
    "05. price": "158.5400",
    "06. volume": "6640217",
    "07. latest trading day": "2023-11-30",
    "08. previous close": "156.4100",
    "09. change": "2.1300",
    "10. change percent": "1.3618%"
  }
}
```

### Error Response (Rate Limit)

**Status**: 200 OK (NOTE: Alpha Vantage returns 200 for errors!)
**Content-Type**: application/json

```json
{
  "Note": "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 500 calls per day."
}
```

### Error Response (Invalid API Key)

**Status**: 200 OK
**Content-Type**: application/json

```json
{
  "Error Message": "Invalid API call. Please retry or visit the documentation."
}
```

### Error Response (Invalid Symbol)

**Status**: 200 OK
**Content-Type**: application/json

```json
{
  "Error Message": "Invalid API call. Please retry or visit the documentation."
}
```

### Normalization Rules

| Field | Raw Value | Normalized Field | Type | Transformation |
|-------|-----------|------------------|------|----------------|
| `01. symbol` | `"IBM"` | `Symbol` | string | Uppercase, trim whitespace |
| `05. price` | `"158.5400"` | `Price` | float64 | `strconv.ParseFloat()` |
| `06. volume` | `"6640217"` | `Volume` | int64 | `strconv.ParseInt()` |
| `07. latest trading day` | `"2023-11-30"` | `Timestamp` | time.Time | Parse "2006-01-02", set to EOD UTC |
| `09. change` | `"2.1300"` | `Change` | float64 | `strconv.ParseFloat()` |
| `10. change percent` | `"1.3618%"` | `ChangePercent` | float64 | Remove "%", parse, divide by 100 |
| `03. high` | `"158.9700"` | `DayHigh` (Snapshot) | float64 | `strconv.ParseFloat()` |
| `04. low` | `"157.4200"` | `DayLow` (Snapshot) | float64 | `strconv.ParseFloat()` |
| `02. open` | `"157.8500"` | `DayOpen` (Snapshot) | float64 | `strconv.ParseFloat()` |
| `08. previous close` | `"156.4100"` | `PrevClose` (Snapshot) | float64 | `strconv.ParseFloat()` |

### Error Detection Logic

```go
// Alpha Vantage returns HTTP 200 for errors
// Must check response body for error indicators

func isAlphaVantageError(body map[string]interface{}) (bool, string) {
    if note, ok := body["Note"].(string); ok {
        return true, note  // Rate limit error
    }
    if errMsg, ok := body["Error Message"].(string); ok {
        return true, errMsg  // General error
    }
    if info, ok := body["Information"].(string); ok {
        return true, info  // Informational error
    }
    return false, ""
}
```

### HTTP Status Code Mapping

Since Alpha Vantage returns 200 for errors, map to appropriate codes:

| Response Body | Mapped Status Code | Retryable |
|---------------|-------------------|-----------|
| Contains "Note" (rate limit) | 429 | Yes |
| Contains "Error Message" (invalid key) | 401 | No |
| Contains "Error Message" (other) | 400 | No |
| Timeout | 0 | Yes |
| Network error | 0 | Yes |

---

## Polygon.io API

### Endpoint

```
GET https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}
```

### Authentication

Query parameter: `apiKey={apikey}` OR Header: `Authorization: Bearer {apikey}`

### Success Response

**Status**: 200 OK
**Content-Type**: application/json

```json
{
  "status": "OK",
  "ticker": {
    "ticker": "AAPL",
    "todaysChange": 2.34,
    "todaysChangePerc": 1.33,
    "updated": 1699545600000,
    "day": {
      "o": 176.11,
      "h": 179.23,
      "l": 175.89,
      "c": 178.45,
      "v": 52134567
    },
    "prevDay": {
      "c": 176.11
    }
  }
}
```

### Error Response (Unauthorized)

**Status**: 401 Unauthorized
**Content-Type**: application/json

```json
{
  "status": "ERROR",
  "error": "Unauthorized"
}
```

### Error Response (Not Found)

**Status**: 404 Not Found
**Content-Type**: application/json

```json
{
  "status": "NOT_FOUND",
  "message": "Ticker not found"
}
```

### Error Response (Rate Limit)

**Status**: 429 Too Many Requests
**Content-Type**: application/json

```json
{
  "status": "ERROR",
  "error": "Too many requests"
}
```

### Normalization Rules

| Field | Raw Value | Normalized Field | Type | Transformation |
|-------|-----------|------------------|------|----------------|
| `ticker.ticker` | `"AAPL"` | `Symbol` | string | Uppercase |
| `ticker.day.c` | `178.45` | `Price` | float64 | Direct (already float64) |
| `ticker.day.v` | `52134567` | `Volume` | int64 | Direct (already int64) |
| `ticker.updated` | `1699545600000` | `Timestamp` | time.Time | Unix milliseconds to UTC |
| `ticker.todaysChange` | `2.34` | `Change` | float64 | Direct |
| `ticker.todaysChangePerc` | `1.33` | `ChangePercent` | float64 | Divide by 100 (1.33 → 0.0133) |
| `ticker.day.h` | `179.23` | `DayHigh` (Snapshot) | float64 | Direct |
| `ticker.day.l` | `175.89` | `DayLow` (Snapshot) | float64 | Direct |
| `ticker.day.o` | `176.11` | `DayOpen` (Snapshot) | float64 | Direct |
| `ticker.prevDay.c` | `176.11` | `PrevClose` (Snapshot) | float64 | Direct |

### Error Detection Logic

```go
// Polygon uses proper HTTP status codes
// Check status field in response body for additional context

func isPolygonError(statusCode int, body map[string]interface{}) bool {
    if statusCode >= 400 {
        return true
    }
    if status, ok := body["status"].(string); ok {
        return status == "ERROR" || status == "NOT_FOUND"
    }
    return false
}
```

### HTTP Status Code Mapping

| HTTP Status | Retryable | Meaning |
|-------------|-----------|---------|
| 200 | N/A | Success |
| 401 | No | Invalid API key |
| 403 | No | Forbidden (quota exceeded on plan) |
| 404 | No | Symbol not found |
| 429 | Yes | Rate limit exceeded |
| 500-503 | Yes | Server error |
| Timeout | Yes | Network timeout |

---

## Financial Modeling Prep (FMP) API

### Endpoint

```
GET https://financialmodelingprep.com/api/v3/quote/{symbol}?apikey={apikey}
```

### Batch Endpoint

```
GET https://financialmodelingprep.com/api/v3/quote/{symbol1},{symbol2},{symbol3}?apikey={apikey}
```

### Authentication

Query parameter: `apikey={apikey}`

### Success Response (Single Symbol)

**Status**: 200 OK
**Content-Type**: application/json

```json
[
  {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "price": 178.45,
    "changesPercentage": 1.33,
    "change": 2.34,
    "dayLow": 175.89,
    "dayHigh": 179.23,
    "yearHigh": 198.23,
    "yearLow": 124.17,
    "marketCap": 2809234567890,
    "priceAvg50": 172.45,
    "priceAvg200": 165.23,
    "volume": 52134567,
    "avgVolume": 48567234,
    "open": 176.11,
    "previousClose": 176.11,
    "eps": 6.05,
    "pe": 29.49,
    "timestamp": 1699545600
  }
]
```

### Success Response (Batch)

**Status**: 200 OK
**Content-Type**: application/json

```json
[
  {
    "symbol": "AAPL",
    "price": 178.45,
    ...
  },
  {
    "symbol": "MSFT",
    "price": 389.12,
    ...
  }
]
```

### Error Response (Unauthorized)

**Status**: 401 Unauthorized
**Content-Type**: application/json

```json
{
  "Error Message": "Invalid API KEY. Please retry or visit our documentation to create one FREE https://financialmodelingprep.com/developer/docs/"
}
```

### Error Response (Rate Limit)

**Status**: 429 Too Many Requests
**Content-Type**: application/json

```json
{
  "Error Message": "You have exceeded the rate limit. Please visit our documentation for more information."
}
```

### Error Response (Not Found)

**Status**: 200 OK (Returns empty array!)
**Content-Type**: application/json

```json
[]
```

### Normalization Rules

| Field | Raw Value | Normalized Field | Type | Transformation |
|-------|-----------|------------------|------|----------------|
| `symbol` | `"AAPL"` | `Symbol` | string | Uppercase |
| `price` | `178.45` | `Price` | float64 | Direct (already float64) |
| `volume` | `52134567` | `Volume` | int64 | Convert to int64 |
| `timestamp` | `1699545600` | `Timestamp` | time.Time | Unix seconds to UTC |
| `change` | `2.34` | `Change` | float64 | Direct |
| `changesPercentage` | `1.33` | `ChangePercent` | float64 | Divide by 100 (1.33 → 0.0133) |
| `dayHigh` | `179.23` | `DayHigh` (Snapshot) | float64 | Direct |
| `dayLow` | `175.89` | `DayLow` (Snapshot) | float64 | Direct |
| `open` | `176.11` | `DayOpen` (Snapshot) | float64 | Direct |
| `previousClose` | `176.11` | `PrevClose` (Snapshot) | float64 | Direct |

### Error Detection Logic

```go
// FMP uses proper HTTP status codes for auth errors
// But returns 200 with empty array for not found

func isFMPError(statusCode int, body interface{}) (bool, error) {
    if statusCode == 401 {
        return true, ErrAuthenticationFailed
    }
    if statusCode == 429 {
        return true, ErrRateLimitExceeded
    }

    // Check for empty array (symbol not found)
    if arr, ok := body.([]interface{}); ok && len(arr) == 0 {
        return true, ErrSymbolNotFound
    }

    // Check for error message object
    if obj, ok := body.(map[string]interface{}); ok {
        if _, hasError := obj["Error Message"]; hasError {
            return true, errors.New(obj["Error Message"].(string))
        }
    }

    return false, nil
}
```

### HTTP Status Code Mapping

| HTTP Status / Response | Mapped Code | Retryable | Meaning |
|------------------------|-------------|-----------|---------|
| 200 (with data) | 200 | N/A | Success |
| 200 (empty array) | 404 | No | Symbol not found |
| 401 | 401 | No | Invalid API key |
| 429 | 429 | Yes | Rate limit exceeded |
| 500-503 | 500-503 | Yes | Server error |
| Timeout | 0 | Yes | Network timeout |

---

## Standardized Error Types

All providers MUST map their errors to these standardized types:

```go
var (
    ErrRateLimitExceeded    = errors.New("rate limit exceeded")
    ErrAuthenticationFailed = errors.New("authentication failed")
    ErrSymbolNotFound       = errors.New("symbol not found")
    ErrInvalidRequest       = errors.New("invalid request")
    ErrServerError          = errors.New("provider server error")
    ErrNetworkTimeout       = errors.New("network timeout")
    ErrCircuitOpen          = errors.New("circuit breaker open")
)
```

---

## Normalization Implementation

### Reference Normalization Functions

```go
// ParsePrice converts string or float64 to float64 dollars
func ParsePrice(raw interface{}) (float64, error) {
    switch v := raw.(type) {
    case string:
        return strconv.ParseFloat(v, 64)
    case float64:
        return v, nil
    case int:
        return float64(v), nil
    default:
        return 0, fmt.Errorf("invalid price type: %T", raw)
    }
}

// ParseVolume converts string or int to int64 shares
func ParseVolume(raw interface{}) (int64, error) {
    switch v := raw.(type) {
    case string:
        return strconv.ParseInt(v, 10, 64)
    case int64:
        return v, nil
    case int:
        return int64(v), nil
    case float64:
        return int64(v), nil
    default:
        return 0, fmt.Errorf("invalid volume type: %T", raw)
    }
}

// ParsePercentage converts "1.23%" string or 1.23 float to 0.0123 decimal
func ParsePercentage(raw interface{}) (float64, error) {
    switch v := raw.(type) {
    case string:
        // Remove % suffix
        v = strings.TrimSuffix(v, "%")
        pct, err := strconv.ParseFloat(v, 64)
        if err != nil {
            return 0, err
        }
        return pct / 100.0, nil
    case float64:
        // Assume already percentage, convert to decimal
        return v / 100.0, nil
    default:
        return 0, fmt.Errorf("invalid percentage type: %T", raw)
    }
}

// ParseTimestamp converts various formats to time.Time UTC
func ParseTimestamp(raw interface{}) (time.Time, error) {
    switch v := raw.(type) {
    case string:
        // Try ISO 8601
        if t, err := time.Parse(time.RFC3339, v); err == nil {
            return t.UTC(), nil
        }
        // Try date-only format
        if t, err := time.Parse("2006-01-02", v); err == nil {
            return t.UTC(), nil
        }
        return time.Time{}, fmt.Errorf("unparseable timestamp: %s", v)
    case int64:
        // Unix milliseconds
        if v > 1e12 {
            return time.Unix(0, v*int64(time.Millisecond)).UTC(), nil
        }
        // Unix seconds
        return time.Unix(v, 0).UTC(), nil
    case float64:
        // Unix seconds
        return time.Unix(int64(v), 0).UTC(), nil
    default:
        return time.Time{}, fmt.Errorf("invalid timestamp type: %T", raw)
    }
}
```

---

## Response Validation

All providers MUST validate normalized Quote before returning:

```go
func ValidateQuote(q *Quote) error {
    if q.Symbol == "" {
        return errors.New("symbol is required")
    }
    if q.Price <= 0 {
        return errors.New("price must be > 0")
    }
    if q.Volume < 0 {
        return errors.New("volume must be >= 0")
    }
    if q.Timestamp.After(time.Now().UTC()) {
        return errors.New("timestamp must not be in future")
    }
    return nil
}
```

---

## Testing Data

### Mock HTTP Responses

Providers SHOULD use `httptest.NewServer` for integration tests:

```go
func TestAlphaVantageProvider_GetQuote(t *testing.T) {
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        json.NewEncoder(w).Encode(map[string]interface{}{
            "Global Quote": map[string]string{
                "01. symbol": "AAPL",
                "05. price":  "178.45",
                "06. volume": "52134567",
                // ...
            },
        })
    }))
    defer server.Close()

    provider := NewAlphaVantageProvider(Config{BaseURL: server.URL, ...})
    quote, err := provider.GetQuote(context.Background(), "AAPL")
    // assertions...
}
```

---

## Versioning

**Contract Version**: 1.0.0
**API Version Compatibility**:
- Alpha Vantage: Stable (no versioned API)
- Polygon: v2 (current stable)
- FMP: v3 (current stable)

**Backward Compatibility**: If provider changes API format, implement adapter pattern to maintain Quote compatibility.
