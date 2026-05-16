//go:build e2e

package e2e

import (
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// Catalog includes both FRED (US) and DBnomics (EZ) routed entries. Tests
// the shape of the response + that both sources appear, but does NOT fetch
// any series (the test scaffold has no econ.Fetcher wired).

func TestSmoke_EconomicsCatalog(t *testing.T) {
	resp := get(t, "/api/economics/catalog")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var rows []struct {
		Identifier string `json:"identifier"`
		Country    string `json:"country"`
		Code       string `json:"code"`
		Name       string `json:"name"`
		Category   string `json:"category"`
		Frequency  string `json:"frequency"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if len(rows) < 30 {
		t.Errorf("expected 30+ catalog entries, got %d", len(rows))
	}

	// Spot-check coverage of both sources.
	foundUS, foundEZ := false, false
	for _, r := range rows {
		switch r.Identifier {
		case "US.UNRATE":
			foundUS = true
		case "EZ.RATE":
			foundEZ = true
		}
		// All entries must carry the domain fields; provider details must
		// not leak (Route is tagged json:"-").
		if r.Country == "" || r.Code == "" || r.Name == "" {
			t.Errorf("incomplete catalog entry: %+v", r)
		}
	}
	if !foundUS {
		t.Error("expected US.UNRATE in catalog")
	}
	if !foundEZ {
		t.Error("expected EZ.RATE in catalog")
	}
}

func TestSmoke_EconomicsCatalogCountryFilter(t *testing.T) {
	resp := get(t, "/api/economics/catalog?country=EZ")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var rows []struct {
		Country string `json:"country"`
	}
	json.NewDecoder(resp.Body).Decode(&rows)
	if len(rows) == 0 {
		t.Fatal("expected EZ catalog entries when filtered")
	}
	for _, r := range rows {
		if r.Country != "EZ" {
			t.Errorf("expected only EZ entries, got %q", r.Country)
		}
	}
}

func TestSmoke_EconomicsCentralBanks(t *testing.T) {
	resp := get(t, "/api/economics/central-banks")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var cbs []struct {
		Country    string `json:"country"`
		Name       string `json:"name"`
		Indicators int    `json:"indicators"`
	}
	json.NewDecoder(resp.Body).Decode(&cbs)
	if len(cbs) < 2 {
		t.Fatalf("expected at least 2 central banks (Fed + ECB), got %d", len(cbs))
	}
	foundFed, foundECB := false, false
	for _, cb := range cbs {
		if cb.Country == "US" && cb.Indicators > 0 {
			foundFed = true
		}
		if cb.Country == "EZ" && cb.Indicators > 0 {
			foundECB = true
		}
	}
	if !foundFed {
		t.Error("expected Federal Reserve in central banks list")
	}
	if !foundECB {
		t.Error("expected ECB in central banks list")
	}
}

func TestSmoke_EconomicsSeriesUnknownIs404(t *testing.T) {
	resp := get(t, "/api/economics/series/XX.NOPE")
	defer resp.Body.Close()
	assertStatus(t, resp, 404)
}

func TestSmoke_EconomicsCalendar(t *testing.T) {
	resp := get(t, "/api/economics/calendar")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	trimmed := strings.TrimSpace(string(body))
	if !strings.HasPrefix(trimmed, "[") {
		head := trimmed
		if len(head) > 200 {
			head = head[:200]
		}
		t.Errorf("expected JSON array response from calendar, got: %s", head)
	}
}
