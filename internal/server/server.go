package server

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"stocktopus/internal/hub"
)

type Config struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

func (c Config) Addr() string {
	host := c.Host
	if host == "" {
		host = "localhost"
	}
	port := c.Port
	if port == 0 {
		port = 8080
	}
	return fmt.Sprintf("%s:%d", host, port)
}

type Server struct {
	config     Config
	logger     *slog.Logger
	httpServer *http.Server
	pages      map[string]*template.Template
	hub        *hub.Hub
	debug      *DebugBroadcaster
}

func New(cfg Config, h *hub.Hub, debug *DebugBroadcaster, logger *slog.Logger) (*Server, error) {
	s := &Server{
		config: cfg,
		logger: logger,
		hub:    h,
		debug:  debug,
	}

	if err := s.loadTemplates(); err != nil {
		return nil, fmt.Errorf("loading templates: %w", err)
	}

	mux := http.NewServeMux()
	s.registerRoutes(mux)

	s.httpServer = &http.Server{
		Addr:         cfg.Addr(),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return s, nil
}

func (s *Server) Start() error {
	s.logger.Info("server starting", "addr", s.httpServer.Addr)
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("server shutting down")
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) loadTemplates() error {
	layoutPath := filepath.Join(templatesDir(), "layout.html")
	s.pages = make(map[string]*template.Template)

	pageNames := []string{"watchlist", "stock", "screener", "feed", "debug"}
	for _, page := range pageNames {
		pagePath := filepath.Join(templatesDir(), page+".html")
		t, err := template.ParseFiles(layoutPath, pagePath)
		if err != nil {
			return fmt.Errorf("parsing %s: %w", page, err)
		}
		s.pages[page+".html"] = t
	}
	return nil
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// Static files
	staticFS := http.FileServer(http.Dir(staticDir()))
	mux.Handle("GET /static/", http.StripPrefix("/static/", staticFS))

	// API
	mux.HandleFunc("GET /api/health", s.handleHealth)

	// WebSocket
	mux.HandleFunc("GET /ws", s.handleWebSocket)
	mux.HandleFunc("GET /ws/debug", s.handleDebugWS)

	// Pages
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /watchlist", s.handleWatchlist)
	mux.HandleFunc("GET /stock/{symbol}", s.handleStock)
	mux.HandleFunc("GET /screener", s.handleScreener)
	mux.HandleFunc("GET /feed", s.handleFeed)
	mux.HandleFunc("GET /debug", s.handleDebug)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/watchlist", http.StatusTemporaryRedirect)
}

func (s *Server) handleWatchlist(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, "watchlist.html", map[string]any{
		"Title":  "Watchlist",
		"Active": "watchlist",
	})
}

func (s *Server) handleStock(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	s.renderPage(w, "stock.html", map[string]any{
		"Title":  symbol,
		"Active": "stock",
		"Symbol": symbol,
	})
}

func (s *Server) handleScreener(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, "screener.html", map[string]any{
		"Title":  "Screener",
		"Active": "screener",
	})
}

func (s *Server) handleFeed(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, "feed.html", map[string]any{
		"Title":  "Feed",
		"Active": "feed",
	})
}

func (s *Server) renderPage(w http.ResponseWriter, name string, data map[string]any) {
	t, ok := s.pages[name]
	if !ok {
		s.logger.Error("template not found", "template", name)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "layout", data); err != nil {
		s.logger.Error("template render failed", "template", name, "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}
