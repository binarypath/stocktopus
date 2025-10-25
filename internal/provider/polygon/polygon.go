package polygon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"stocktopus/internal/model"
	"stocktopus/internal/provider"
	"strings"
	"time"
)

// Config holds Polygon.io provider configuration
type Config struct {
	APIKey  string
	BaseURL string
	Timeout time.Duration
	Options map[string]string // Provider-specific options (e.g., adjusted: "true")
}

// Provider implements the StockProvider interface for Polygon.io
type Provider struct {
	config Config
	client *http.Client
}

// NewProvider creates a new Polygon.io provider
func NewProvider(config Config) *Provider {
	if config.BaseURL == "" {
		config.BaseURL = "https://api.polygon.io"
	}
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}

	return &Provider{
		config: config,
		client: &http.Client{
			Timeout: config.Timeout,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// GetQuote fetches a single stock quote from Polygon.io
// Implements StockProvider.GetQuote
func (p *Provider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	// Build request URL - using snapshot API
	url := fmt.Sprintf("%s/v2/snapshot/locale/us/markets/stocks/tickers/%s?apiKey=%s",
		p.config.BaseURL, symbol, p.config.APIKey)

	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, provider.NewProviderError("polygon", "GetQuote", 0, err)
	}

	// Execute request
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, provider.NewProviderError("polygon", "GetQuote", 0, err)
	}
	defer resp.Body.Close()

	// Read response body once
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, provider.NewProviderError("polygon", "GetQuote", resp.StatusCode, err)
	}

	// Check HTTP status
	if resp.StatusCode != http.StatusOK {
		return nil, provider.NewProviderError("polygon", "GetQuote", resp.StatusCode,
			fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body)))
	}

	// Parse response
	var response SnapshotResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, provider.NewProviderError("polygon", "GetQuote", resp.StatusCode, err)
	}

	// Check for errors in response
	if response.Status == "ERROR" || response.Status == "NOT_FOUND" {
		statusCode := 404
		if response.Status == "ERROR" {
			statusCode = 400
		}
		return nil, provider.NewProviderError("polygon", "GetQuote", statusCode,
			fmt.Errorf("status: %s", response.Status))
	}

	// Normalize to Quote struct
	quote, err := p.normalizeQuote(&response.Ticker)
	if err != nil {
		return nil, provider.NewProviderError("polygon", "GetQuote", resp.StatusCode, err)
	}

	return quote, nil
}

// GetQuotes fetches multiple stock quotes using batch ticker endpoint
// Implements StockProvider.GetQuotes
//
// NOTE: This is intentionally sequential to respect rate limits.
// DO NOT parallelize without implementing a worker pool with bounded concurrency.
func (p *Provider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	// Polygon has a batch endpoint, but for simplicity we'll fan out
	// In production, you could use: /v2/snapshot/locale/us/markets/stocks/tickers
	quotes := make([]*model.Quote, len(symbols))

	for i, symbol := range symbols {
		quote, err := p.GetQuote(ctx, symbol)
		if err != nil {
			// Allow partial success
			quotes[i] = nil
			continue
		}
		quotes[i] = quote
	}

	return quotes, nil
}

// Name returns the provider identifier
// Implements StockProvider.Name
func (p *Provider) Name() string {
	return "polygon"
}

// HealthCheck validates API credentials
// Implements StockProvider.HealthCheck
func (p *Provider) HealthCheck(ctx context.Context) error {
	// Make a lightweight request to verify credentials
	_, err := p.GetQuote(ctx, "AAPL")
	return err
}

// normalizeQuote converts Polygon response to standardized Quote
func (p *Provider) normalizeQuote(data *TickerData) (*model.Quote, error) {
	symbol := strings.ToUpper(strings.TrimSpace(data.Ticker))

	// Price is in the day.c field
	price := data.Day.Close
	if price <= 0 {
		return nil, fmt.Errorf("invalid price: %f", price)
	}

	// Volume is in the day.v field
	volume := data.Day.Volume
	if volume < 0 {
		return nil, fmt.Errorf("invalid volume: %d", volume)
	}

	// Timestamp is Unix milliseconds
	timestamp, err := provider.ParseTimestamp(data.Updated)
	if err != nil {
		return nil, fmt.Errorf("invalid timestamp: %w", err)
	}

	// Change is todaysChange
	change := data.TodaysChange

	// ChangePercent is todaysChangePerc (need to divide by 100)
	changePercent := data.TodaysChangePerc / 100.0

	quote := &model.Quote{
		Symbol:        symbol,
		Price:         price,
		Volume:        volume,
		Timestamp:     timestamp,
		Change:        change,
		ChangePercent: changePercent,
	}

	return quote, nil
}

// SnapshotResponse represents the Polygon snapshot API response
type SnapshotResponse struct {
	Status string     `json:"status"`
	Ticker TickerData `json:"ticker"`
}

// TickerData represents ticker information from Polygon
type TickerData struct {
	Ticker           string  `json:"ticker"`
	TodaysChange     float64 `json:"todaysChange"`
	TodaysChangePerc float64 `json:"todaysChangePerc"`
	Updated          int64   `json:"updated"` // Unix milliseconds
	Day              DayData `json:"day"`
	PrevDay          DayData `json:"prevDay"`
}

// DayData represents daily trading data
type DayData struct {
	Open   float64 `json:"o"`
	High   float64 `json:"h"`
	Low    float64 `json:"l"`
	Close  float64 `json:"c"`
	Volume int64   `json:"v"`
}

// init registers the Polygon provider with the registry
func init() {
	provider.Register("polygon", func(config interface{}) (provider.StockProvider, error) {
		cfg, ok := config.(Config)
		if !ok {
			return nil, fmt.Errorf("invalid config type for polygon provider")
		}
		return NewProvider(cfg), nil
	})
}
