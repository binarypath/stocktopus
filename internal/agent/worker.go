package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"path/filepath"
	"time"
)

// WorkerPool manages Ollama workers and Python agent scripts.
type WorkerPool struct {
	ollamaHost  string
	ollamaModel string
	pythonPath  string
	agentsDir   string
	logger      *slog.Logger
	client      *http.Client
	sem         chan struct{} // concurrency limiter
}

func NewWorkerPool(ollamaHost, ollamaModel string, numWorkers int, pythonPath, agentsDir string, logger *slog.Logger) *WorkerPool {
	if ollamaHost == "" {
		ollamaHost = "http://localhost:11434"
	}
	if ollamaModel == "" {
		ollamaModel = "gemma4"
	}
	if pythonPath == "" {
		pythonPath = "python3"
	}
	if numWorkers <= 0 {
		numWorkers = 3
	}

	return &WorkerPool{
		ollamaHost:  ollamaHost,
		ollamaModel: ollamaModel,
		pythonPath:  pythonPath,
		agentsDir:   agentsDir,
		logger:      logger.With("component", "worker-pool"),
		client:      &http.Client{Timeout: 120 * time.Second},
		sem:         make(chan struct{}, numWorkers),
	}
}

// Execute runs a task either via Python script or Ollama.
func (wp *WorkerPool) Execute(ctx context.Context, task Task) (json.RawMessage, error) {
	// Acquire semaphore
	select {
	case wp.sem <- struct{}{}:
		defer func() { <-wp.sem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	switch task.Type {
	case TaskWebSearch:
		return wp.runPythonAgent(ctx, "web_search.py", task.Symbol)
	case TaskRSSNews:
		return wp.runPythonAgent(ctx, "rss_news.py", task.Symbol)
	case TaskSECFilings:
		return wp.runPythonAgent(ctx, "sec_filings.py", task.Symbol)
	case TaskSocialSentiment:
		return wp.runPythonAgent(ctx, "social_sentiment.py", task.Symbol)
	default:
		return wp.callOllama(ctx, task.Prompt)
	}
}

// runPythonAgent executes a Python script and returns its JSON output.
func (wp *WorkerPool) runPythonAgent(ctx context.Context, script, symbol string) (json.RawMessage, error) {
	scriptPath := filepath.Join(wp.agentsDir, script)
	venvPython := filepath.Join(wp.agentsDir, "..", ".venv", "bin", "python3")

	// Prefer venv python if available
	pythonCmd := wp.pythonPath
	if _, err := exec.LookPath(venvPython); err == nil {
		pythonCmd = venvPython
	}

	cmd := exec.CommandContext(ctx, pythonCmd, scriptPath, symbol)
	cmd.Env = append(cmd.Environ(),
		"OLLAMA_HOST="+wp.ollamaHost,
		"OLLAMA_MODEL="+wp.ollamaModel,
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	wp.logger.Debug("running agent", "script", script, "symbol", symbol)

	if err := cmd.Run(); err != nil {
		wp.logger.Warn("agent failed", "script", script, "stderr", stderr.String(), "error", err)
		// Return empty result rather than failing the whole pipeline
		return json.RawMessage(`{"error":"` + script + ` failed: ` + err.Error() + `"}`), nil
	}

	output := stdout.Bytes()
	if !json.Valid(output) {
		wp.logger.Warn("agent returned invalid JSON", "script", script, "output", stdout.String())
		return json.RawMessage(`{"error":"invalid JSON from ` + script + `","raw":"` + stdout.String() + `"}`), nil
	}

	return json.RawMessage(output), nil
}

// callOllama sends a prompt to the local Ollama instance.
func (wp *WorkerPool) callOllama(ctx context.Context, prompt string) (json.RawMessage, error) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model":  wp.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"options": map[string]interface{}{
			"temperature": 0.3,
			"num_predict": 2048,
		},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", wp.ollamaHost+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("ollama request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := wp.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("ollama read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, string(body))
	}

	// Extract the response text
	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return nil, fmt.Errorf("ollama parse: %w", err)
	}

	return json.RawMessage(`{"text":` + string(mustJSON(ollamaResp.Response)) + `}`), nil
}

// OllamaAvailable checks if Ollama is reachable.
func (wp *WorkerPool) OllamaAvailable() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", wp.ollamaHost+"/api/tags", nil)
	resp, err := wp.client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func mustJSON(s string) []byte {
	b, _ := json.Marshal(s)
	return b
}
