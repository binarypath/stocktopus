// Package dbnomics is a thin client for the DBnomics aggregator API.
//
// DBnomics federates ~80 statistics providers (ECB, BoE, Bundesbank, INSEE,
// OECD, IMF, …) behind a single REST surface. We use it for international
// economics — FRED itself is no longer hosted on DBnomics, so the US side
// continues to use internal/fred directly.
//
// Series are identified by a 3-tuple {provider, dataset, series_code}, e.g.
// {ECB, FM, "D.U2.EUR.4F.KR.MRR_FR.LEV"} for the ECB main refi rate. The
// catalog in internal/econ holds the curated mapping from our user-facing
// "Country.Code" handle to that 3-tuple.
package dbnomics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const baseURL = "https://api.db.nomics.world/v22"

// Observation is one (date, value) point. Dates are YYYY-MM-DD strings —
// DBnomics emits a `period_start_day` parallel array which we zip into this
// pair-of-fields shape so downstream code is uniform across providers.
type Observation struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// Series bundles metadata + observations for one DBnomics series.
type Series struct {
	Provider     string        `json:"provider"`     // ECB / BOE / BUBA / …
	Dataset      string        `json:"dataset"`      // e.g. FM
	Code         string        `json:"code"`         // bare DBnomics series_code
	Name         string        `json:"name"`         // human label (series_name)
	Frequency    string        `json:"frequency"`    // daily / monthly / quarterly / annual
	UpdatedAt    string        `json:"updatedAt"`    // DBnomics's indexed_at timestamp
	Observations []Observation `json:"observations"`
}

type Client struct {
	http *http.Client
}

func New() *Client {
	return &Client{http: &http.Client{Timeout: 30 * time.Second}}
}

// GetSeries fetches the full observation history for a DBnomics series.
// provider, dataset, code map directly to the URL path segments.
func (c *Client) GetSeries(ctx context.Context, provider, dataset, code string) (*Series, error) {
	url := fmt.Sprintf("%s/series/%s/%s/%s?observations=1", baseURL, provider, dataset, code)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
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
		return nil, fmt.Errorf("dbnomics %d: %s", resp.StatusCode, string(body))
	}

	// DBnomics wraps the per-series doc inside series.docs[0]. period_start_day
	// and value are parallel arrays — same length, zip into our Observation pairs.
	// Missing values in DBnomics are represented as JSON null in the `value`
	// array, which json.Number/[]any best handles, so decode into a permissive
	// shape and convert.
	var wrap struct {
		Series struct {
			Docs []struct {
				ProviderCode   string `json:"provider_code"`
				DatasetCode    string `json:"dataset_code"`
				SeriesCode     string `json:"series_code"`
				SeriesName     string `json:"series_name"`
				Frequency      string `json:"@frequency"`
				IndexedAt      string `json:"indexed_at"`
				PeriodStartDay []string `json:"period_start_day"`
				// Mixed-type array: float | null. Decode as []any then coerce.
				Value []any `json:"value"`
			} `json:"docs"`
		} `json:"series"`
	}
	if err := json.Unmarshal(body, &wrap); err != nil {
		return nil, fmt.Errorf("decode dbnomics: %w", err)
	}
	if len(wrap.Series.Docs) == 0 {
		return nil, fmt.Errorf("dbnomics: series %s/%s/%s not found", provider, dataset, code)
	}
	doc := wrap.Series.Docs[0]

	obs := make([]Observation, 0, len(doc.PeriodStartDay))
	n := len(doc.PeriodStartDay)
	if len(doc.Value) < n {
		n = len(doc.Value)
	}
	for i := 0; i < n; i++ {
		v, ok := doc.Value[i].(float64)
		if !ok {
			// null or non-numeric — skip rather than emit NaN, the chart
			// layer doesn't carry a tri-state value.
			continue
		}
		obs = append(obs, Observation{Date: doc.PeriodStartDay[i], Value: v})
	}

	return &Series{
		Provider:     doc.ProviderCode,
		Dataset:      doc.DatasetCode,
		Code:         doc.SeriesCode,
		Name:         doc.SeriesName,
		Frequency:    doc.Frequency,
		UpdatedAt:    doc.IndexedAt,
		Observations: obs,
	}, nil
}
