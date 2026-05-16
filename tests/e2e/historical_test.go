//go:build e2e

package e2e

import (
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// /api/historical/{kind}/{symbol} covers the chart-layer projection for
// every sketch metric kind. These exercise each routing branch end-to-end
// against the live FMP plan that smoke tests already assume.

func TestSmoke_HistoricalPrice(t *testing.T) {
	resp := get(t, "/api/historical/price/AAPL")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	if !strings.HasPrefix(strings.TrimSpace(string(body)), "[") {
		t.Errorf("expected JSON array for price history, got: %s", trim(body))
	}
	if len(body) < 100 {
		t.Errorf("expected sizable response body, got %d bytes", len(body))
	}
}

func TestSmoke_HistoricalFinancialStatement(t *testing.T) {
	resp := get(t, "/api/historical/financial/AAPL.revenue")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	var rows []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("expected revenue data points")
	}
	if _, ok := rows[0]["value"]; !ok {
		t.Errorf("expected value field, got keys %v", keys(rows[0]))
	}
	if _, ok := rows[0]["date"]; !ok {
		t.Errorf("expected date field, got keys %v", keys(rows[0]))
	}
}

func TestSmoke_HistoricalNonStatementMarketCap(t *testing.T) {
	resp := get(t, "/api/historical/financial/AAPL.marketCap")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	var rows []map[string]any
	json.NewDecoder(resp.Body).Decode(&rows)
	if len(rows) == 0 {
		t.Fatal("expected marketCap data points")
	}
}

func TestSmoke_HistoricalNonStatementPERatio(t *testing.T) {
	resp := get(t, "/api/historical/financial/AAPL.peRatio")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	var rows []map[string]any
	json.NewDecoder(resp.Body).Decode(&rows)
	if len(rows) == 0 {
		t.Fatal("expected peRatio data points")
	}
}

func TestSmoke_HistoricalBeta(t *testing.T) {
	// Rolling 1Y daily beta vs SPY — needs ~5y of price data for both AAPL
	// and SPY (covered by the standard FMP plan).
	resp := get(t, "/api/historical/financial/AAPL.beta")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	var rows []map[string]any
	json.NewDecoder(resp.Body).Decode(&rows)
	if len(rows) == 0 {
		t.Fatal("expected beta data points")
	}
	// Beta values should be finite and within a sane range (0.0 to 3.0 covers
	// all but the wildest single names — AAPL sits around 1.2).
	first, ok := rows[0]["value"].(float64)
	if !ok {
		t.Fatalf("expected numeric beta value, got %T", rows[0]["value"])
	}
	if first < 0 || first > 3 {
		t.Errorf("beta value outside expected range [0, 3]: %f", first)
	}
}

func trim(b []byte) string {
	s := string(b)
	if len(s) > 200 {
		s = s[:200] + "…"
	}
	return s
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
