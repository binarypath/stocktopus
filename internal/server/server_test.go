package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"stocktopus/internal/hub"
)

func testServer(t *testing.T) (*Server, *http.ServeMux) {
	t.Helper()
	logger := slog.Default()
	h := hub.New(logger)
	debug := NewDebugBroadcaster()
	srv, err := New(Config{Port: 0}, h, debug, logger)
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
