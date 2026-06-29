package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"stocktopus/internal/hub"
)

func testServer(t *testing.T) (*Server, *http.ServeMux) {
	t.Helper()
	logger := slog.Default()
	h := hub.New(logger)
	debug := NewDebugBroadcaster()
	srv, err := New(Config{Port: 0}, h, debug, nil, nil, nil, nil, nil, nil, logger)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	mux := http.NewServeMux()
	srv.registerRoutes(mux)
	return srv, mux
}

func TestHealthEndpoint(t *testing.T) {
	_, mux := testServer(t)

	req := httptest.NewRequest("GET", "/api/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %q", body["status"])
	}
}

func TestIndexRedirect(t *testing.T) {
	_, mux := testServer(t)

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected 307, got %d", w.Code)
	}

	if loc := w.Header().Get("Location"); loc != "/watchlist" {
		t.Errorf("expected redirect to /watchlist, got %q", loc)
	}
}

func TestWatchlistPage(t *testing.T) {
	_, mux := testServer(t)

	req := httptest.NewRequest("GET", "/watchlist", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	if len(body) == 0 {
		t.Error("expected non-empty response body")
	}
}

// TestWatchlistDeclarativeVimNav gates the migration of the /watchlist page
// onto the shared declarative vim-nav engine (issue #118). The watchlists
// tab strip must carry data-vim-row + data-vim-role="tabs" so directional
// keys flow through VimNav, and the JS that builds the tabs/rows must emit
// the per-item / per-row markup the engine reads.
func TestWatchlistDeclarativeVimNav(t *testing.T) {
	_, mux := testServer(t)

	// 1) The watchlists strip is static template markup — assert it directly.
	req := httptest.NewRequest("GET", "/watchlist", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /watchlist: expected 200, got %d", w.Code)
	}
	page := w.Body.String()
	if !strings.Contains(page, `id="watchlist-tabs" data-vim-row`) {
		t.Error("watchlists strip is missing data-vim-row — h/l won't flow through VimNav")
	}
	if !strings.Contains(page, `data-vim-role="tabs"`) {
		t.Error("watchlists strip is missing data-vim-role=\"tabs\"")
	}

	// 2) Tabs and symbol rows are rendered client-side; gate the JS that
	//    builds them. The substrings are unique to the watchlist builders
	//    (a bare data-vim-item already exists for company-panel sparks).
	req2 := httptest.NewRequest("GET", "/static/terminal.js", nil)
	w2 := httptest.NewRecorder()
	mux.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("GET /static/terminal.js: expected 200, got %d", w2.Code)
	}
	js := w2.Body.String()
	if !strings.Contains(js, `data-vim-item style="--wl-color:`) {
		t.Error("watchlist tab builder no longer emits data-vim-item")
	}
	if !strings.Contains(js, `data-vim-row data-vim-action="navigate" data-vim-href="/security/`) {
		t.Error("watchlist symbol-row builder no longer emits data-vim-row navigation markup")
	}
}
