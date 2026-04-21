package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"stocktopus/internal/store"
)

// TaskType identifies what kind of work a task does.
type TaskType string

const (
	TaskFMPProfile     TaskType = "fmp_profile"
	TaskFMPFinancials  TaskType = "fmp_financials"
	TaskWebSearch      TaskType = "web_search"
	TaskSocialSentiment TaskType = "social_sentiment"
	TaskRSSNews        TaskType = "rss_news"
	TaskSECFilings     TaskType = "sec_filings"
	TaskSynthesize     TaskType = "synthesize"
)

// TaskStatus tracks a task's progress.
type TaskStatus string

const (
	StatusPending  TaskStatus = "pending"
	StatusRunning  TaskStatus = "running"
	StatusComplete TaskStatus = "complete"
	StatusFailed   TaskStatus = "failed"
)

// Task represents a unit of work for an agent.
type Task struct {
	ID       string          `json:"id"`
	Type     TaskType        `json:"type"`
	Symbol   string          `json:"symbol"`
	Prompt   string          `json:"prompt"`
	Context  json.RawMessage `json:"context,omitempty"`
	Result   json.RawMessage `json:"result,omitempty"`
	Status   TaskStatus      `json:"status"`
	Error    string          `json:"error,omitempty"`
	Duration time.Duration   `json:"duration,omitempty"`
}

// PipelineStatus represents the overall state of a company analysis.
type PipelineStatus struct {
	Symbol     string     `json:"symbol"`
	Status     TaskStatus `json:"status"`
	Tasks      []Task     `json:"tasks"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt time.Time  `json:"finishedAt,omitempty"`
	Error      string     `json:"error,omitempty"`
}

// StatusCallback is called when pipeline status changes.
type StatusCallback func(status PipelineStatus)

// Pipeline orchestrates the full analysis of a company.
type Pipeline struct {
	orchestrator *Orchestrator
	workers      *WorkerPool
	store        *store.Store
	logger       *slog.Logger
	cacheTTL     time.Duration

	// Active pipelines
	active map[string]*PipelineStatus
	mu     sync.RWMutex

	onStatus StatusCallback
}

// PipelineConfig holds configuration for the pipeline.
type PipelineConfig struct {
	GeminiAPIKey string
	OllamaHost   string
	OllamaModel  string
	NumWorkers   int
	CacheTTL     time.Duration
	PythonPath   string
	AgentsDir    string
}

func NewPipeline(cfg PipelineConfig, st *store.Store, logger *slog.Logger) *Pipeline {
	orch := NewOrchestrator(cfg.GeminiAPIKey, logger)
	workers := NewWorkerPool(cfg.OllamaHost, cfg.OllamaModel, cfg.NumWorkers, cfg.PythonPath, cfg.AgentsDir, logger)

	return &Pipeline{
		orchestrator: orch,
		workers:      workers,
		store:        st,
		logger:       logger.With("component", "pipeline"),
		cacheTTL:     cfg.CacheTTL,
		active:       make(map[string]*PipelineStatus),
	}
}

// SetStatusCallback sets the function called on status changes.
func (p *Pipeline) SetStatusCallback(cb StatusCallback) {
	p.onStatus = cb
}

// GetStatus returns the current pipeline status for a symbol.
func (p *Pipeline) GetStatus(symbol string) *PipelineStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.active[symbol]
}

// GetCached returns cached intelligence from the store.
func (p *Pipeline) GetCached(symbol string) (*store.CompanyIntelligence, error) {
	if p.store.IsFresh(symbol, p.cacheTTL) {
		return p.store.Get(symbol)
	}
	return nil, nil
}

// GetDirect returns intelligence from the store without freshness check.
func (p *Pipeline) GetDirect(symbol string) (*store.CompanyIntelligence, error) {
	return p.store.Get(symbol)
}

// OllamaAvailable checks if the Ollama worker pool can reach its backend.
func (p *Pipeline) OllamaAvailable() bool {
	return p.workers.OllamaAvailable()
}

// Analyze triggers an analysis for a symbol. Returns immediately.
// Results are stored in SQLite and pushed via status callback.
// Uses a detached context so the pipeline survives after the HTTP request ends.
func (p *Pipeline) Analyze(_ context.Context, symbol string, fmpData json.RawMessage) {
	p.mu.Lock()
	if existing, ok := p.active[symbol]; ok && existing.Status == StatusRunning {
		p.mu.Unlock()
		return // Already running
	}

	status := &PipelineStatus{
		Symbol:    symbol,
		Status:    StatusRunning,
		StartedAt: time.Now(),
	}
	p.active[symbol] = status
	p.mu.Unlock()

	// Use a background context with a generous timeout — not tied to HTTP request
	bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	go func() {
		defer cancel()
		p.runPipeline(bgCtx, symbol, fmpData, status)
	}()
}

func (p *Pipeline) runPipeline(ctx context.Context, symbol string, fmpData json.RawMessage, status *PipelineStatus) {
	defer func() {
		if r := recover(); r != nil {
			p.logger.Error("pipeline panic", "symbol", symbol, "panic", r)
			status.Status = StatusFailed
			status.Error = fmt.Sprintf("panic: %v", r)
			status.FinishedAt = time.Now()
			p.emitStatus(*status)
		}
	}()

	p.logger.Info("pipeline started", "symbol", symbol)

	// Phase 1: Gather data from multiple sources in parallel
	tasks := []Task{
		{ID: "web", Type: TaskWebSearch, Symbol: symbol, Status: StatusPending},
		{ID: "rss", Type: TaskRSSNews, Symbol: symbol, Status: StatusPending},
		{ID: "sec", Type: TaskSECFilings, Symbol: symbol, Status: StatusPending},
		{ID: "social", Type: TaskSocialSentiment, Symbol: symbol, Status: StatusPending},
	}

	status.Tasks = tasks
	p.emitStatus(*status)

	// Run all worker tasks in parallel
	var wg sync.WaitGroup
	for i := range tasks {
		wg.Add(1)
		go func(t *Task) {
			defer wg.Done()
			start := time.Now()
			t.Status = StatusRunning
			p.emitStatus(*status)

			result, err := p.workers.Execute(ctx, *t)
			t.Duration = time.Since(start)
			if err != nil {
				t.Status = StatusFailed
				t.Error = err.Error()
				p.logger.Warn("task failed", "task", t.ID, "symbol", symbol, "error", err)
			} else {
				t.Status = StatusComplete
				t.Result = result
			}
			p.emitStatus(*status)
		}(&tasks[i])
	}
	wg.Wait()

	// Phase 2: Synthesize with orchestrator (Gemini)
	p.logger.Info("synthesizing", "symbol", symbol)

	// Collect all results
	gathered := map[string]json.RawMessage{
		"fmp": fmpData,
	}
	for _, t := range tasks {
		if t.Status == StatusComplete && t.Result != nil {
			gathered[t.ID] = t.Result
		}
	}

	gatheredJSON, _ := json.Marshal(gathered)
	analysis, err := p.orchestrator.Synthesize(ctx, symbol, gatheredJSON)
	if err != nil {
		p.logger.Error("synthesis failed", "symbol", symbol, "error", err)
		status.Status = StatusFailed
		status.Error = err.Error()
		status.FinishedAt = time.Now()
		p.emitStatus(*status)
		return
	}

	// Store result
	if err := p.store.Put(analysis); err != nil {
		p.logger.Error("store failed", "symbol", symbol, "error", err)
	}

	// Store training data from this run
	prompt := "Analyze " + symbol + " given the following data"
	completion, _ := json.Marshal(analysis)
	p.store.AddTrainingPair(symbol, prompt, string(completion), "pipeline", 0.8)

	status.Status = StatusComplete
	status.FinishedAt = time.Now()
	p.emitStatus(*status)

	p.logger.Info("pipeline complete", "symbol", symbol, "duration", time.Since(status.StartedAt))
}

func (p *Pipeline) emitStatus(status PipelineStatus) {
	if p.onStatus != nil {
		p.onStatus(status)
	}
}
