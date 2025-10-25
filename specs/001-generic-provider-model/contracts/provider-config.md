# Contract: Provider Configuration

**Feature**: 001-generic-provider-model
**Date**: 2025-10-19

## Configuration Schema

Provider configuration is defined in YAML and loaded at application startup. The configuration determines which provider is active and how it behaves.

---

## YAML Schema

```yaml
provider:
  # Provider selection (REQUIRED)
  name: string  # One of: "alphavantage", "polygon", "fmp"

  # Authentication (REQUIRED)
  apiKey: string  # API credential - use ${ENV_VAR} for environment variables

  # HTTP Configuration (OPTIONAL)
  baseURL: string          # Override default provider API endpoint
  timeout: duration        # HTTP request timeout (default: 30s)

  # Provider-specific options (OPTIONAL)
  options:
    key1: string
    key2: string

# Rate limiting configuration (OPTIONAL)
rateLimit:
  enabled: bool             # Enable rate limiting (default: true)
  strategy: string          # "token_bucket" or "leaky_bucket" (default: token_bucket)
  maxRequests: int          # Maximum requests allowed
  window: duration          # Time window for rate limit

# Retry configuration (OPTIONAL)
retry:
  enabled: bool             # Enable automatic retries (default: true)
  maxAttempts: int          # Maximum retry attempts (default: 3)
  initialBackoff: duration  # Initial backoff duration (default: 100ms)
  maxBackoff: duration      # Maximum backoff duration (default: 10s)
  multiplier: float         # Backoff multiplier (default: 2.0)
  jitter: bool              # Add random jitter to backoff (default: true)

# Circuit breaker configuration (OPTIONAL)
circuitBreaker:
  enabled: bool             # Enable circuit breaker (default: true)
  maxFailures: int          # Failures before opening circuit (default: 5)
  resetTimeout: duration    # Time before attempting half-open (default: 60s)
```

---

## Field Specifications

### provider.name

**Type**: string (enum)
**Required**: Yes
**Valid Values**: `"alphavantage"`, `"polygon"`, `"fmp"`
**Description**: Identifies which provider implementation to instantiate
**Validation**:
- MUST be one of the registered provider names
- MUST be lowercase
- System MUST fail at startup if provider name is invalid

**Example**:
```yaml
provider:
  name: polygon
```

---

### provider.apiKey

**Type**: string
**Required**: Yes
**Description**: Provider API authentication credential
**Validation**:
- MUST be non-empty
- MAY use environment variable substitution: `${ENV_VAR}`
- System MUST validate via HealthCheck() at startup
- MUST NOT be logged or displayed in plain text

**Examples**:
```yaml
provider:
  apiKey: ${STOCK_API_KEY}  # Recommended: from environment
```

```yaml
provider:
  apiKey: "abc123xyz456"    # Direct value (not recommended for production)
```

**Environment Variable Mapping**:
- `${STOCK_API_KEY}`: Generic API key variable
- `${ALPHAVANTAGE_API_KEY}`: Alpha Vantage specific
- `${POLYGON_API_KEY}`: Polygon specific
- `${FMP_API_KEY}`: Financial Modeling Prep specific

---

### provider.baseURL

**Type**: string (URL)
**Required**: No
**Default**: Provider-specific default
**Description**: Override the default API endpoint URL
**Validation**:
- MUST be valid HTTPS URL
- MUST NOT have trailing slash

**Defaults**:
- Alpha Vantage: `https://www.alphavantage.co`
- Polygon: `https://api.polygon.io`
- FMP: `https://financialmodelingprep.com`

**Example** (for testing against mock server):
```yaml
provider:
  name: polygon
  baseURL: https://localhost:8443
```

---

### provider.timeout

**Type**: duration
**Required**: No
**Default**: `30s`
**Description**: Maximum time to wait for HTTP responses
**Validation**:
- MUST be > 0
- MUST be parseable Go duration (e.g., "30s", "2m", "500ms")

**Example**:
```yaml
provider:
  timeout: 15s  # Shorter timeout for high-frequency trading
```

---

### provider.options

**Type**: map[string]string
**Required**: No
**Default**: `{}`
**Description**: Provider-specific configuration options
**Validation**: Provider-dependent

**Alpha Vantage Options**:
```yaml
provider:
  name: alphavantage
  options:
    datatype: json  # "json" or "csv"
```

**Polygon Options**:
```yaml
provider:
  name: polygon
  options:
    adjusted: "true"  # Adjusted for splits/dividends
```

**FMP Options**:
```yaml
provider:
  name: fmp
  options:
    exchange: NYSE  # Filter by exchange
```

---

### rateLimit.enabled

**Type**: bool
**Required**: No
**Default**: `true`
**Description**: Enable rate limiting to prevent quota exhaustion
**Recommendation**: Always leave enabled unless testing

---

### rateLimit.strategy

**Type**: string (enum)
**Required**: No
**Default**: `"token_bucket"`
**Valid Values**: `"token_bucket"`, `"leaky_bucket"`
**Description**: Rate limiting algorithm

**token_bucket**: Allows bursts up to maxRequests, refills tokens over time
**leaky_bucket**: Smooth request rate, no bursting

**Example**:
```yaml
rateLimit:
  strategy: token_bucket
  maxRequests: 5
  window: 1m
```

---

### rateLimit.maxRequests

**Type**: int
**Required**: If rateLimit.enabled=true
**Description**: Maximum requests allowed within time window
**Validation**:
- MUST be > 0
- SHOULD match provider plan limits

**Provider Recommendations**:
- Alpha Vantage Free: `5` (5 req/min)
- Alpha Vantage Premium: `1200` (1200 req/min)
- Polygon Basic: `5` (5 req/min)
- FMP Standard: `4` (4 parallel/sec)

**Example**:
```yaml
rateLimit:
  maxRequests: 5
  window: 1m
```

---

### rateLimit.window

**Type**: duration
**Required**: If rateLimit.enabled=true
**Description**: Time window for rate limit
**Validation**:
- MUST be > 0
- MUST be parseable Go duration

**Example**:
```yaml
rateLimit:
  window: 1m     # 5 requests per minute
```

```yaml
rateLimit:
  window: 1s     # 4 requests per second
```

---

### retry.enabled

**Type**: bool
**Required**: No
**Default**: `true`
**Description**: Enable automatic retry with exponential backoff
**Behavior**: Only retries transient failures (ProviderError.Retryable=true)

---

### retry.maxAttempts

**Type**: int
**Required**: No
**Default**: `3`
**Description**: Maximum number of retry attempts (including initial request)
**Validation**: MUST be >= 1

**Example**:
```yaml
retry:
  maxAttempts: 3  # Initial request + 2 retries
```

---

### retry.initialBackoff

**Type**: duration
**Required**: No
**Default**: `100ms`
**Description**: Initial backoff duration before first retry
**Validation**: MUST be > 0

---

### retry.maxBackoff

**Type**: duration
**Required**: No
**Default**: `10s`
**Description**: Maximum backoff duration (caps exponential growth)
**Validation**: MUST be >= initialBackoff

---

### retry.multiplier

**Type**: float
**Required**: No
**Default**: `2.0`
**Description**: Backoff multiplier for exponential growth
**Validation**: MUST be >= 1.0

**Backoff Calculation**:
```
attempt 1: initialBackoff
attempt 2: initialBackoff * multiplier
attempt 3: initialBackoff * multiplier^2
...
capped at: maxBackoff
```

**Example** (100ms, multiplier 2.0):
- Attempt 1: 100ms
- Attempt 2: 200ms
- Attempt 3: 400ms

---

### retry.jitter

**Type**: bool
**Required**: No
**Default**: `true`
**Description**: Add random jitter (0-50%) to backoff durations
**Purpose**: Prevent thundering herd when multiple instances retry simultaneously

---

### circuitBreaker.enabled

**Type**: bool
**Required**: No
**Default**: `true`
**Description**: Enable circuit breaker to prevent cascading failures

---

### circuitBreaker.maxFailures

**Type**: int
**Required**: No
**Default**: `5`
**Description**: Number of consecutive failures before opening circuit
**Validation**: MUST be > 0

**State Transitions**:
- Closed (normal): Requests pass through
- Open (failing): All requests fail fast with ErrCircuitOpen
- Half-Open (testing): Allow one request to test recovery

---

### circuitBreaker.resetTimeout

**Type**: duration
**Required**: No
**Default**: `60s`
**Description**: Time to wait in open state before attempting half-open
**Validation**: MUST be > 0

---

## Complete Configuration Examples

### Alpha Vantage Free Tier

```yaml
provider:
  name: alphavantage
  apiKey: ${ALPHAVANTAGE_API_KEY}
  timeout: 30s

rateLimit:
  enabled: true
  strategy: token_bucket
  maxRequests: 5
  window: 1m

retry:
  enabled: true
  maxAttempts: 3
  initialBackoff: 100ms
  maxBackoff: 10s

circuitBreaker:
  enabled: true
  maxFailures: 5
  resetTimeout: 60s
```

---

### Polygon Professional Tier

```yaml
provider:
  name: polygon
  apiKey: ${POLYGON_API_KEY}
  timeout: 15s
  options:
    adjusted: "true"

rateLimit:
  enabled: true
  strategy: token_bucket
  maxRequests: 100
  window: 1m

retry:
  enabled: true
  maxAttempts: 2
  initialBackoff: 50ms
  maxBackoff: 5s

circuitBreaker:
  enabled: true
  maxFailures: 10
  resetTimeout: 30s
```

---

### FMP Quantitative Tier

```yaml
provider:
  name: fmp
  apiKey: ${FMP_API_KEY}
  timeout: 10s

rateLimit:
  enabled: true
  strategy: token_bucket
  maxRequests: 4
  window: 1s

retry:
  enabled: true
  maxAttempts: 3
  initialBackoff: 100ms
  maxBackoff: 5s
  multiplier: 2.0
  jitter: true

circuitBreaker:
  enabled: false  # Disable for high-throughput use case
```

---

## Configuration Validation

The system MUST validate the configuration at startup and fail fast with clear error messages:

**Validation Steps**:
1. Parse YAML file
2. Validate required fields present
3. Validate field types and values
4. Resolve environment variables
5. Validate provider name is registered
6. Create provider instance
7. Call provider.HealthCheck(ctx) with 10-second timeout
8. If validation fails, exit with error code 1 and descriptive message

**Example Error Messages**:
```
Error: provider.name is required
Error: provider.apiKey must not be empty
Error: rateLimit.maxRequests must be > 0
Error: provider 'invalid' not registered (valid options: alphavantage, polygon, fmp)
Error: Health check failed for 'alphavantage': invalid API key (HTTP 401)
```

---

## Environment Variable Substitution

The configuration loader MUST support environment variable substitution using `${VAR_NAME}` syntax:

**Behavior**:
- `${VAR_NAME}`: Replace with value of environment variable VAR_NAME
- If VAR_NAME is not set, fail with error: `Error: environment variable VAR_NAME not set`
- No default values supported in initial implementation

**Example**:
```yaml
provider:
  apiKey: ${STOCK_API_KEY}
```

```bash
export STOCK_API_KEY="abc123"
./stocktopus run
```

---

## Configuration Hot Reload

**NOT SUPPORTED in initial implementation**. Changing configuration requires application restart.

**Future Enhancement**: Support mid-session provider switching via TUI command (see spec.md clarification #5)

---

## Security Requirements

1. **API Keys**:
   - MUST NOT be committed to version control
   - MUST use environment variables in production
   - MUST NOT appear in logs or error messages
   - SHOULD be validated at startup only (not logged)

2. **HTTPS**:
   - All baseURL values MUST use HTTPS in production
   - HTTP allowed only for local testing (warn user)

3. **Timeouts**:
   - All HTTP requests MUST have timeouts
   - Default timeout: 30 seconds
   - Maximum timeout: 5 minutes (prevent hung requests)

---

## Versioning

**Configuration Version**: 1.0.0
**Backward Compatibility**: Configuration format is stable. New optional fields may be added in minor versions.
