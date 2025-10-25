package alphavantage

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

const (
	// DefaultBaseURL is the default Alpha Vantage API endpoint
	DefaultBaseURL = "https://www.alphavantage.co"
	// DefaultTimeout is the default request timeout
	DefaultTimeout = 30 * time.Second
)

// Config holds Alpha Vantage provider configuration
type Config struct {
	APIKey  string
	BaseURL string        // Optional: defaults to DefaultBaseURL if empty
	Timeout time.Duration // Optional: defaults to DefaultTimeout if zero
}

// Provider implements the StockProvider interface for Alpha Vantage
type Provider struct {
	config Config
	client *http.Client
}

// NewProvider creates a new Alpha Vantage provider
func NewProvider(config Config) *Provider {
	if config.BaseURL == "" {
		config.BaseURL = DefaultBaseURL
	}
	if config.Timeout == 0 {
		config.Timeout = DefaultTimeout
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

// GetQuote fetches a single stock quote from Alpha Vantage
// Implements StockProvider.GetQuote
func (p *Provider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	// Build request URL
	url := fmt.Sprintf("%s/query?function=GLOBAL_QUOTE&symbol=%s&apikey=%s",
		p.config.BaseURL, symbol, p.config.APIKey)

	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, provider.NewProviderError("alphavantage", "GetQuote", 0, err)
	}

	// Execute request
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, provider.NewProviderError("alphavantage", "GetQuote", 0, err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, provider.NewProviderError("alphavantage", "GetQuote", resp.StatusCode, err)
	}

	// Parse response
	var response map[string]interface{}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, provider.NewProviderError("alphavantage", "GetQuote", resp.StatusCode, err)
	}

	// Alpha Vantage returns HTTP 200 for errors - check response body
	if note, ok := response["Note"].(string); ok {
		// Rate limit error
		return nil, provider.NewProviderError("alphavantage", "GetQuote", 429,
			fmt.Errorf("rate limit: %s", note))
	}
	if errMsg, ok := response["Error Message"].(string); ok {
		// General error (invalid API key, invalid symbol, etc.)
		return nil, provider.NewProviderError("alphavantage", "GetQuote", 400,
			fmt.Errorf("%s", errMsg))
	}
	if info, ok := response["Information"].(string); ok {
		// Informational error
		return nil, provider.NewProviderError("alphavantage", "GetQuote", 400,
			fmt.Errorf("%s", info))
	}

	// Extract "Global Quote" object
	globalQuote, ok := response["Global Quote"].(map[string]interface{})
	if !ok {
		return nil, provider.NewProviderError("alphavantage", "GetQuote", resp.StatusCode,
			fmt.Errorf("missing Global Quote in response"))
	}

	// Normalize to Quote struct
	quote, err := p.normalizeQuote(globalQuote)
	if err != nil {
		return nil, provider.NewProviderError("alphavantage", "GetQuote", resp.StatusCode, err)
	}

	return quote, nil
}

// GetQuotes fetches multiple stock quotes (sequential fan-out, no batch API)
// Implements StockProvider.GetQuotes
//
// NOTE: This is intentionally sequential to respect rate limits.
// DO NOT parallelize without implementing a worker pool with bounded concurrency.
func (p *Provider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	quotes := make([]*model.Quote, len(symbols))

	for i, symbol := range symbols {
		quote, err := p.GetQuote(ctx, symbol)
		if err != nil {
			// Allow partial success - set nil for failed symbols
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
	return "alphavantage"
}

// HealthCheck validates API credentials
// Implements StockProvider.HealthCheck
func (p *Provider) HealthCheck(ctx context.Context) error {
	// Make a lightweight request to verify credentials
	// Use a well-known symbol to test API access
	_, err := p.GetQuote(ctx, "AAPL")
	return err
}

// normalizeQuote converts Alpha Vantage response to standardized Quote
func (p *Provider) normalizeQuote(data map[string]interface{}) (*model.Quote, error) {
	// Alpha Vantage response format:
	// "01. symbol": "IBM"
	// "02. open": "157.8500"
	// "03. high": "158.9700"
	// "04. low": "157.4200"
	// "05. price": "158.5400"
	// "06. volume": "6640217"
	// "07. latest trading day": "2023-11-30"
	// "08. previous close": "156.4100"
	// "09. change": "2.1300"
	// "10. change percent": "1.3618%"

	symbol, _ := data["01. symbol"].(string)
	symbol = strings.ToUpper(strings.TrimSpace(symbol))

	price, err := provider.ParsePrice(data["05. price"])
	if err != nil {
		return nil, fmt.Errorf("invalid price: %w", err)
	}

	volume, err := provider.ParseVolume(data["06. volume"])
	if err != nil {
		return nil, fmt.Errorf("invalid volume: %w", err)
	}

	timestamp, err := provider.ParseTimestamp(data["07. latest trading day"])
	if err != nil {
		return nil, fmt.Errorf("invalid timestamp: %w", err)
	}

	change, err := provider.ParsePrice(data["09. change"])
	if err != nil {
		return nil, fmt.Errorf("invalid change: %w", err)
	}

	changePercent, err := provider.ParsePercentage(data["10. change percent"])
	if err != nil {
		return nil, fmt.Errorf("invalid change percent: %w", err)
	}

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

// init registers the Alpha Vantage provider with the registry
func init() {
	provider.Register("alphavantage", func(config interface{}) (provider.StockProvider, error) {
		cfg, ok := config.(Config)
		if !ok {
			return nil, fmt.Errorf("invalid config type for alphavantage provider")
		}
		return NewProvider(cfg), nil
	})
}
