// Package fred is a thin client for the St. Louis Fed FRED API.
//
// FRED ID conventions are stable, well-known strings (UNRATE, CPIAUCSL,
// FEDFUNDS, GDPC1, DGS10, …) so we can hand-curate a catalog without
// worrying about renames. Free key from
// https://fred.stlouisfed.org/docs/api/api_key.html.
package fred

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const baseURL = "https://api.stlouisfed.org/fred"

// Observation is one point in a FRED series. FRED returns dates as YYYY-MM-DD
// and values as strings — "." means missing, anything else parses as float64.
type Observation struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// SeriesMeta is the metadata for a FRED series as returned by /series.
type SeriesMeta struct {
	ID                 string `json:"id"`
	Title              string `json:"title"`
	FrequencyShort     string `json:"frequency_short"`     // D / W / M / Q / SA / A
	Units              string `json:"units"`
	UnitsShort         string `json:"units_short"`
	SeasonalAdjustment string `json:"seasonal_adjustment_short"`
	ObservationStart   string `json:"observation_start"`
	ObservationEnd     string `json:"observation_end"`
	LastUpdated        string `json:"last_updated"` // "2024-01-05 08:31:02-06"
	Notes              string `json:"notes,omitempty"`
}

// Series bundles metadata + observations for a single FRED ID.
type Series struct {
	Meta         SeriesMeta    `json:"meta"`
	Observations []Observation `json:"observations"`
}

type Client struct {
	apiKey string
	http   *http.Client
}

func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) HasKey() bool { return c.apiKey != "" }

// GetSeries fetches metadata + full observation history for a series ID.
func (c *Client) GetSeries(ctx context.Context, seriesID string) (*Series, error) {
	meta, err := c.getMeta(ctx, seriesID)
	if err != nil {
		return nil, err
	}
	obs, err := c.getObservations(ctx, seriesID)
	if err != nil {
		return nil, err
	}
	return &Series{Meta: *meta, Observations: obs}, nil
}

func (c *Client) getMeta(ctx context.Context, seriesID string) (*SeriesMeta, error) {
	q := url.Values{
		"series_id": {seriesID},
		"api_key":   {c.apiKey},
		"file_type": {"json"},
	}
	body, err := c.fetch(ctx, "/series", q)
	if err != nil {
		return nil, err
	}
	var wrap struct {
		Seriess []SeriesMeta `json:"seriess"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return nil, fmt.Errorf("decode series: %w", err)
	}
	if len(wrap.Seriess) == 0 {
		return nil, fmt.Errorf("series %s not found", seriesID)
	}
	return &wrap.Seriess[0], nil
}

func (c *Client) getObservations(ctx context.Context, seriesID string) ([]Observation, error) {
	q := url.Values{
		"series_id":  {seriesID},
		"api_key":    {c.apiKey},
		"file_type":  {"json"},
		"sort_order": {"asc"},
	}
	body, err := c.fetch(ctx, "/series/observations", q)
	if err != nil {
		return nil, err
	}
	var wrap struct {
		Observations []struct {
			Date  string `json:"date"`
			Value string `json:"value"`
		} `json:"observations"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return nil, fmt.Errorf("decode observations: %w", err)
	}
	out := make([]Observation, 0, len(wrap.Observations))
	for _, o := range wrap.Observations {
		// "." is FRED's sentinel for a missing observation — skip rather
		// than emit NaN, the chart layer doesn't carry a tri-state value.
		if o.Value == "." || o.Value == "" {
			continue
		}
		v, err := strconv.ParseFloat(o.Value, 64)
		if err != nil {
			continue
		}
		out = append(out, Observation{Date: o.Date, Value: v})
	}
	return out, nil
}

func (c *Client) fetch(ctx context.Context, endpoint string, params url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", baseURL+endpoint+"?"+params.Encode(), nil)
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
		return nil, fmt.Errorf("fred %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}
