//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"stocktopus/internal/hub"
	"stocktopus/internal/news"
	"stocktopus/internal/newspoller"
	"stocktopus/internal/poller"
	"stocktopus/internal/provider/financialmodelingprep"
	"stocktopus/internal/server"
)

var (
	testServer *httptest.Server
	apiKey     string
)

func TestMain(m *testing.M) {
	apiKey = os.Getenv("STOCK_API_KEY")
	if apiKey == "" {
		os.Exit(0)
	}

	// Ensure CWD is project root so agents/ scripts are found
	if _, err := os.Stat("agents"); err != nil {
		os.Chdir("../..")
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	// Provider
	prov := financialmodelingprep.NewProvider(financialmodelingprep.Config{
		APIKey:  apiKey,
		Timeout: 15 * time.Second,
	})

	// Hub
	h := hub.New(logger)
	go h.Run()

	// Poller with long interval to avoid rate-limiting during tests
	poll := poller.New(prov, h, 5*time.Minute, logger)

	// News client + news poller (short interval for tests)
	newsClient := news.New(apiKey, "https://financialmodelingprep.com")
	np := newspoller.New(newsClient, h, 3*time.Second, logger)

	// Composite subscription handler
	composite := hub.NewCompositeHandler()
	composite.Register("quote:", poll)
	composite.Register("news:", np)
	h.SetSubscriptionHandler(composite)

	go poll.Run(context.Background())
	go np.Run(context.Background())

	// Debug broadcaster
	debug := server.NewDebugBroadcaster()

	// Server
	srv, err := server.New(server.Config{Port: 0}, h, debug, poll, newsClient, nil, nil, logger)
	if err != nil {
		panic("failed to create server: " + err.Error())
	}

	mux := http.NewServeMux()
	srv.ExportRoutes(mux)
	testServer = httptest.NewServer(mux)
	defer testServer.Close()

	os.Exit(m.Run())
}

// ── Server & Pages ──

func TestSmoke_HealthEndpoint(t *testing.T) {
	resp := get(t, "/api/health")
	defer resp.Body.Close()

	assertStatus(t, resp, 200)

	var body map[string]string
	json.NewDecoder(resp.Body).Decode(&body)
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %q", body["status"])
	}
}

func TestSmoke_Pages(t *testing.T) {
	pages := []string{"/watchlist", "/news", "/screener", "/debug", "/security/AAPL", "/stock/AAPL"}
	for _, path := range pages {
		t.Run(path, func(t *testing.T) {
			resp := get(t, path)
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
			assertContains(t, resp, "<html")
		})
	}
}

func TestSmoke_FragmentMode(t *testing.T) {
	req, _ := http.NewRequest("GET", testServer.URL+"/watchlist", nil)
	req.Header.Set("X-Fragment", "true")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	assertStatus(t, resp, 200)
	body, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(body), "<html") {
		t.Error("fragment response should not contain <html> wrapper")
	}
	if !strings.Contains(string(body), "Watchlist") {
		t.Error("fragment response should contain page content")
	}
}

func TestSmoke_StaticFiles(t *testing.T) {
	files := []string{"/static/style.css", "/static/terminal.js"}
	for _, path := range files {
		t.Run(path, func(t *testing.T) {
			resp := get(t, path)
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
		})
	}
}

// ── FMP API Integration ──

func TestSmoke_QuoteAPI(t *testing.T) {
	prov := financialmodelingprep.NewProvider(financialmodelingprep.Config{
		APIKey:  apiKey,
		Timeout: 15 * time.Second,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	quote, err := prov.GetQuote(ctx, "AAPL")
	if err != nil {
		t.Fatalf("GetQuote failed: %v", err)
	}
	if quote.Symbol != "AAPL" {
		t.Errorf("expected AAPL, got %q", quote.Symbol)
	}
	if quote.Price <= 0 {
		t.Errorf("expected positive price, got %f", quote.Price)
	}
}

func TestSmoke_SearchAPI(t *testing.T) {
	resp := get(t, "/api/search?q=AAPL")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var results []map[string]string
	json.NewDecoder(resp.Body).Decode(&results)
	if len(results) == 0 {
		t.Fatal("expected search results, got empty array")
	}
	if results[0]["symbol"] == "" {
		t.Error("expected symbol field in search result")
	}
	if results[0]["name"] == "" {
		t.Error("expected name field in search result")
	}
}

func TestSmoke_NewsAPI(t *testing.T) {
	resp := get(t, "/api/news/stock?limit=2")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var articles []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&articles)
	if len(articles) == 0 {
		t.Fatal("expected news articles, got empty array")
	}
	if articles[0]["title"] == "" {
		t.Error("expected title field in news article")
	}
}

func TestSmoke_SecurityProfile(t *testing.T) {
	resp := get(t, "/api/security/AAPL/profile")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var data []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	if len(data) == 0 {
		t.Fatal("expected profile data")
	}
	if data[0]["companyName"] == nil {
		t.Error("expected companyName field")
	}
}

func TestSmoke_SecurityMetrics(t *testing.T) {
	resp := get(t, "/api/security/AAPL/metrics")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var data map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	if data["metrics"] == nil && data["ratios"] == nil {
		t.Error("expected metrics or ratios data")
	}
}

func TestSmoke_SecurityFinancials(t *testing.T) {
	types := []string{"income", "balance", "cashflow"}
	for _, typ := range types {
		t.Run(typ, func(t *testing.T) {
			resp := get(t, "/api/security/AAPL/financials?type="+typ)
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
		})
	}
}

func TestSmoke_SecurityEstimates(t *testing.T) {
	resp := get(t, "/api/security/AAPL/estimates")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)
}

func TestSmoke_NewsCategories(t *testing.T) {
	categories := []string{"press-releases", "articles", "stock", "crypto", "forex", "general"}
	for _, cat := range categories {
		t.Run(cat, func(t *testing.T) {
			resp := get(t, "/api/news/"+cat+"?limit=1")
			defer resp.Body.Close()
			assertStatus(t, resp, 200)
		})
	}
}

func TestSmoke_ChartEOD(t *testing.T) {
	resp := get(t, "/api/chart/eod/AAPL?from=2026-03-01&to=2026-04-01")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var bars []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&bars)
	if len(bars) == 0 {
		t.Fatal("expected OHLCV data, got empty array")
	}
	first := bars[0]
	for _, field := range []string{"date", "open", "high", "low", "close"} {
		if first[field] == nil {
			t.Errorf("expected %s field in OHLCV data", field)
		}
	}
	// Verify chronological order (oldest first)
	if len(bars) > 1 && bars[0]["date"].(string) > bars[len(bars)-1]["date"].(string) {
		t.Error("expected data in chronological order (oldest first)")
	}
}

func TestSmoke_SymbolsAPI(t *testing.T) {
	resp := get(t, "/api/symbols")
	defer resp.Body.Close()
	assertStatus(t, resp, 200)

	var symbols []string
	json.NewDecoder(resp.Body).Decode(&symbols)
	// Empty is fine — no subscriptions yet
}

// ── WebSocket ──

func TestSmoke_WebSocketConnect(t *testing.T) {
	wsURL := strings.Replace(testServer.URL, "http://", "ws://", 1) + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket dial failed: %v", err)
	}
	conn.Close(websocket.StatusNormalClosure, "")
}

func TestSmoke_NewsWebSocketSubscribe(t *testing.T) {
	wsURL := strings.Replace(testServer.URL, "http://", "ws://", 1) + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket dial failed: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	// Subscribe to stock news
	msg := `{"type":"subscribe","topic":"news:stock"}`
	err = conn.Write(ctx, websocket.MessageText, []byte(msg))
	if err != nil {
		t.Fatalf("WebSocket write failed: %v", err)
	}

	// Wait for a news update (poller fetches immediately on subscribe)
	// Accept no message if there are no new articles — just verify no error
	_, data, err := conn.Read(ctx)
	if err != nil {
		// Timeout is acceptable — no new news is fine
		t.Logf("no news received (this is OK if no new articles): %v", err)
		return
	}

	var update map[string]interface{}
	json.Unmarshal(data, &update)
	if update["type"] != "news_update" {
		t.Errorf("expected news_update message type, got %v", update["type"])
	}
}

func TestSmoke_WebSocketSubscribe(t *testing.T) {
	wsURL := strings.Replace(testServer.URL, "http://", "ws://", 1) + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket dial failed: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	// Subscribe to AAPL
	msg := `{"type":"subscribe","topic":"quote:AAPL"}`
	err = conn.Write(ctx, websocket.MessageText, []byte(msg))
	if err != nil {
		t.Fatalf("WebSocket write failed: %v", err)
	}

	// Wait for a quote update (poller fetches immediately on first subscribe)
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("WebSocket read failed (timed out waiting for quote): %v", err)
	}

	var update map[string]interface{}
	json.Unmarshal(data, &update)
	if update["type"] != "html" {
		t.Errorf("expected html message type, got %v", update["type"])
	}
	if update["html"] == nil || update["html"] == "" {
		t.Error("expected html content in quote update")
	}
}

// ── Helpers ──

func get(t *testing.T, path string) *http.Response {
	t.Helper()
	resp, err := http.Get(testServer.URL + path)
	if err != nil {
		t.Fatalf("GET %s failed: %v", path, err)
	}
	return resp
}

func assertStatus(t *testing.T, resp *http.Response, expected int) {
	t.Helper()
	if resp.StatusCode != expected {
		t.Errorf("expected status %d, got %d", expected, resp.StatusCode)
	}
}

func assertContains(t *testing.T, resp *http.Response, substr string) {
	t.Helper()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), substr) {
		t.Errorf("response body does not contain %q", substr)
	}
}
