//go:build e2e

package e2e

import (
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// Catalog includes FRED (US), DBnomics→ECB (EZ), BoE direct + DBnomics→ONS
// (UK) routed entries. Tests the shape of the response + that all three
// regions appear, but does NOT fetch any series (the test scaffold has no
// econ.Fetcher wired).

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

	// Spot-check coverage of all three regions. UK.RATE (BoE direct) and
	// UK.CPI (DBnomics→ONS) cover both UK source paths.
	foundUS, foundEZ, foundUKBoE, foundUKONS := false, false, false, false
	for _, r := range rows {
		switch r.Identifier {
		case "US.UNRATE":
			foundUS = true
		case "EZ.RATE":
			foundEZ = true
		case "UK.RATE":
			foundUKBoE = true
		case "UK.CPI":
			foundUKONS = true
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
	if !foundUKBoE {
		t.Error("expected UK.RATE (BoE direct) in catalog")
	}
	if !foundUKONS {
		t.Error("expected UK.CPI (DBnomics→ONS) in catalog")
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

func TestSmoke_EconomicsCatalogUKFilter(t *testing.T) {
	resp := get(t, "/api/economics/catalog?country=UK")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var rows []struct {
		Country string `json:"country"`
		Code    string `json:"code"`
	}
	json.NewDecoder(resp.Body).Decode(&rows)
	if len(rows) < 5 {
		t.Fatalf("expected several UK catalog entries (BoE + ONS), got %d", len(rows))
	}
	codes := map[string]bool{}
	for _, r := range rows {
		if r.Country != "UK" {
			t.Errorf("expected only UK entries, got %q", r.Country)
		}
		codes[r.Code] = true
	}
	for _, want := range []string{"RATE", "CPI", "UNRATE"} {
		if !codes[want] {
			t.Errorf("expected UK.%s in catalog", want)
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
	if len(cbs) < 3 {
		t.Fatalf("expected at least 3 central banks (Fed + ECB + BoE), got %d", len(cbs))
	}
	foundFed, foundECB, foundBoE := false, false, false
	for _, cb := range cbs {
		if cb.Country == "US" && cb.Indicators > 0 {
			foundFed = true
		}
		if cb.Country == "EZ" && cb.Indicators > 0 {
			foundECB = true
		}
		if cb.Country == "UK" && cb.Indicators > 0 {
			foundBoE = true
		}
	}
	if !foundFed {
		t.Error("expected Federal Reserve in central banks list")
	}
	if !foundECB {
		t.Error("expected ECB in central banks list")
	}
	if !foundBoE {
		t.Error("expected Bank of England in central banks list")
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
