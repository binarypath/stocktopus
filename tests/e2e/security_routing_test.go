//go:build e2e

package e2e

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// /security/{sym} should keep serving stocks unchanged but 301 to the
// type-specific path when the symbol is detected as a non-stock. The
// per-type routes (/crypto, /etf, /index, /forex) must return 200 with
// the right template (currently stubs except crypto).

// Stocks: no redirect, 200 OK on /security/AAPL.
func TestSmoke_SecurityRouting_StockNoRedirect(t *testing.T) {
	// Use a no-follow client so we observe the raw status from the
	// handler rather than the redirect target.
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(testServer.URL + "/security/AAPL")
	if err != nil {
		t.Fatalf("GET /security/AAPL: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200 for /security/AAPL, got %d (Location=%q)",
			resp.StatusCode, resp.Header.Get("Location"))
	}
}

// Crypto: /security/BTCUSD should 301 to /crypto/BTCUSD once the type
// resolver has seen FMP say "CRYPTO" / "CCC" for the exchange. The first
// hit fetches the profile + caches; subsequent hits hit the cache. We
// validate that either the first or a second call ends up on a 301.
func TestSmoke_SecurityRouting_CryptoRedirect(t *testing.T) {
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	var resp *http.Response
	var err error
	// Two tries — the first may populate the cache, the second will
	// definitely hit it. Tolerate a 502 / 5xx from FMP transient errors.
	for i := 0; i < 2; i++ {
		resp, err = client.Get(testServer.URL + "/security/BTCUSD")
		if err != nil {
			t.Fatalf("GET /security/BTCUSD: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusMovedPermanently {
			break
		}
	}
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("expected 301 for /security/BTCUSD after type resolution, got %d", resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if !strings.HasSuffix(loc, "/crypto/BTCUSD") {
		t.Errorf("expected redirect to /crypto/BTCUSD, got %q", loc)
	}
}

// Per-type stubs: the routes must respond with their template content
// regardless of FMP — they're addressable via the new URL scheme.
func TestSmoke_SecurityRouting_PerTypeRoutes(t *testing.T) {
	cases := []struct {
		path string
	}{
		{"/crypto/BTCUSD"},
		{"/etf/SPY"},
		{"/index/^DJI"},
		{"/forex/USDGBP"},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			resp := get(t, tc.path)
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
			assertContains(t, resp, "<html")
		})
	}
}

// /api/security/{sym}/quote serves the universal quote endpoint used by
// the crypto page (and the routing type-resolver). Confirms the new
// route + the FMP wrapper return a sane shape for a crypto symbol.
func TestSmoke_SecurityQuote_Crypto(t *testing.T) {
	resp := get(t, "/api/security/BTCUSD/quote")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	if !strings.HasPrefix(strings.TrimSpace(s), "[") {
		t.Fatalf("expected JSON array, got: %.200s", s)
	}
	if !strings.Contains(s, `"BTCUSD"`) {
		t.Errorf("expected symbol BTCUSD in quote body, got: %.200s", s)
	}
	// FMP may emit `"exchange":"CRYPTO"` or `"exchange": "CRYPTO"`
	// depending on the version — match either.
	if !strings.Contains(s, `"CRYPTO"`) {
		t.Errorf("expected exchange CRYPTO in quote body, got: %.200s", s)
	}
}

// The crypto page template is wired to load /static/crypto.js — verify
// the file is served by the static handler so the page actually has
// behaviour, not just the HTML shell.
func TestSmoke_SecurityRouting_CryptoStaticAsset(t *testing.T) {
	resp := get(t, "/static/crypto.js")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	assertContains(t, resp, "crypto.js")
}

// Same for the ETF page — etf.js must be reachable.
func TestSmoke_SecurityRouting_ETFStaticAsset(t *testing.T) {
	resp := get(t, "/static/etf.js")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	assertContains(t, resp, "etf.js")
}

// /api/security/{sym}/etf-holdings returns the holdings array for an
// ETF. Each row carries `asset` (underlying ticker) + `weightPercentage`.
func TestSmoke_ETFHoldings(t *testing.T) {
	resp := get(t, "/api/security/SPY/etf-holdings")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	if !strings.HasPrefix(strings.TrimSpace(s), "[") {
		t.Fatalf("expected JSON array, got: %.200s", s)
	}
	for _, want := range []string{`"asset"`, `"weightPercentage"`} {
		if !strings.Contains(s, want) {
			t.Errorf("expected %s in holdings body, got: %.200s", want, s)
		}
	}
}

// /api/security/{sym}/etf-info returns fund metadata + sectorsList.
func TestSmoke_ETFInfo(t *testing.T) {
	resp := get(t, "/api/security/SPY/etf-info")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	for _, want := range []string{`"expenseRatio"`, `"sectorsList"`, `"SPY"`} {
		if !strings.Contains(s, want) {
			t.Errorf("expected %s in info body, got: %.200s", want, s)
		}
	}
}

// Same for the index page — index_page.js must be reachable.
func TestSmoke_SecurityRouting_IndexStaticAsset(t *testing.T) {
	resp := get(t, "/static/index_page.js")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	assertContains(t, resp, "index_page.js")
}

// Same for the forex page — forex.js must be reachable.
func TestSmoke_SecurityRouting_ForexStaticAsset(t *testing.T) {
	resp := get(t, "/static/forex.js")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	assertContains(t, resp, "forex.js")
}

// /security/USDGBP should 301 to /forex/USDGBP. The resolver picks up
// exchange=FOREX via the /stable/quote fallback (profile is empty for
// forex pairs).
func TestSmoke_SecurityRouting_ForexRedirect(t *testing.T) {
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	var resp *http.Response
	var err error
	for i := 0; i < 2; i++ {
		resp, err = client.Get(testServer.URL + "/security/USDGBP")
		if err != nil {
			t.Fatalf("GET /security/USDGBP: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusMovedPermanently {
			break
		}
	}
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("expected 301 for /security/USDGBP, got %d", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.HasSuffix(loc, "/forex/USDGBP") {
		t.Errorf("expected redirect to /forex/USDGBP, got %q", loc)
	}
}

// /api/security/^DJI/index-constituents returns the 30 Dow components.
// Each row carries `symbol`, `name`, `sector`, `subSector`.
func TestSmoke_IndexConstituents(t *testing.T) {
	resp := get(t, "/api/security/%5EDJI/index-constituents")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	if !strings.HasPrefix(strings.TrimSpace(s), "[") {
		t.Fatalf("expected JSON array, got: %.200s", s)
	}
	for _, want := range []string{`"symbol"`, `"sector"`} {
		if !strings.Contains(s, want) {
			t.Errorf("expected %s in constituents body, got: %.200s", want, s)
		}
	}
}

// /api/batch-quote fronts FMP's batch quote endpoint. Verify it returns
// an array for a small set.
func TestSmoke_BatchQuote(t *testing.T) {
	resp := get(t, "/api/batch-quote?symbols=AAPL,MSFT")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	s := string(body)
	if !strings.HasPrefix(strings.TrimSpace(s), "[") {
		t.Fatalf("expected JSON array, got: %.200s", s)
	}
}

// SPY is an ETF — /security/SPY should 301 to /etf/SPY once the type
// resolver has seen isEtf=true on the profile.
func TestSmoke_SecurityRouting_ETFRedirect(t *testing.T) {
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	var resp *http.Response
	var err error
	for i := 0; i < 2; i++ {
		resp, err = client.Get(testServer.URL + "/security/SPY")
		if err != nil {
			t.Fatalf("GET /security/SPY: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode == http.StatusMovedPermanently {
			break
		}
	}
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("expected 301 for /security/SPY, got %d", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.HasSuffix(loc, "/etf/SPY") {
		t.Errorf("expected redirect to /etf/SPY, got %q", loc)
	}
}

// Index symbols use '^' prefix — the resolver short-circuits without a
// profile call. /security/^DJI should 301 → /index/^DJI even before any
// FMP traffic. Verifies the syntactic short-circuit in resolveSecurityType.
func TestSmoke_SecurityRouting_IndexShortCircuit(t *testing.T) {
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(testServer.URL + "/security/%5EDJI") // url-encoded ^
	if err != nil {
		t.Fatalf("GET /security/^DJI: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMovedPermanently {
		t.Fatalf("expected 301 for /security/^DJI, got %d", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); !strings.Contains(loc, "/index/") {
		t.Errorf("expected redirect to /index/..., got %q", loc)
	}
}
