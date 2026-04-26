package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sync"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"stocktopus/internal/agent"
	"stocktopus/internal/hub"
	"stocktopus/internal/news"
	"stocktopus/internal/store"
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

// SymbolLister returns the symbols currently being tracked.
type SymbolLister interface {
	ActiveSymbols() []string
}

type Server struct {
	config     Config
	logger     *slog.Logger
	httpServer *http.Server
	pages      map[string]*template.Template
	hub        *hub.Hub
	debug      *DebugBroadcaster
	symbols    SymbolLister
	news       *news.Client
	pipeline   *agent.Pipeline
	store      *store.Store
}

func New(cfg Config, h *hub.Hub, debug *DebugBroadcaster, symbols SymbolLister, newsClient *news.Client, pipeline *agent.Pipeline, st *store.Store, logger *slog.Logger) (*Server, error) {
	s := &Server{
		config:   cfg,
		logger:   logger,
		hub:      h,
		debug:    debug,
		symbols:  symbols,
		pipeline: pipeline,
		store:    st,
		news:     newsClient,
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

	pageNames := []string{"watchlist", "stock", "security", "screener", "feed", "debug", "news"}
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

// ExportRoutes registers all routes on the given mux. Used by tests.
func (s *Server) ExportRoutes(mux *http.ServeMux) {
	s.registerRoutes(mux)
}

func (s *Server) registerRoutes(mux *http.ServeMux) {
	// Static files
	staticFS := http.FileServer(http.Dir(staticDir()))
	mux.Handle("GET /static/", http.StripPrefix("/static/", staticFS))

	// API
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/symbols", s.handleSymbols)
	mux.HandleFunc("GET /api/news/{category}", s.handleNewsAPI)
	mux.HandleFunc("GET /api/search", s.handleSearch)
	mux.HandleFunc("GET /api/chart/eod/{symbol}", s.handleChartEOD)
	mux.HandleFunc("GET /api/article", s.handleArticle)
	mux.HandleFunc("GET /api/article/entities", s.handleArticleEntities)
	mux.HandleFunc("GET /api/chart/intraday/{interval}/{symbol}", s.handleChartIntraday)
	mux.HandleFunc("GET /api/security/{symbol}/profile", s.handleSecurityProfile)
	mux.HandleFunc("GET /api/security/{symbol}/metrics", s.handleSecurityMetrics)
	mux.HandleFunc("GET /api/security/{symbol}/financials", s.handleSecurityFinancials)
	mux.HandleFunc("GET /api/security/{symbol}/estimates", s.handleSecurityEstimates)
	mux.HandleFunc("GET /api/security/{symbol}/peers", s.handleSecurityPeers)
	mux.HandleFunc("GET /api/security/{symbol}/intelligence", s.handleIntelligence)
	mux.HandleFunc("GET /api/security/{symbol}/intelligence/status", s.handleIntelligenceStatus)
	mux.HandleFunc("POST /api/security/{symbol}/intelligence/refresh", s.handleIntelligenceRefresh)
	mux.HandleFunc("GET /api/agent/status", s.handleAgentStatus)
	mux.HandleFunc("GET /api/sic", s.handleSICCodes)
	mux.HandleFunc("GET /api/watchlists", s.handleGetWatchlists)
	mux.HandleFunc("POST /api/watchlists", s.handleCreateWatchlist)
	mux.HandleFunc("POST /api/watchlists/{id}/symbols", s.handleAddToWatchlist)
	mux.HandleFunc("DELETE /api/watchlists/{id}/symbols/{symbol}", s.handleRemoveFromWatchlist)
	mux.HandleFunc("GET /api/watchlists/quotes", s.handleWatchlistQuotes)
	mux.HandleFunc("GET /api/security/{symbol}/competitors", s.handleCompetitors)

	// WebSocket
	mux.HandleFunc("GET /ws", s.handleWebSocket)
	mux.HandleFunc("GET /ws/debug", s.handleDebugWS)

	// Pages
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /watchlist", s.handleWatchlist)
	mux.HandleFunc("GET /stock/{symbol}", s.handleStock)
	mux.HandleFunc("GET /security/{symbol}", s.handleSecurity)
	mux.HandleFunc("GET /screener", s.handleScreener)
	mux.HandleFunc("GET /feed", s.handleFeed)
	mux.HandleFunc("GET /news", s.handleNews)
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
	s.renderPage(w, r, "watchlist.html", map[string]any{
		"Title":  "Watchlist",
		"Active": "watchlist",
	})
}

func (s *Server) handleStock(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	s.renderPage(w, r, "stock.html", map[string]any{
		"Title":  symbol,
		"Active": "graph",
		"Symbol": symbol,
	})
}

func (s *Server) handleSecurity(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	s.renderPage(w, r, "security.html", map[string]any{
		"Title":  symbol + " — Info",
		"Active": "info",
		"Symbol": symbol,
	})
}

func (s *Server) handleScreener(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, r, "screener.html", map[string]any{
		"Title":  "Screener",
		"Active": "screener",
	})
}

func (s *Server) handleFeed(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, r, "feed.html", map[string]any{
		"Title":  "Feed",
		"Active": "feed",
	})
}

func (s *Server) handleNews(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, r, "news.html", map[string]any{
		"Title":  "News",
		"Active": "news",
	})
}

func (s *Server) handleNewsAPI(w http.ResponseWriter, r *http.Request) {
	cat := news.Category(r.PathValue("category"))
	symbol := r.URL.Query().Get("symbol")
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	page := 0
	if p := r.URL.Query().Get("page"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n >= 0 {
			page = n
		}
	}

	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	items, err := s.news.GetNewsWithDates(r.Context(), cat, symbol, page, limit, from, to)
	if err != nil {
		s.logger.Error("news fetch failed", "category", cat, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (s *Server) handleSecurityProfile(w http.ResponseWriter, r *http.Request) {
	s.proxyFMP(w, r, func(sym string) (json.RawMessage, error) {
		return s.news.GetProfile(r.Context(), sym)
	})
}

func (s *Server) handleSecurityMetrics(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	metrics, err1 := s.news.GetKeyMetrics(r.Context(), symbol)
	ratios, err2 := s.news.GetRatiosTTM(r.Context(), symbol)

	result := map[string]json.RawMessage{}
	if err1 == nil {
		result["metrics"] = metrics
	}
	if err2 == nil {
		result["ratios"] = ratios
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleSecurityFinancials(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	typ := r.URL.Query().Get("type")
	limit := 4

	var data json.RawMessage
	var err error
	switch typ {
	case "income":
		data, err = s.news.GetIncomeStatement(r.Context(), symbol, limit)
	case "balance":
		data, err = s.news.GetBalanceSheet(r.Context(), symbol, limit)
	case "cashflow":
		data, err = s.news.GetCashFlow(r.Context(), symbol, limit)
	default:
		data, err = s.news.GetIncomeStatement(r.Context(), symbol, limit)
	}

	if err != nil {
		s.logger.Error("financials fetch failed", "symbol", symbol, "type", typ, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) handleSecurityPeers(w http.ResponseWriter, r *http.Request) {
	s.proxyFMP(w, r, func(sym string) (json.RawMessage, error) {
		return s.news.GetPeers(r.Context(), sym)
	})
}

func (s *Server) handleSecurityEstimates(w http.ResponseWriter, r *http.Request) {
	s.proxyFMP(w, r, func(sym string) (json.RawMessage, error) {
		return s.news.GetAnalystEstimates(r.Context(), sym, 5)
	})
}

// proxyFMP is a helper for simple pass-through FMP API handlers.
func (s *Server) proxyFMP(w http.ResponseWriter, r *http.Request, fetch func(string) (json.RawMessage, error)) {
	symbol := r.PathValue("symbol")
	data, err := fetch(symbol)
	if err != nil {
		s.logger.Error("fmp proxy failed", "symbol", symbol, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) handleIntelligence(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	w.Header().Set("Content-Type", "application/json")

	if s.pipeline == nil {
		json.NewEncoder(w).Encode(map[string]string{"error": "agent pipeline not configured"})
		return
	}

	// Check cache first
	ci, err := s.pipeline.GetCached(symbol)
	if err != nil {
		s.logger.Warn("intelligence cache error", "symbol", symbol, "error", err)
	}
	if ci != nil {
		json.NewEncoder(w).Encode(ci)
		return
	}

	// Check if running or recently failed
	status := s.pipeline.GetStatus(symbol)
	if status != nil && (status.Status == agent.StatusRunning || status.Status == agent.StatusFailed) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": status.Status,
			"symbol": symbol,
			"error":  status.Error,
		})
		return
	}

	// Check store directly (bypass freshness check)
	direct, _ := s.pipeline.GetDirect(symbol)
	if direct != nil {
		json.NewEncoder(w).Encode(direct)
		return
	}

	// Trigger analysis
	fmpData := s.gatherFMPData(r.Context(), symbol)
	s.pipeline.Analyze(r.Context(), symbol, fmpData)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "pending",
		"symbol": symbol,
	})
}

func (s *Server) handleIntelligenceStatus(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	w.Header().Set("Content-Type", "application/json")

	if s.pipeline == nil {
		json.NewEncoder(w).Encode(map[string]string{"status": "unavailable"})
		return
	}

	status := s.pipeline.GetStatus(symbol)
	if status != nil {
		json.NewEncoder(w).Encode(status)
	} else {
		// Check if we have cached data
		ci, _ := s.pipeline.GetCached(symbol)
		if ci != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "complete",
				"symbol": symbol,
			})
		} else {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "none",
				"symbol": symbol,
			})
		}
	}
}

func (s *Server) handleIntelligenceRefresh(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	w.Header().Set("Content-Type", "application/json")

	if s.pipeline == nil {
		json.NewEncoder(w).Encode(map[string]string{"error": "agent pipeline not configured"})
		return
	}

	fmpData := s.gatherFMPData(r.Context(), symbol)
	s.pipeline.Analyze(r.Context(), symbol, fmpData)

	json.NewEncoder(w).Encode(map[string]string{"status": "started", "symbol": symbol})
}

func (s *Server) handleAgentStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	status := map[string]interface{}{
		"available": s.pipeline != nil,
	}
	if s.pipeline != nil {
		status["ollamaAvailable"] = s.pipeline.OllamaAvailable()
		status["usage"] = s.pipeline.GetUsage()
		status["pipelines"] = s.pipeline.GetAllStatuses()
	}
	json.NewEncoder(w).Encode(status)
}

func (s *Server) handleCompetitors(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	w.Header().Set("Content-Type", "application/json")

	if s.pipeline == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}

	// Get the parent's analysis to find competitors
	parent, _ := s.pipeline.GetDirect(symbol)
	if parent == nil || len(parent.Competitors) == 0 {
		json.NewEncoder(w).Encode([]any{})
		return
	}

	type CompetitorScore struct {
		Symbol    string  `json:"symbol"`
		Sentiment float64 `json:"sentiment"`
		RiskScore float64 `json:"riskScore"`
		Summary   string  `json:"summary"`
		Status    string  `json:"status"` // "ready", "pending", "none"
	}

	var results []CompetitorScore
	for _, comp := range parent.Competitors {
		ci, _ := s.pipeline.GetDirect(comp)
		if ci != nil {
			results = append(results, CompetitorScore{
				Symbol:    comp,
				Sentiment: ci.Sentiment,
				RiskScore: ci.RiskScore,
				Summary:   ci.Summary,
				Status:    "ready",
			})
		} else {
			status := "none"
			ps := s.pipeline.GetStatus(comp)
			if ps != nil && ps.Status == agent.StatusRunning {
				status = "pending"
			}
			results = append(results, CompetitorScore{
				Symbol:    comp,
				Sentiment: 0,
				RiskScore: 0,
				Status:    status,
			})
		}
	}

	json.NewEncoder(w).Encode(results)
}

func (s *Server) handleSICCodes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	code := r.URL.Query().Get("code")
	if code != "" {
		sic, err := s.store.GetSICCode(code)
		if err != nil || sic == nil {
			json.NewEncoder(w).Encode(map[string]string{})
		} else {
			json.NewEncoder(w).Encode(sic)
		}
		return
	}
	codes, err := s.store.GetAllSICCodes()
	if err != nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	json.NewEncoder(w).Encode(codes)
}

func (s *Server) handleGetWatchlists(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	lists, err := s.store.GetWatchlists()
	if err != nil {
		s.logger.Error("get watchlists failed", "error", err)
		json.NewEncoder(w).Encode([]any{})
		return
	}
	json.NewEncoder(w).Encode(lists)
}

func (s *Server) handleCreateWatchlist(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "store not available"})
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "name required"})
		return
	}
	wl, err := s.store.CreateWatchlist(req.Name)
	if err != nil {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(wl)
}

func (s *Server) handleAddToWatchlist(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var req struct {
		Symbol string `json:"symbol"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Symbol == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "symbol required"})
		return
	}
	err := s.store.AddToWatchlist(id, req.Symbol)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "added", "symbol": req.Symbol})
}

func (s *Server) handleRemoveFromWatchlist(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	symbol := r.PathValue("symbol")
	s.store.RemoveFromWatchlist(id, symbol)
	json.NewEncoder(w).Encode(map[string]string{"status": "removed"})
}

func (s *Server) handleWatchlistQuotes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}

	symbols, err := s.store.GetAllWatchedSymbols()
	if err != nil || len(symbols) == 0 {
		json.NewEncoder(w).Encode([]any{})
		return
	}

	// Batch fetch from FMP
	params := url.Values{}
	params.Set("symbols", strings.Join(symbols, ","))
	params.Set("apikey", s.news.APIKey())

	reqURL := "https://financialmodelingprep.com/stable/batch-quote?" + params.Encode()
	req, err := http.NewRequestWithContext(r.Context(), "GET", reqURL, nil)
	if err != nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	w.Write(body)
}

func getEnvOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// gatherFMPData collects all available FMP data for a symbol as JSON context.
func (s *Server) gatherFMPData(ctx context.Context, symbol string) json.RawMessage {
	data := map[string]json.RawMessage{}

	if profile, err := s.news.GetProfile(ctx, symbol); err == nil {
		data["profile"] = profile
	}
	if metrics, err := s.news.GetKeyMetrics(ctx, symbol); err == nil {
		data["metrics"] = metrics
	}
	if ratios, err := s.news.GetRatiosTTM(ctx, symbol); err == nil {
		data["ratios"] = ratios
	}

	result, _ := json.Marshal(data)
	return result
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]any{})
		return
	}
	results, err := s.news.SearchSymbol(r.Context(), query, 10)
	if err != nil {
		s.logger.Error("search failed", "query", query, "error", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]any{})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func (s *Server) handleChartEOD(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")

	items, err := s.news.GetHistoricalEOD(r.Context(), symbol, from, to)
	if err != nil {
		s.logger.Error("chart eod failed", "symbol", symbol, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// Simple in-memory article cache to prevent re-fetching the same URL
var articleCache = struct {
	sync.RWMutex
	items map[string][]byte
}{items: make(map[string][]byte)}

var entityCache = struct {
	sync.RWMutex
	items   map[string][]byte
	pending map[string]bool
}{items: make(map[string][]byte), pending: make(map[string]bool)}

func (s *Server) handleArticle(w http.ResponseWriter, r *http.Request) {
	articleURL := r.URL.Query().Get("url")
	if articleURL == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "url required"})
		return
	}

	// Check cache first
	articleCache.RLock()
	if cached, ok := articleCache.items[articleURL]; ok {
		articleCache.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}
	articleCache.RUnlock()

	venvPython := "agents/../.venv/bin/python3"
	pythonCmd := "python3"
	if _, err := exec.LookPath(venvPython); err == nil {
		pythonCmd = venvPython
	}

	s.runArticleScript(w, r, pythonCmd, articleURL, func(data []byte) {
		articleCache.Lock()
		articleCache.items[articleURL] = data
		articleCache.Unlock()
	}, "--no-llm")
}

func (s *Server) handleArticleEntities(w http.ResponseWriter, r *http.Request) {
	articleURL := r.URL.Query().Get("url")
	if articleURL == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "url required"})
		return
	}

	// Check cache
	entityCache.RLock()
	if cached, ok := entityCache.items[articleURL]; ok {
		entityCache.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}
	// Check if already pending
	if entityCache.pending[articleURL] {
		entityCache.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "pending"})
		return
	}
	entityCache.RUnlock()

	// Mark as pending
	entityCache.Lock()
	entityCache.pending[articleURL] = true
	entityCache.Unlock()

	venvPython := "agents/../.venv/bin/python3"
	pythonCmd := "python3"
	if _, err := exec.LookPath(venvPython); err == nil {
		pythonCmd = venvPython
	}

	s.runArticleScript(w, r, pythonCmd, articleURL, func(data []byte) {
		entityCache.Lock()
		entityCache.items[articleURL] = data
		delete(entityCache.pending, articleURL)
		entityCache.Unlock()
	})
}

func (s *Server) runArticleScript(w http.ResponseWriter, r *http.Request, pythonCmd, articleURL string, onSuccess func([]byte), extraArgs ...string) {
	args := append([]string{"agents/fetch_article.py", articleURL}, extraArgs...)
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonCmd, args...)
	cmd.Env = append(cmd.Environ(),
		"OLLAMA_HOST="+getEnvOr("OLLAMA_HOST", "http://localhost:11434"),
		"OLLAMA_MODEL="+getEnvOr("OLLAMA_MODEL", "gemma4"),
		"GEMINI_API_KEY="+getEnvOr("GEMINI_API_KEY", ""),
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		s.logger.Error("article fetch failed", "url", articleURL, "error", err, "stderr", stderr.String())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to fetch article"})
		return
	}

	if stderrStr := stderr.String(); stderrStr != "" {
		s.logger.Debug("reader bot", "stderr", stderrStr)
	}

	data := stdout.Bytes()
	if onSuccess != nil {
		onSuccess(data)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) handleChartIntraday(w http.ResponseWriter, r *http.Request) {
	interval := r.PathValue("interval")
	symbol := r.PathValue("symbol")
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")

	// Validate interval
	valid := map[string]bool{"1min": true, "5min": true, "15min": true, "30min": true, "1hour": true, "4hour": true}
	if !valid[interval] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid interval: " + interval})
		return
	}

	items, err := s.news.GetIntradayChart(r.Context(), symbol, interval, from, to)
	if err != nil {
		s.logger.Error("chart intraday failed", "symbol", symbol, "interval", interval, "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (s *Server) handleSymbols(w http.ResponseWriter, r *http.Request) {
	var syms []string
	if s.symbols != nil {
		syms = s.symbols.ActiveSymbols()
	}
	if syms == nil {
		syms = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(syms)
}

func (s *Server) renderPage(w http.ResponseWriter, r *http.Request, name string, data map[string]any) {
	t, ok := s.pages[name]
	if !ok {
		s.logger.Error("template not found", "template", name)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Fragment mode: return only the content block for SPA navigation
	templateName := "layout"
	if r.Header.Get("X-Fragment") == "true" {
		templateName = "content"
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, templateName, data); err != nil {
		s.logger.Error("template render failed", "template", name, "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}
