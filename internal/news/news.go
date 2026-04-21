package news

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"stocktopus/internal/model"
	"strconv"
	"strings"
	"time"
)

// SearchResult represents a security from the FMP search API.
type SearchResult struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Currency string `json:"currency"`
	Exchange string `json:"exchange"`
}

// SetGeminiKey sets the Gemini API key for AI-assisted search fallback.
func (c *Client) SetGeminiKey(key string) {
	c.geminiKey = key
}

// SearchSymbol searches for securities by ticker and company name in parallel,
// merging and deduplicating the results. Falls back to AI interpretation if empty.
func (c *Client) SearchSymbol(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	if limit <= 0 {
		limit = 10
	}

	type result struct {
		items []SearchResult
		err   error
	}

	ch := make(chan result, 2)

	// Search by ticker
	go func() {
		items, err := c.searchEndpoint(ctx, "/stable/search-symbol", query, limit)
		ch <- result{items, err}
	}()

	// Search by name
	go func() {
		items, err := c.searchEndpoint(ctx, "/stable/search-name", query, limit)
		ch <- result{items, err}
	}()

	seen := make(map[string]bool)
	var merged []SearchResult

	for i := 0; i < 2; i++ {
		r := <-ch
		if r.err != nil {
			continue
		}
		for _, item := range r.items {
			if !seen[item.Symbol] {
				seen[item.Symbol] = true
				merged = append(merged, item)
			}
		}
	}

	// AI fallback: if no results, ask Gemini to interpret the query
	if len(merged) == 0 && c.geminiKey != "" {
		tickers := c.aiSearchFallback(ctx, query)
		for _, ticker := range tickers {
			results, err := c.searchEndpoint(ctx, "/stable/search-symbol", ticker, 3)
			if err == nil {
				for _, r := range results {
					if !seen[r.Symbol] {
						seen[r.Symbol] = true
						merged = append(merged, r)
					}
				}
			}
		}
	}

	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged, nil
}

// aiSearchFallback asks Gemini to interpret a search query as stock tickers.
func (c *Client) aiSearchFallback(ctx context.Context, query string) []string {
	prompt := fmt.Sprintf(`The user searched for "%s" but no stock ticker or company name matched.
What stock ticker symbols are they most likely looking for?
Return ONLY a JSON array of ticker strings, e.g. ["AAPL","MSFT"]. No explanation.`, query)

	reqBody, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]interface{}{
			"temperature": 0.1, "maxOutputTokens": 100,
		},
	})

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=%s", c.geminiKey)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil
	}

	// Extract text from response
	var gemResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	json.Unmarshal(body, &gemResp)
	if len(gemResp.Candidates) == 0 || len(gemResp.Candidates[0].Content.Parts) == 0 {
		return nil
	}

	text := gemResp.Candidates[0].Content.Parts[0].Text
	// Strip markdown
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)

	var tickers []string
	json.Unmarshal([]byte(text), &tickers)
	return tickers
}

func (c *Client) searchEndpoint(ctx context.Context, endpoint, query string, limit int) ([]SearchResult, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("apikey", c.apiKey)

	reqURL := c.baseURL + endpoint + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("search API %d: %s", resp.StatusCode, string(body))
	}

	var results []SearchResult
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, err
	}
	return results, nil
}

// GetHistoricalEOD fetches end-of-day OHLCV data for a symbol within a date range.
// Results are returned in chronological order (oldest first).
func (c *Client) GetHistoricalEOD(ctx context.Context, symbol, from, to string) ([]model.OHLCV, error) {
	params := url.Values{}
	params.Set("symbol", symbol)
	params.Set("apikey", c.apiKey)
	if from != "" {
		params.Set("from", from)
	}
	if to != "" {
		params.Set("to", to)
	}

	reqURL := c.baseURL + "/stable/historical-price-eod/full?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("eod request: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("eod fetch: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("eod read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("eod API %d: %s", resp.StatusCode, string(body))
	}

	var items []model.OHLCV
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, fmt.Errorf("eod parse: %w", err)
	}

	// FMP returns newest-first, reverse to chronological order
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}

	return items, nil
}

// fetchJSON is a generic helper that fetches a URL and returns raw JSON bytes.
func (c *Client) fetchJSON(ctx context.Context, endpoint string, params url.Values) (json.RawMessage, error) {
	if params == nil {
		params = url.Values{}
	}
	params.Set("apikey", c.apiKey)

	reqURL := c.baseURL + endpoint + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API %d: %s", resp.StatusCode, string(body))
	}

	return json.RawMessage(body), nil
}

// GetProfile returns the company profile for a symbol.
func (c *Client) GetProfile(ctx context.Context, symbol string) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}}
	return c.fetchJSON(ctx, "/stable/profile", params)
}

// GetKeyMetrics returns key financial metrics.
func (c *Client) GetKeyMetrics(ctx context.Context, symbol string) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}, "limit": {"1"}}
	return c.fetchJSON(ctx, "/stable/key-metrics", params)
}

// GetRatiosTTM returns trailing twelve month ratios.
func (c *Client) GetRatiosTTM(ctx context.Context, symbol string) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}}
	return c.fetchJSON(ctx, "/stable/ratios-ttm", params)
}

// GetIncomeStatement returns annual income statements.
func (c *Client) GetIncomeStatement(ctx context.Context, symbol string, limit int) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}, "period": {"annual"}, "limit": {strconv.Itoa(limit)}}
	return c.fetchJSON(ctx, "/stable/income-statement", params)
}

// GetBalanceSheet returns annual balance sheets.
func (c *Client) GetBalanceSheet(ctx context.Context, symbol string, limit int) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}, "period": {"annual"}, "limit": {strconv.Itoa(limit)}}
	return c.fetchJSON(ctx, "/stable/balance-sheet-statement", params)
}

// GetCashFlow returns annual cash flow statements.
func (c *Client) GetCashFlow(ctx context.Context, symbol string, limit int) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}, "period": {"annual"}, "limit": {strconv.Itoa(limit)}}
	return c.fetchJSON(ctx, "/stable/cash-flow-statement", params)
}

// GetAnalystEstimates returns forward analyst estimates.
func (c *Client) GetAnalystEstimates(ctx context.Context, symbol string, limit int) (json.RawMessage, error) {
	params := url.Values{"symbol": {symbol}, "period": {"annual"}, "limit": {strconv.Itoa(limit)}}
	return c.fetchJSON(ctx, "/stable/analyst-estimates", params)
}

// GetIntradayChart fetches intraday OHLCV data for a symbol.
// interval: "1min", "5min", "15min", "30min", "1hour", "4hour"
func (c *Client) GetIntradayChart(ctx context.Context, symbol, interval, from, to string) ([]model.OHLCV, error) {
	params := url.Values{}
	params.Set("symbol", symbol)
	params.Set("apikey", c.apiKey)
	if from != "" {
		params.Set("from", from)
	}
	if to != "" {
		params.Set("to", to)
	}

	reqURL := c.baseURL + "/stable/historical-chart/" + interval + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("intraday request: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("intraday fetch: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("intraday read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("intraday API %d: %s", resp.StatusCode, string(body))
	}

	// Response has float volumes and datetime strings
	var raw []struct {
		Date   string  `json:"date"`
		Open   float64 `json:"open"`
		High   float64 `json:"high"`
		Low    float64 `json:"low"`
		Close  float64 `json:"close"`
		Volume float64 `json:"volume"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("intraday parse: %w", err)
	}

	// Reverse to chronological order (API returns newest-first)
	items := make([]model.OHLCV, len(raw))
	for i, r := range raw {
		items[len(raw)-1-i] = model.OHLCV{
			Date:   r.Date,
			Open:   r.Open,
			High:   r.High,
			Low:    r.Low,
			Close:  r.Close,
			Volume: int64(r.Volume),
		}
	}

	return items, nil
}

// Category represents a news feed type.
type Category string

const (
	Stock         Category = "stock"
	Crypto        Category = "crypto"
	Forex         Category = "forex"
	General       Category = "general"
	PressReleases Category = "press-releases"
	Articles      Category = "articles"
)

// Client fetches news from the FMP stable API.
type Client struct {
	apiKey    string
	baseURL   string
	geminiKey string
	http      *http.Client
}

func New(apiKey, baseURL string) *Client {
	if baseURL == "" {
		baseURL = "https://financialmodelingprep.com"
	}
	return &Client{
		apiKey:  apiKey,
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// GetNews fetches news for the given category. Symbol is used for press-releases filtering.
func (c *Client) GetNews(ctx context.Context, cat Category, symbol string, page, limit int) ([]model.NewsItem, error) {
	if limit <= 0 {
		limit = 20
	}

	var endpoint string
	params := url.Values{}
	params.Set("apikey", c.apiKey)
	params.Set("limit", strconv.Itoa(limit))

	switch cat {
	case Stock:
		if symbol != "" {
			endpoint = "/stable/news/stock"
			params.Set("symbols", symbol)
		} else {
			endpoint = "/stable/news/stock-latest"
		}
		params.Set("page", strconv.Itoa(page))
	case Crypto:
		if symbol != "" {
			endpoint = "/stable/news/crypto"
			params.Set("symbols", symbol)
		} else {
			endpoint = "/stable/news/crypto-latest"
		}
		params.Set("page", strconv.Itoa(page))
	case Forex:
		if symbol != "" {
			endpoint = "/stable/news/forex"
			params.Set("symbols", symbol)
		} else {
			endpoint = "/stable/news/forex-latest"
		}
		params.Set("page", strconv.Itoa(page))
	case General:
		endpoint = "/stable/news/general-latest"
		params.Set("page", strconv.Itoa(page))
	case PressReleases:
		endpoint = "/stable/news/press-releases"
		if symbol != "" {
			params.Set("symbols", symbol)
		}
		params.Set("page", strconv.Itoa(page))
	case Articles:
		endpoint = "/stable/fmp-articles"
	default:
		return nil, fmt.Errorf("unknown news category: %s", cat)
	}

	reqURL := c.baseURL + endpoint + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("news request: %w", err)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("news fetch: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("news read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("news API %d: %s", resp.StatusCode, string(body))
	}

	if cat == Articles {
		return parseArticles(body)
	}
	return parseNewsItems(body)
}

// Standard news response shape (stock, crypto, forex, general, press-releases).
type fmpNewsItem struct {
	Symbol        *string `json:"symbol"`
	PublishedDate string  `json:"publishedDate"`
	Publisher     string  `json:"publisher"`
	Title         string  `json:"title"`
	Image         string  `json:"image"`
	Site          string  `json:"site"`
	Text          string  `json:"text"`
	URL           string  `json:"url"`
}

// FMP articles response shape.
type fmpArticle struct {
	Title   string `json:"title"`
	Date    string `json:"date"`
	Content string `json:"content"`
	Tickers string `json:"tickers"`
	Image   string `json:"image"`
	Link    string `json:"link"`
	Author  string `json:"author"`
	Site    string `json:"site"`
}

func parseNewsItems(data []byte) ([]model.NewsItem, error) {
	var raw []fmpNewsItem
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("news parse: %w", err)
	}

	items := make([]model.NewsItem, 0, len(raw))
	for _, r := range raw {
		t, _ := time.Parse("2006-01-02 15:04:05", r.PublishedDate)
		sym := ""
		if r.Symbol != nil {
			sym = *r.Symbol
		}
		items = append(items, model.NewsItem{
			Title:    r.Title,
			Date:     t,
			Source:   r.Publisher,
			Text:     r.Text,
			URL:      r.URL,
			ImageURL: r.Image,
			Symbol:   sym,
		})
	}
	return items, nil
}

func parseArticles(data []byte) ([]model.NewsItem, error) {
	var raw []fmpArticle
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("articles parse: %w", err)
	}

	items := make([]model.NewsItem, 0, len(raw))
	for _, r := range raw {
		t, _ := time.Parse("2006-01-02 15:04:05", r.Date)
		items = append(items, model.NewsItem{
			Title:    r.Title,
			Date:     t,
			Source:   r.Site,
			Text:     r.Content,
			URL:      r.Link,
			ImageURL: r.Image,
			Symbol:   r.Tickers,
			Author:   r.Author,
		})
	}
	return items, nil
}
