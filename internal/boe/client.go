// Package boe is a thin client for the Bank of England Interactive Database
// (IADB) CSV endpoint.
//
// BoE does not publish a JSON API; the IADB serves daily-refreshed CSV from
// https://www.bankofengland.co.uk/boeapps/iadb/ . We use it for the UK
// monetary side (Bank Rate, SONIA, gilt yields, M4 growth) where DBnomics's
// BoE coverage is limited to MFI flow datasets. Inflation/labour/GDP for
// the UK still flow through DBnomics → ONS.
//
// Series are identified by an alphanumeric IADB code, e.g. IUDBEDR
// (Official Bank Rate). The endpoint follows a 302 to the actual CSV.
package boe

import (
	"bufio"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	baseURL = "https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp"
	// IADB returns dates like "02 Jan 2026".
	csvDateFormat = "02 Jan 2006"
)

// Observation is one (date, value) point. Dates are YYYY-MM-DD strings to
// match the cross-provider shape used in internal/dbnomics and internal/fred.
type Observation struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// Series bundles metadata + observations for one BoE IADB series.
type Series struct {
	Code         string        `json:"code"`         // IADB code, e.g. IUDBEDR
	Name         string        `json:"name"`         // human label from CSV header
	Observations []Observation `json:"observations"`
}

type Client struct {
	http *http.Client
}

func New() *Client {
	return &Client{http: &http.Client{Timeout: 30 * time.Second}}
}

// GetSeries fetches the full observation history for an IADB series code.
// Start date is hard-coded to 1975 (the IADB's earliest broad coverage) so
// callers don't have to know — we cache the full history downstream anyway.
func (c *Client) GetSeries(ctx context.Context, code string) (*Series, error) {
	q := fmt.Sprintf(
		"%s?csv.x=yes&Datefrom=01/Jan/1975&Dateto=now&SeriesCodes=%s&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N",
		baseURL, code,
	)
	req, err := http.NewRequestWithContext(ctx, "GET", q, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("boe %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return parseCSV(resp.Body, code)
}

// parseCSV decodes the IADB's two-block CSV: a description block then a
// DATE,CODE block. We tolerate either Unix or Windows line endings.
//
//	SERIES,DESCRIPTION
//	IUDBEDR,Official Bank Rate
//
//	DATE,IUDBEDR
//	02 Jan 2020,0.75
//	…
func parseCSV(r io.Reader, code string) (*Series, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	var name string
	var dataLines []string
	state := 0 // 0=desc-header, 1=desc-row, 2=blank-or-data-header, 3=data

	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		switch state {
		case 0:
			// Header "SERIES,DESCRIPTION" — discard.
			state = 1
		case 1:
			// "IUDBEDR,Official Bank Rate" — pull the description.
			parts := strings.SplitN(line, ",", 2)
			if len(parts) == 2 {
				name = strings.TrimSpace(parts[1])
			}
			state = 2
		case 2:
			// Blank then "DATE,CODE" — skip until we see the data header.
			if strings.HasPrefix(line, "DATE,") {
				state = 3
			}
		case 3:
			if line == "" {
				continue
			}
			dataLines = append(dataLines, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("boe csv scan: %w", err)
	}

	obs := make([]Observation, 0, len(dataLines))
	cr := csv.NewReader(strings.NewReader(strings.Join(dataLines, "\n")))
	cr.FieldsPerRecord = -1
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("boe csv parse: %w", err)
		}
		if len(rec) < 2 {
			continue
		}
		raw := strings.TrimSpace(rec[1])
		if raw == "" || raw == "NA" {
			// Blank rows are common for monthly series sampled at daily dates.
			continue
		}
		t, err := time.Parse(csvDateFormat, strings.TrimSpace(rec[0]))
		if err != nil {
			continue
		}
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			continue
		}
		obs = append(obs, Observation{Date: t.UTC().Format("2006-01-02"), Value: v})
	}

	return &Series{Code: code, Name: name, Observations: obs}, nil
}
