package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stocktopus/internal/agent"
	"stocktopus/internal/hub"
	"stocktopus/internal/news"
	"stocktopus/internal/newspoller"
	"stocktopus/internal/poller"
	"stocktopus/internal/sectorpoller"
	"stocktopus/internal/provider"
	"stocktopus/internal/provider/alphavantage"
	"stocktopus/internal/provider/financialmodelingprep"
	"stocktopus/internal/provider/polygon"
	"stocktopus/internal/server"
	"stocktopus/internal/store"
)

func main() {
	// Debug broadcaster captures all logs for the /debug console
	debug := server.NewDebugBroadcaster()
	debugWriter := &server.DebugLogWriter{Debug: debug}

	handler := slog.NewTextHandler(debugWriter, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})
	logger := slog.New(handler)
	slog.SetDefault(logger)

	// Create provider
	apiKey := os.Getenv("STOCK_API_KEY")
	providerName := os.Getenv("STOCK_PROVIDER")
	if providerName == "" {
		providerName = "fmp"
	}

	p, err := createProvider(providerName, apiKey)
	if err != nil {
		slog.Error("failed to create provider", "provider", providerName, "error", err)
		os.Exit(1)
	}

	// Health check
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := p.HealthCheck(ctx); err != nil {
		slog.Warn("provider health check failed (continuing anyway)", "error", err)
	} else {
		slog.Info("provider ready", "name", p.Name())
	}

	// Hub
	h := hub.New(logger)
	go h.Run()

	// Poller
	interval := 15 * time.Second
	poll := poller.New(p, h, interval, logger)

	// News client + news poller
	newsClient := news.New(apiKey, "https://financialmodelingprep.com")
	newsClient.SetGeminiKey(os.Getenv("GEMINI_API_KEY"))

	newsPollInterval := 2 * time.Minute
	if envInterval := os.Getenv("NEWS_POLL_INTERVAL"); envInterval != "" {
		if d, err := time.ParseDuration(envInterval); err == nil {
			newsPollInterval = d
		}
	}
	np := newspoller.New(newsClient, h, newsPollInterval, logger)

	// Composite subscription handler (sector poller added after store creation below)
	composite := hub.NewCompositeHandler()
	composite.Register("quote:", poll)
	composite.Register("news:", np)

	appCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go poll.Run(appCtx)
	go np.Run(appCtx)

	// Agent pipeline
	dbPath := "stocktopus.db"
	if envDB := os.Getenv("STOCKTOPUS_DB"); envDB != "" {
		dbPath = envDB
	}
	st, err := store.New(dbPath)
	if err != nil {
		slog.Warn("failed to open intelligence store (continuing without agents)", "error", err)
	}

	var pipeline *agent.Pipeline
	if st != nil {
		geminiKey := os.Getenv("GEMINI_API_KEY")
		ollamaHost := os.Getenv("OLLAMA_HOST")
		ollamaModel := os.Getenv("OLLAMA_MODEL")
		if ollamaModel == "" {
			ollamaModel = "gemma4"
		}
		agentWorkers := 3
		cacheTTL := 24 * time.Hour
		if envTTL := os.Getenv("AGENT_CACHE_TTL"); envTTL != "" {
			if d, err := time.ParseDuration(envTTL); err == nil {
				cacheTTL = d
			}
		}

		pipeline = agent.NewPipeline(agent.PipelineConfig{
			GeminiAPIKey: geminiKey,
			OllamaHost:   ollamaHost,
			OllamaModel:  ollamaModel,
			NumWorkers:   agentWorkers,
			CacheTTL:     cacheTTL,
			PythonPath:   "python3",
			AgentsDir:    "agents",
		}, st, logger)

		// Publish agent status updates via hub
		pipeline.SetStatusCallback(func(status agent.PipelineStatus) {
			data, _ := json.Marshal(map[string]interface{}{
				"type":   "agent_status",
				"topic":  "agent:" + status.Symbol,
				"status": status,
			})
			h.Publish("agent:"+status.Symbol, data)
		})

		slog.Info("agent pipeline ready", "ollamaModel", ollamaModel, "cacheTTL", cacheTTL)
	}

	// Warm up Ollama NER model so first article request is fast
	go func() {
		nerModel := os.Getenv("OLLAMA_NER_MODEL")
		if nerModel == "" {
			nerModel = "gemma3"
		}
		ollamaHost := os.Getenv("OLLAMA_HOST")
		if ollamaHost == "" {
			ollamaHost = "http://localhost:11434"
		}
		slog.Info("warming up NER model", "model", nerModel)
		body, _ := json.Marshal(map[string]interface{}{
			"model":      nerModel,
			"prompt":     "hello",
			"stream":     false,
			"keep_alive": "30m",
			"options":    map[string]interface{}{"num_predict": 1},
		})
		resp, err := http.Post(ollamaHost+"/api/generate", "application/json", bytes.NewReader(body))
		if err != nil {
			slog.Warn("NER model warm-up failed", "error", err)
		} else {
			resp.Body.Close()
			slog.Info("NER model warm", "model", nerModel)
		}
	}()

	// Populate SIC codes on first boot
	if st != nil && st.SICCodeCount() == 0 {
		slog.Info("populating SIC codes...")
		sicCtx, sicCancel := context.WithTimeout(context.Background(), 15*time.Second)
		sicData, err := newsClient.GetSICList(sicCtx)
		sicCancel()
		if err != nil {
			slog.Warn("failed to fetch SIC list", "error", err)
		} else {
			var codes []store.SICCode
			json.Unmarshal(sicData, &codes)
			if err := st.PopulateSIC(codes); err != nil {
				slog.Warn("failed to store SIC codes", "error", err)
			} else {
				slog.Info("SIC codes populated", "count", len(codes))
			}
		}
	}

	// Sector poller (needs store)
	if st != nil {
		sp := sectorpoller.New(newsClient, h, st, 5*time.Minute, logger)
		composite.Register("sector:", sp)
		go sp.Run(appCtx)
	}

	h.SetSubscriptionHandler(composite)

	srv, err := server.New(server.Config{Port: 8080, Host: "localhost"}, h, debug, poll, newsClient, pipeline, st, logger)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	go func() {
		if err := srv.Start(); err != nil {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-appCtx.Done()
	slog.Info("shutdown signal received")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
		os.Exit(1)
	}

	slog.Info("server stopped")
}

func createProvider(name, apiKey string) (provider.StockProvider, error) {
	switch name {
	case "fmp":
		return provider.Create("fmp", financialmodelingprep.Config{
			APIKey:  apiKey,
			Timeout: 30 * time.Second,
		})
	case "polygon":
		return provider.Create("polygon", polygon.Config{
			APIKey:  apiKey,
			Timeout: 30 * time.Second,
			Options: map[string]string{"adjusted": "true"},
		})
	case "alphavantage":
		return provider.Create("alphavantage", alphavantage.Config{
			APIKey:  apiKey,
			Timeout: 30 * time.Second,
		})
	default:
		return provider.Create(name, nil)
	}
}
