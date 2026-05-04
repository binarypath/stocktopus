package trading

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
	"strings"
	"time"

	"stocktopus/internal/store"
)

// PeopleExtractor extracts key people changes from SEC 8-K filings.
type PeopleExtractor struct {
	ollamaHost  string
	ollamaModel string
	agentsDir   string
	store       *store.Store
	client      *http.Client
	logger      *slog.Logger
}

func NewPeopleExtractor(ollamaHost, ollamaModel, agentsDir string, st *store.Store, logger *slog.Logger) *PeopleExtractor {
	if ollamaHost == "" {
		ollamaHost = "http://localhost:11434"
	}
	if ollamaModel == "" {
		ollamaModel = "gemma3"
	}
	return &PeopleExtractor{
		ollamaHost:  ollamaHost,
		ollamaModel: ollamaModel,
		agentsDir:   agentsDir,
		store:       st,
		client:      &http.Client{Timeout: 60 * time.Second},
		logger:      logger.With("component", "people-extractor"),
	}
}

// ExtractFromFilings processes recent 8-K filings for a symbol and extracts key people changes.
func (pe *PeopleExtractor) ExtractFromFilings(ctx context.Context, symbol string) {
	filings, err := pe.store.GetSECFilings(symbol, "8-K", 10)
	if err != nil || len(filings) == 0 {
		return
	}

	// Check if we already have people for this symbol (avoid re-processing)
	existing, _ := pe.store.GetKeyPeople(symbol)
	existingSources := make(map[string]bool)
	for _, p := range existing {
		existingSources[p.Source] = true
	}

	for _, f := range filings {
		if existingSources[f.Link] {
			continue // Already processed this filing
		}

		pe.logger.Debug("extracting people from 8-K", "symbol", symbol, "date", f.FilingDate)

		// Fetch filing text via fetch_article.py (--no-llm flag for text only)
		text := pe.fetchFilingText(ctx, f.Link)
		if text == "" {
			continue
		}

		// Extract people via Ollama
		people := pe.extractPeople(ctx, symbol, text, f.FilingDate, f.Link)
		for _, p := range people {
			if err := pe.store.PutKeyPerson(p); err != nil {
				pe.logger.Debug("failed to store person", "error", err)
			}
		}
	}
}

func (pe *PeopleExtractor) fetchFilingText(ctx context.Context, url string) string {
	scriptPath := filepath.Join(pe.agentsDir, "fetch_article.py")
	venvPython := filepath.Join(pe.agentsDir, "..", ".venv", "bin", "python3")

	pythonCmd := "python3"
	if _, err := exec.LookPath(venvPython); err == nil {
		pythonCmd = venvPython
	}

	fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(fetchCtx, pythonCmd, scriptPath, url, "--no-llm")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		pe.logger.Debug("fetch_article failed for SEC filing", "url", url, "error", err)
		return ""
	}

	var result struct {
		Paragraphs []struct {
			Text string `json:"text"`
		} `json:"paragraphs"`
		WordCount int `json:"wordCount"`
	}
	if json.Unmarshal(stdout.Bytes(), &result) != nil || result.WordCount < 20 {
		return ""
	}

	var texts []string
	for _, p := range result.Paragraphs {
		texts = append(texts, p.Text)
	}

	// Truncate to ~3000 chars for the LLM
	full := strings.Join(texts, " ")
	if len(full) > 3000 {
		full = full[:3000]
	}
	return full
}

func (pe *PeopleExtractor) extractPeople(ctx context.Context, symbol, text, filingDate, source string) []store.KeyPerson {
	date := filingDate
	if len(date) > 10 {
		date = date[:10]
	}

	prompt := fmt.Sprintf(`Extract executive and board member changes from this SEC 8-K filing for %s.
Look for: appointments, resignations, departures, promotions, compensation changes.
If no personnel changes are mentioned, return an empty people array.

Filing text:
%s`, symbol, text)

	reqBody, _ := json.Marshal(map[string]interface{}{
		"model":  pe.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"format": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"people": map[string]interface{}{
					"type": "array",
					"items": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"name":      map[string]string{"type": "string"},
							"title":     map[string]string{"type": "string"},
							"eventType": map[string]interface{}{"type": "string", "enum": []string{"appointed", "resigned", "departed", "promoted"}},
						},
						"required": []string{"name", "title", "eventType"},
					},
				},
			},
			"required": []string{"people"},
		},
		"options": map[string]interface{}{
			"temperature": 0.1,
			"num_predict": 512,
		},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", pe.ollamaHost+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := pe.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if json.Unmarshal(body, &ollamaResp) != nil {
		return nil
	}

	var parsed struct {
		People []struct {
			Name      string `json:"name"`
			Title     string `json:"title"`
			EventType string `json:"eventType"`
		} `json:"people"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(ollamaResp.Response)), &parsed) != nil {
		return nil
	}

	var result []store.KeyPerson
	for _, p := range parsed.People {
		if p.Name == "" {
			continue
		}
		result = append(result, store.KeyPerson{
			Symbol:    symbol,
			Name:      p.Name,
			Title:     p.Title,
			EventType: p.EventType,
			EventDate: date,
			Source:    source,
		})
	}
	return result
}
