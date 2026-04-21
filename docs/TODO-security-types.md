# TODO: Security Type Handling

The info page currently assumes all securities are US equities. Crypto, forex, indices, and ETFs need different treatment.

## Immediate Fix
- [ ] Detect security type from FMP profile response (`exchange` field: "CRYPTO", "FOREX", "INDEX", etc.)
- [ ] Gracefully handle missing data — don't crash if financials/estimates return empty
- [ ] Show appropriate tabs per security type (hide irrelevant ones)

## Security Types & Relevant Data

### Stocks (current default)
- Overview: profile, key metrics, ratios
- Financials: income, balance sheet, cash flow
- Estimates: analyst forecasts
- News: press releases, stock news
- AI Analysis: full pipeline

### Crypto (e.g. BTCUSD, ETHUSD)
- **Show**: Price, market cap, volume, 24h change, 7d change
- **Show**: On-chain metrics (if available from API)
- **Show**: Social sentiment (Bluesky, Reddit mentions)
- **Show**: Crypto-specific news
- **Show**: Historical chart (already works via EOD)
- **Hide**: Financials (no income statement for BTC)
- **Hide**: Estimates (no analyst EPS forecasts)
- **Hide**: SEC filings
- **Agent**: Skip SEC agent, focus on social + web search + news

### Indices (e.g. ^DJI, ^GSPC, ^IXIC)
- **Show**: Price, change, components list
- **Show**: Historical chart
- **Show**: Sector breakdown
- **Show**: Top gainers/losers in index
- **Hide**: Financials (no single company)
- **Hide**: Estimates
- **Agent**: Macro analysis, sector sentiment

### Forex (e.g. EURUSD, GBPUSD)
- **Show**: Exchange rate, bid/ask, daily range
- **Show**: Historical chart
- **Show**: Forex-specific news
- **Show**: Central bank rate context
- **Hide**: Financials, estimates, SEC
- **Agent**: Macro/geopolitical analysis

### ETFs (e.g. SPY, QQQ, VOO)
- **Show**: Price, NAV, expense ratio, holdings
- **Show**: Top holdings list
- **Show**: Sector allocation
- **Show**: Historical chart, performance vs benchmark
- **Show**: Dividend info
- **Hide**: Individual company financials (show aggregate)
- **Agent**: Holdings analysis, sector outlook

## Implementation Approach

### Phase 1: Don't crash
- Detect type from profile `exchange` field
- Wrap all tab loaders in error handling
- Hide tabs that will return empty data
- Show "Not available for {type}" instead of errors

### Phase 2: Type-specific views
- Create `info-crypto.js`, `info-index.js` etc. (or sections within info.js)
- Route to correct view based on detected type
- Type-specific agent task lists (skip SEC for crypto, etc.)

### Phase 3: Type-specific agents
- Crypto agent: on-chain data, DEX volumes, whale tracking
- Index agent: component analysis, sector rotation
- Forex agent: central bank calendar, rate differentials

## FMP Endpoints by Type

### Crypto
- `/stable/cryptocurrency/quote?symbol=BTCUSD` — crypto quote
- `/stable/cryptocurrency/daily?symbol=BTCUSD` — daily prices
- `/stable/news/crypto?symbols=BTCUSD` — crypto news

### Index
- `/stable/quote?symbol=^GSPC` — index quote
- `/stable/index-constituent?symbol=dowjones` — index components

### ETF
- `/stable/etf/holder?symbol=SPY` — ETF holdings
- `/stable/etf/info?symbol=SPY` — ETF info
