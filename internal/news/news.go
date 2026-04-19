package news

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"stocktopus/internal/model"
	"strconv"
	"time"
)

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
	apiKey  string
	baseURL string
	http    *http.Client
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
		endpoint = "/stable/news/stock-latest"
		params.Set("page", strconv.Itoa(page))
	case Crypto:
		endpoint = "/stable/news/crypto-latest"
		params.Set("page", strconv.Itoa(page))
	case Forex:
		endpoint = "/stable/news/forex-latest"
		params.Set("page", strconv.Itoa(page))
	case General:
		endpoint = "/stable/news/general-latest"
		params.Set("page", strconv.Itoa(page))
	case PressReleases:
		endpoint = "/stable/news/press-releases"
		if symbol != "" {
			params.Set("symbol", symbol)
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
