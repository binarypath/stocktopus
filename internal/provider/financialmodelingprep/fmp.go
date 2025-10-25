package financialmodelingprep

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

// Config holds Financial Modeling Prep provider configuration
type Config struct {
	APIKey  string
	BaseURL string
	Timeout time.Duration
	Options map[string]string // Provider-specific options (e.g., exchange: "NYSE")
}

// Provider implements the StockProvider interface for Financial Modeling Prep
type Provider struct {
	config Config
	client *http.Client
}

// NewProvider creates a new Financial Modeling Prep provider
func NewProvider(config Config) *Provider {
	if config.BaseURL == "" {
		config.BaseURL = "https://financialmodelingprep.com"
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

// GetQuote fetches a single stock quote from Financial Modeling Prep
// Implements StockProvider.GetQuote
func (p *Provider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	// Build request URL
	url := fmt.Sprintf("%s/api/v3/quote/%s?apikey=%s",
		p.config.BaseURL, symbol, p.config.APIKey)

	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuote", 0, err)
	}

	// Execute request

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuote", 0, err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuote", resp.StatusCode, err)
	}

	// Check for HTTP errors
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, provider.NewProviderError("fmp", "GetQuote", 401,
			fmt.Errorf("authentication failed: invalid API key"))
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, provider.NewProviderError("fmp", "GetQuote", 429,
			provider.ErrRateLimitExceeded)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, provider.NewProviderError("fmp", "GetQuote", resp.StatusCode,
			fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body)))
	}

	// Parse response - FMP returns an array even for single symbol
	var quotes []QuoteResponse
	if err := json.Unmarshal(body, &quotes); err != nil {
		// Check if it's an error message object
		var errResp map[string]interface{}
		if err2 := json.Unmarshal(body, &errResp); err2 == nil {
			if errMsg, ok := errResp["Error Message"].(string); ok {
				return nil, provider.NewProviderError("fmp", "GetQuote", resp.StatusCode,
					fmt.Errorf("%s", errMsg))
			}
		}
		return nil, provider.NewProviderError("fmp", "GetQuote", resp.StatusCode, err)
	}

	// FMP returns empty array for not found
	if len(quotes) == 0 {
		return nil, provider.NewProviderError("fmp", "GetQuote", 404,
			fmt.Errorf("symbol %s not found", symbol))
	}

	// Normalize to Quote struct
	quote, err := p.normalizeQuote(&quotes[0])
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuote", resp.StatusCode, err)
	}

	return quote, nil
}

// GetQuotes fetches multiple stock quotes using comma-separated batch API
// Implements StockProvider.GetQuotes
func (p *Provider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	if len(symbols) == 0 {
		return []*model.Quote{}, nil
	}

	// FMP supports comma-separated symbols for batch requests
	symbolList := strings.Join(symbols, ",")
	url := fmt.Sprintf("%s/api/v3/quote/%s?apikey=%s",
		p.config.BaseURL, symbolList, p.config.APIKey)

	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuotes", 0, err)
	}

	// Execute request
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuotes", 0, err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuotes", resp.StatusCode, err)
	}

	// Check for errors
	if resp.StatusCode != http.StatusOK {
		return nil, provider.NewProviderError("fmp", "GetQuotes", resp.StatusCode,
			fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body)))
	}

	// Parse response array
	var quoteResponses []QuoteResponse
	if err := json.Unmarshal(body, &quoteResponses); err != nil {
		return nil, provider.NewProviderError("fmp", "GetQuotes", resp.StatusCode, err)
	}

	// Create result array matching input order
	quotes := make([]*model.Quote, len(symbols))
	responseMap := make(map[string]*QuoteResponse)

	// Build map of responses
	for i := range quoteResponses {
		responseMap[quoteResponses[i].Symbol] = &quoteResponses[i]
	}

	// Match responses to input order
	for i, symbol := range symbols {
		if resp, ok := responseMap[strings.ToUpper(symbol)]; ok {
			quote, err := p.normalizeQuote(resp)
			if err != nil {
				quotes[i] = nil
				continue
			}
			quotes[i] = quote
		} else {
			quotes[i] = nil // Symbol not found
		}
	}

	return quotes, nil
}

// Name returns the provider identifier
// Implements StockProvider.Name
func (p *Provider) Name() string {
	return "fmp"
}

// HealthCheck validates API credentials
// Implements StockProvider.HealthCheck
func (p *Provider) HealthCheck(ctx context.Context) error {
	// Make a lightweight request to verify credentials
	_, err := p.GetQuote(ctx, "AAPL")
	return err
}

// normalizeQuote converts FMP response to standardized Quote
func (p *Provider) normalizeQuote(data *QuoteResponse) (*model.Quote, error) {
	symbol := strings.ToUpper(strings.TrimSpace(data.Symbol))

	if data.Price <= 0 {
		return nil, fmt.Errorf("invalid price: %f", data.Price)
	}
	if data.Volume < 0 {
		return nil, fmt.Errorf("invalid volume: %d", data.Volume)
	}

	// FMP timestamp is Unix seconds
	timestamp, err := provider.ParseTimestamp(data.Timestamp)
	if err != nil {
		return nil, fmt.Errorf("invalid timestamp: %w", err)
	}

	// FMP returns change as absolute value
	change := data.Change

	// FMP returns changesPercentage as percentage (1.23 = 1.23%), convert to decimal
	changePercent := data.ChangesPercentage / 100.0

	quote := &model.Quote{
		Symbol:        symbol,
		Price:         data.Price,
		Volume:        data.Volume,
		Timestamp:     timestamp,
		Change:        change,
		ChangePercent: changePercent,
	}

	return quote, nil
}

// QuoteResponse represents the FMP quote API response
type QuoteResponse struct {
	Symbol            string  `json:"symbol"`
	Name              string  `json:"name"`
	Price             float64 `json:"price"`
	ChangesPercentage float64 `json:"changesPercentage"` // As percentage (1.23 = 1.23%)
	Change            float64 `json:"change"`
	DayLow            float64 `json:"dayLow"`
	DayHigh           float64 `json:"dayHigh"`
	YearHigh          float64 `json:"yearHigh"`
	YearLow           float64 `json:"yearLow"`
	MarketCap         int64   `json:"marketCap"`
	PriceAvg50        float64 `json:"priceAvg50"`
	PriceAvg200       float64 `json:"priceAvg200"`
	Volume            int64   `json:"volume"`
	AvgVolume         int64   `json:"avgVolume"`
	Open              float64 `json:"open"`
	PreviousClose     float64 `json:"previousClose"`
	EPS               float64 `json:"eps"`
	PE                float64 `json:"pe"`
	Timestamp         int64   `json:"timestamp"` // Unix seconds
}

// init registers the FMP provider with the registry
func init() {
	provider.Register("fmp", func(config interface{}) (provider.StockProvider, error) {
		cfg, ok := config.(Config)
		if !ok {
			return nil, fmt.Errorf("invalid config type for fmp provider")
		}
		return NewProvider(cfg), nil
	})
}
