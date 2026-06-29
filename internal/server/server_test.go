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

// TestNewsPageDeclarativeNav verifies the /news page has been migrated from the
// bespoke vimHandlers.news path to the declarative vim-nav engine (issue #119).
//
// The category tab strip is server-rendered in news.html, so its declarative
// contract (data-vim-row on the strip, data-vim-item on each tab) is asserted
// against the page HTML. The news cards are rendered client-side by
// renderNewsCard in terminal.js, so the card contract
// (data-vim-action="open-reader") is asserted against the served static JS.
func TestNewsPageDeclarativeNav(t *testing.T) {
	_, mux := testServer(t)

	// Category tab strip — declarative region + per-tab items in the template.
	req := httptest.NewRequest("GET", "/news", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /news: expected 200, got %d", w.Code)
	}
	page := w.Body.String()
	if !strings.Contains(page, `data-vim-row`) {
		t.Error("/news category strip missing data-vim-row (declarative region)")
	}
	if !strings.Contains(page, `data-vim-item`) {
		t.Error("/news category tabs missing data-vim-item")
	}

	// News cards are client-rendered, so assert the card contract against the
	// served terminal.js (renderNewsCard must emit the canonical open-reader
	// pattern used by the sibling pages, not the legacy data-vim-action="click").
	req = httptest.NewRequest("GET", "/static/terminal.js", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /static/terminal.js: expected 200, got %d", w.Code)
	}
	js := w.Body.String()
	if !strings.Contains(js, `data-vim-action="open-reader"`) {
		t.Error(`renderNewsCard missing data-vim-action="open-reader" (cards not migrated to declarative vim-nav)`)
	}
}
