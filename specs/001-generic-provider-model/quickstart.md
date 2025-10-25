# Quickstart Guide: Provider Model

**Feature**: 001-generic-provider-model
**Date**: 2025-10-19

## Overview

The Stocktopus provider model allows you to plug in different market data providers without changing your screening scripts. This guide walks you through configuring and using providers.

---

## 5-Minute Setup

### Step 1: Choose a Provider

**For Beginners (Free Tier)**:
- **Alpha Vantage** - Free tier with 5 requests/minute
- Sign up: https://www.alphavantage.co/support/#api-key
- Best for: Learning, hobby projects, end-of-day data

**For Professionals (Real-Time Data)**:
- **Polygon.io** - Real-time quotes, good balance of features and cost
- Sign up: https://polygon.io/
- Best for: Active trading, real-time screening

**For Quantitative Analysts (Historical Data)**:
- **Financial Modeling Prep** - Rich data model, batch support
- Sign up: https://financialmodelingprep.com/developer
- Best for: Backtesting, algorithmic trading, comprehensive analytics

---

### Step 2: Get Your API Key

After signing up with your chosen provider, copy your API key from their dashboard.

**Store it securely as an environment variable**:

```bash
# Add to your ~/.bashrc or ~/.zshrc
export STOCK_API_KEY="your_api_key_here"
```

**Or use provider-specific variables**:
```bash
export ALPHAVANTAGE_API_KEY="your_alpha_vantage_key"
export POLYGON_API_KEY="your_polygon_key"
export FMP_API_KEY="your_fmp_key"
```

**Load the variable**:
```bash
source ~/.bashrc
```

---

### Step 3: Configure Stocktopus

Edit your `config.yaml` file:

**For Alpha Vantage (Free Tier)**:
```yaml
provider:
  name: alphavantage
  apiKey: ${ALPHAVANTAGE_API_KEY}
  timeout: 30s

rateLimit:
  enabled: true
  maxRequests: 5
  window: 1m
```

**For Polygon (Professional)**:
```yaml
provider:
  name: polygon
  apiKey: ${POLYGON_API_KEY}
  timeout: 15s

rateLimit:
  enabled: true
  maxRequests: 100
  window: 1m
```

**For FMP (Quantitative)**:
```yaml
provider:
  name: fmp
  apiKey: ${FMP_API_KEY}
  timeout: 10s

rateLimit:
  enabled: true
  maxRequests: 4
  window: 1s
```

---

### Step 4: Verify Configuration

Run Stocktopus to verify your provider is configured correctly:

```bash
./stocktopus --check-config
```

You should see:
```
✓ Configuration loaded successfully
✓ Provider: alphavantage
✓ Health check passed
✓ Ready to fetch market data
```

---

## Writing Provider-Agnostic Screening Scripts

Your screening scripts work the same regardless of which provider you configure. Use standardized metric names:

### Available Metrics

| Metric | Type | Description | Example |
|--------|------|-------------|---------|
| `symbol` | string | Stock ticker symbol | `"AAPL"` |
| `price` | float64 | Current price (dollars) | `178.45` |
| `volume` | int64 | Trading volume (shares) | `52134567` |
| `change` | float64 | Absolute price change (dollars) | `2.34` |
| `change_percent` | float64 | Percentage change (decimal) | `0.0133` (1.33%) |
| `day_high` | float64 | Today's high price | `179.23` |
| `day_low` | float64 | Today's low price | `175.89` |
| `day_open` | float64 | Today's opening price | `176.11` |
| `prev_close` | float64 | Previous day's close | `176.11` |
| `timestamp` | time | Quote timestamp (UTC) | `2025-10-19T16:00:00Z` |

---

### Example Screening Script

**File**: `screens/momentum.lua`

```lua
-- Find stocks with strong upward momentum
-- Works with ANY configured provider

function screen(stock)
    -- Check for positive price movement
    if stock.change_percent < 0.02 then  -- Less than 2% gain
        return false
    end

    -- Check for high volume (relative to average)
    if stock.volume < 1000000 then  -- Less than 1M shares
        return false
    end

    -- Price near day high (momentum continuing)
    local range = stock.day_high - stock.day_low
    local price_position = (stock.price - stock.day_low) / range

    if price_position < 0.8 then  -- Not in top 20% of range
        return false
    end

    -- All criteria met
    return true
end
```

**Run the screen**:
```bash
./stocktopus run --screen screens/momentum.lua --symbols AAPL,MSFT,GOOGL,TSLA
```

**Output** (same format regardless of provider):
```
┌──────────────────────────────────────┐
│ Momentum Screen Results              │
├────────┬─────────┬──────────┬────────┤
│ Symbol │  Price  │  Change  │ Volume │
├────────┼─────────┼──────────┼────────┤
│ AAPL   │ 178.45  │ +2.34%   │  52.1M │
│ TSLA   │ 242.84  │ +3.12%   │  89.3M │
└────────┴─────────┴──────────┴────────┘
```

---

## Switching Providers

### Why Switch?

- **Free tier exhausted** → Upgrade to paid provider
- **Need real-time data** → Switch from Alpha Vantage to Polygon
- **Running backtests** → Switch to FMP for historical data
- **Cost optimization** → Downgrade for less frequent screening

### How to Switch

1. **Update config.yaml**:
   ```yaml
   provider:
     name: polygon  # Changed from alphavantage
     apiKey: ${POLYGON_API_KEY}
   ```

2. **Restart Stocktopus**:
   ```bash
   ./stocktopus run --screen screens/momentum.lua
   ```

3. **Your scripts work unchanged** - the same screening logic runs with the new provider.

---

## Understanding Rate Limits

Rate limits prevent you from exhausting your API quota. Stocktopus automatically adapts to your provider's limits.

### Provider Rate Limits

| Provider | Free/Basic Tier | Premium Tier |
|----------|----------------|--------------|
| Alpha Vantage | 5 req/min | 1200 req/min |
| Polygon | 5 req/min | Unlimited |
| FMP | 250 req/day | 4 req/sec (parallel) |

### Proactive Refresh Rate Adaptation

**Key Feature**: Stocktopus automatically adjusts how often it fetches data based on your provider plan, so you never hit rate limits.

**Example**:
- **Alpha Vantage Free** (5 req/min, EOD data) → Refreshes every 12 seconds OR every 24 hours (whichever makes sense)
- **FMP Ultimate** (4 req/sec, real-time) → Refreshes every 250ms
- **Polygon Premium** (unlimited, real-time) → Refreshes every 1-5 seconds

**Configuration** (optional tuning):
```yaml
rateLimit:
  enabled: true
  maxRequests: 5    # Match your plan
  window: 1m        # Time window
  strategy: token_bucket  # Allows bursting
```

---

## Error Handling

Stocktopus displays provider errors in real-time through the TUI error panel.

### Common Errors

**Invalid API Key**:
```
[ERROR] alphavantage: Authentication failed (check API key)
```
**Fix**: Verify your API key is correct and environment variable is set.

---

**Rate Limit Exceeded**:
```
[WARN] polygon: Rate limit exceeded (retry in 10s)
```
**Fix**: Stocktopus will automatically retry with exponential backoff. If this happens frequently, reduce your `rateLimit.maxRequests` setting.

---

**Symbol Not Found**:
```
[WARN] fmp: Symbol 'INVALID' not found
```
**Fix**: Check that the symbol is valid and listed on the exchange.

---

**Network Timeout**:
```
[ERROR] alphavantage: Network timeout (retrying...)
```
**Fix**: Stocktopus will automatically retry. Check your internet connection if this persists.

---

**Circuit Breaker Open**:
```
[ERROR] polygon: Circuit breaker open (too many failures, waiting 60s)
```
**Fix**: Provider is experiencing issues. Stocktopus will automatically test recovery after the timeout.

---

## Advanced Configuration

### Custom Timeouts

Adjust timeout for slow networks or high-frequency trading:

```yaml
provider:
  timeout: 10s  # Shorter for HFT
```

### Retry Configuration

Tune retry behavior:

```yaml
retry:
  enabled: true
  maxAttempts: 5        # More retries
  initialBackoff: 50ms  # Faster initial retry
  maxBackoff: 5s        # Cap backoff sooner
```

### Circuit Breaker

Prevent cascading failures:

```yaml
circuitBreaker:
  enabled: true
  maxFailures: 3   # Open circuit faster
  resetTimeout: 30s  # Test recovery sooner
```

---

## Provider Comparison

### Which Provider Should You Use?

| Use Case | Recommended Provider | Rationale |
|----------|---------------------|-----------|
| Learning / hobby projects | Alpha Vantage Free | No cost, sufficient for learning |
| Active day trading | Polygon Professional | Real-time data, reliable |
| Backtesting strategies | FMP Quantitative | Rich historical data, batch support |
| High-frequency trading | Polygon or FMP Ultimate | Low latency, high request limits |
| Cost-sensitive production | FMP Standard | Good balance of features and cost |

### Feature Comparison

| Feature | Alpha Vantage | Polygon | FMP |
|---------|---------------|---------|-----|
| **Free Tier** | Yes (5 req/min) | Yes (5 req/min) | Yes (250 req/day) |
| **Real-Time Data** | Premium only | Paid tiers | Ultimate plan |
| **Batch Requests** | No | Yes | Yes |
| **WebSocket** | No | Yes | Ultimate plan |
| **Historical Data** | Limited | Good | Excellent |
| **Fundamental Data** | No | Limited | Extensive |

---

## Troubleshooting

### Problem: "Provider 'xyz' not registered"

**Cause**: Invalid provider name in config.yaml

**Fix**: Use one of: `alphavantage`, `polygon`, `fmp`

---

### Problem: "Environment variable STOCK_API_KEY not set"

**Cause**: API key environment variable not exported

**Fix**:
```bash
export STOCK_API_KEY="your_key_here"
source ~/.bashrc
```

---

### Problem: "Health check failed"

**Cause**: Invalid API key or network connectivity issue

**Fix**:
1. Verify API key is correct
2. Check internet connection
3. Verify provider's service status

---

### Problem: Scripts break when switching providers

**Cause**: Using provider-specific field names instead of standardized metrics

**Fix**: Use standardized metric names (see "Available Metrics" above)

**Bad** (provider-specific):
```lua
-- DON'T DO THIS
if stock["05. price"] > 100 then  -- Alpha Vantage specific!
```

**Good** (standardized):
```lua
-- DO THIS
if stock.price > 100 then  -- Works with all providers
```

---

## Next Steps

1. **Explore Provider APIs**: Read provider documentation for advanced features
2. **Write Custom Screens**: Use standardized metrics to create sophisticated screening logic
3. **Optimize Rate Limits**: Tune configuration to match your provider plan
4. **Monitor Error Panel**: Watch for provider issues in real-time TUI
5. **Experiment with Providers**: Try different providers to find the best fit for your use case

---

## Reference Links

- **Alpha Vantage Documentation**: https://www.alphavantage.co/documentation/
- **Polygon Documentation**: https://polygon.io/docs/stocks
- **FMP Documentation**: https://financialmodelingprep.com/developer/docs/
- **Stocktopus Provider Contract**: See `contracts/stock-provider-interface.md`
- **Data Model Reference**: See `data-model.md`

---

## Support

- **GitHub Issues**: Report bugs or request features
- **Provider-Specific Issues**: Contact your provider's support team
- **Configuration Help**: See `contracts/provider-config.md` for full configuration reference
