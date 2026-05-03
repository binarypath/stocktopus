package trading

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"stocktopus/internal/news"
	"stocktopus/internal/store"
)

// StatusCallback is called when pipeline status changes.
type StatusCallback func(result PipelineResult)

// TradingPipeline orchestrates the full multi-agent trading analysis.
type TradingPipeline struct {
	analysts *AnalystRunner
	store    *store.Store
	logger   *slog.Logger

	// Active analyses
	active map[string]*PipelineResult
	mu     sync.RWMutex

	onStatus StatusCallback
}

// TradingPipelineConfig holds configuration for the trading pipeline.
type TradingPipelineConfig struct {
	OllamaHost  string
	OllamaModel string // model for analyst agents (default: gemma3)
	DebateRounds int
	RiskDebateRounds int
}

func NewTradingPipeline(cfg TradingPipelineConfig, fmp *news.Client, st *store.Store, logger *slog.Logger) *TradingPipeline {
	analysts := NewAnalystRunner(fmp, cfg.OllamaHost, cfg.OllamaModel, logger)

	return &TradingPipeline{
		analysts: analysts,
		store:    st,
		logger:   logger.With("component", "trading-pipeline"),
		active:   make(map[string]*PipelineResult),
	}
}

// SetStatusCallback sets the function called on pipeline progress updates.
func (tp *TradingPipeline) SetStatusCallback(cb StatusCallback) {
	tp.onStatus = cb
}

// GetResult returns the current/last result for a symbol.
func (tp *TradingPipeline) GetResult(symbol string) *PipelineResult {
	tp.mu.RLock()
	defer tp.mu.RUnlock()
	if r, ok := tp.active[symbol]; ok {
		cp := *r
		return &cp
	}
	return nil
}

// IsRunning checks if an analysis is currently in progress for a symbol.
func (tp *TradingPipeline) IsRunning(symbol string) bool {
	tp.mu.RLock()
	defer tp.mu.RUnlock()
	r, ok := tp.active[symbol]
	if !ok {
		return false
	}
	return r.FinishedAt.IsZero()
}

// EstimatedCost returns the estimated USD cost for a full analysis.
func (tp *TradingPipeline) EstimatedCost() float64 {
	// 4 Ollama calls: free
	// Research debate: ~4 Gemini Flash calls × ~1K tokens each
	// Research manager: ~1 Gemini Flash call
	// Risk debate: ~6 Gemini Flash calls
	// Portfolio manager: ~1 Gemini Flash call
	// Total: ~12 Gemini Flash calls
	// Gemini Flash: $0.10/1M input + $0.40/1M output
	// Estimate ~1K input + ~500 output per call = ~$0.00035 per call
	return 0.035
}

// Analyze triggers a full trading analysis pipeline for a symbol.
// This is button-triggered only — never automatic.
func (tp *TradingPipeline) Analyze(ctx context.Context, symbol string) {
	tp.mu.Lock()
	if existing, ok := tp.active[symbol]; ok && existing.FinishedAt.IsZero() {
		tp.mu.Unlock()
		return // Already running
	}

	result := &PipelineResult{
		Symbol:    symbol,
		StartedAt: time.Now().UTC(),
		Stages: []Stage{
			{Name: "technical", Status: StagePending},
			{Name: "fundamentals", Status: StagePending},
			{Name: "news", Status: StagePending},
			{Name: "sentiment", Status: StagePending},
			{Name: "research_debate", Status: StagePending},
			{Name: "trader", Status: StagePending},
			{Name: "risk_debate", Status: StagePending},
		},
	}
	tp.active[symbol] = result
	tp.mu.Unlock()

	tp.emit(result)

	bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	go func() {
		defer cancel()
		tp.runPipeline(bgCtx, symbol, result)
	}()
}

func (tp *TradingPipeline) runPipeline(ctx context.Context, symbol string, result *PipelineResult) {
	defer func() {
		if r := recover(); r != nil {
			tp.logger.Error("trading pipeline panic", "symbol", symbol, "panic", r)
			result.Error = "pipeline panic"
			result.FinishedAt = time.Now().UTC()
			tp.emit(result)
		}
	}()

	tp.logger.Info("trading analysis started", "symbol", symbol)

	// Phase 1: Run 4 analyst agents in parallel (Ollama — free)
	analystStart := time.Now()
	reports := tp.analysts.RunAll(ctx, symbol, func(name string, status StageStatus) {
		tp.updateStage(result, name, status)
		tp.emit(result)
	})
	result.AnalystReports = reports

	tp.logger.Info("analysts complete", "symbol", symbol,
		"count", len(reports), "duration", time.Since(analystStart))

	// Phase 2: Research debate (Python/LangGraph — future)
	tp.updateStage(result, "research_debate", StageSkipped)

	// Phase 3: Trader agent (Ollama — future)
	tp.updateStage(result, "trader", StageSkipped)

	// Phase 4: Risk debate (Python/LangGraph — future)
	tp.updateStage(result, "risk_debate", StageSkipped)

	// Complete
	result.FinishedAt = time.Now().UTC()
	result.TotalCostUSD = 0 // Phase 1 is Ollama only — free

	// Store the analyst reports as part of company intelligence
	tp.storeResult(symbol, result)

	tp.emit(result)
	tp.logger.Info("trading analysis complete", "symbol", symbol,
		"duration", time.Since(result.StartedAt))
}

func (tp *TradingPipeline) updateStage(result *PipelineResult, name string, status StageStatus) {
	tp.mu.Lock()
	defer tp.mu.Unlock()
	for i := range result.Stages {
		if result.Stages[i].Name == name {
			result.Stages[i].Status = status
			if status == StageRunning {
				result.Stages[i].StartedAt = time.Now().UTC()
			}
			if status == StageComplete || status == StageFailed || status == StageSkipped {
				if !result.Stages[i].StartedAt.IsZero() {
					result.Stages[i].Duration = time.Since(result.Stages[i].StartedAt).Seconds()
				}
			}
			break
		}
	}
}

func (tp *TradingPipeline) emit(result *PipelineResult) {
	if tp.onStatus != nil {
		tp.mu.RLock()
		cp := *result
		tp.mu.RUnlock()
		tp.onStatus(cp)
	}
}

func (tp *TradingPipeline) storeResult(symbol string, result *PipelineResult) {
	// Build a summary from all analyst reports
	var summaryParts []string
	var avgScore float64
	for _, r := range result.AnalystReports {
		if r.Summary != "" {
			summaryParts = append(summaryParts, r.Analyst+": "+r.Summary)
		}
		avgScore += r.Score
	}
	if len(result.AnalystReports) > 0 {
		avgScore /= float64(len(result.AnalystReports))
	}

	analysisJSON, _ := json.Marshal(result)

	ci := &store.CompanyIntelligence{
		Symbol:       symbol,
		Analysis:     analysisJSON,
		Sentiment:    avgScore,
		Summary:      joinTruncate(summaryParts, " | ", 500),
		GeneratedAt:  time.Now().UTC(),
		ModelVersion: "trading-pipeline-v1",
		Confidence:   0.5, // will improve with debate phases
	}

	// Collect risks and opportunities from analyst key points
	for _, r := range result.AnalystReports {
		if r.Score < 0 {
			ci.KeyRisks = append(ci.KeyRisks, r.KeyPoints...)
		} else {
			ci.Opportunities = append(ci.Opportunities, r.KeyPoints...)
		}
	}

	if err := tp.store.Put(ci); err != nil {
		tp.logger.Error("failed to store trading result", "symbol", symbol, "error", err)
	}
}

func joinTruncate(parts []string, sep string, maxLen int) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
		if len(result) > maxLen {
			return result[:maxLen] + "..."
		}
	}
	return result
}
