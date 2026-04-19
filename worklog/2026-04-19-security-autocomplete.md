# Worklog: 2026-04-19 -- Security Autocomplete & News Enhancements

## Security Search Autocomplete

### FMP search integration
- Added `SearchSymbol()` to news client — calls both `/stable/search-symbol` and `/stable/search-name` in parallel, deduplicates results
- New server endpoint `GET /api/search?q=QUERY` proxies to FMP search
- 200ms debounce on all search inputs to avoid hammering the API

### Security selector (top-right, `s` key)
- Now searches FMP API instead of only filtering subscribed securities
- Dropdown shows symbol, company name, and exchange

### Command bar autocomplete
- After typing a command that takes a security (e.g. `graph `), typing more shows security search results
- If no commands match the input, falls back to security search — selecting a result navigates to the `info` view and sets the security selector
- Typing e.g. "apple" or "MSFT" directly in the command bar works

## Info route renamed
- `info` command now routes to `/security/{symbol}` instead of `/stock/{symbol}`
- New `security.html` template and `handleSecurity` handler
- `graph` still uses `/stock/{symbol}` (chart-specific)

## News filtering by security
- `news MSFT` filters all news tabs to that security
- Uses correct FMP endpoints: `/stable/news/stock` with `symbols=` param for filtered, `/stable/news/stock-latest` for unfiltered
- Tabs with no results are dimmed (40% opacity, non-clickable)
- Security autocomplete works in command bar after `news `

## News infinite scroll
- Scrolling near the bottom of the news list (within 200px) auto-fetches the next page
- "Loading more..." indicator while fetching
- Stops when a page returns fewer than 30 items
