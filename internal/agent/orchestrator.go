package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"stocktopus/internal/store"
)

// Orchestrator uses the Gemini API to plan research and synthesize analysis.
type Orchestrator struct {
	apiKey string
	logger *slog.Logger
	client *http.Client
}

func NewOrchestrator(geminiAPIKey string, logger *slog.Logger) *Orchestrator {
	return &Orchestrator{
		apiKey: geminiAPIKey,
		logger: logger.With("component", "orchestrator"),
		client: &http.Client{Timeout: 180 * time.Second},
	}
}

// Synthesize takes all gathered data and produces a structured company analysis.
func (o *Orchestrator) Synthesize(ctx context.Context, symbol string, gatheredData json.RawMessage) (*store.CompanyIntelligence, error) {
	prompt := fmt.Sprintf(`You are a senior financial analyst. Analyze the company %s using the data provided below.

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "summary": "One paragraph executive summary of the company's current position",
  "sentiment": <number from -1.0 (very bearish) to 1.0 (very bullish)>,
  "riskScore": <number from 0 (low risk) to 100 (extreme risk)>,
  "confidence": <number from 0.0 to 1.0 indicating your confidence in this analysis>,
  "keyRisks": ["risk 1", "risk 2", "risk 3"],
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "competitors": ["competitor ticker 1", "competitor ticker 2", "competitor ticker 3"],
  "sectorAnalysis": "Brief analysis of the sector outlook",
  "catalysts": ["upcoming catalyst 1", "upcoming catalyst 2"],
  "technicalOutlook": "Brief technical analysis based on price data"
}

Data:
%s`, symbol, string(gatheredData))

	response, err := o.callGemini(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("gemini synthesis: %w", err)
	}

	// Parse the structured response
	var analysis struct {
		Summary         string   `json:"summary"`
		Sentiment       float64  `json:"sentiment"`
		RiskScore       float64  `json:"riskScore"`
		Confidence      float64  `json:"confidence"`
		KeyRisks        []string `json:"keyRisks"`
		Opportunities   []string `json:"opportunities"`
		Competitors     []string `json:"competitors"`
		SectorAnalysis  string   `json:"sectorAnalysis"`
		Catalysts       []string `json:"catalysts"`
		TechnicalOutlook string  `json:"technicalOutlook"`
	}

	if err := json.Unmarshal([]byte(response), &analysis); err != nil {
		o.logger.Warn("failed to parse structured analysis, using raw", "error", err)
		// Fall back to storing raw text
		return &store.CompanyIntelligence{
			Symbol:       symbol,
			Summary:      response,
			Sentiment:    0,
			RiskScore:    50,
			Confidence:   0.3,
			GeneratedAt:  time.Now().UTC(),
			ModelVersion: "gemini-fallback",
		}, nil
	}

	// Build full analysis JSON
	fullAnalysis, _ := json.Marshal(analysis)

	return &store.CompanyIntelligence{
		Symbol:        symbol,
		Summary:       analysis.Summary,
		Sentiment:     analysis.Sentiment,
		RiskScore:     analysis.RiskScore,
		Confidence:    analysis.Confidence,
		KeyRisks:      analysis.KeyRisks,
		Opportunities: analysis.Opportunities,
		Competitors:   analysis.Competitors,
		Analysis:      fullAnalysis,
		GeneratedAt:   time.Now(),
		ModelVersion:  "gemini-orchestrated",
	}, nil
}

// callGemini sends a prompt to the Gemini API and returns the text response.
func (o *Orchestrator) callGemini(ctx context.Context, prompt string) (string, error) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=%s", o.apiKey)

	reqBody, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]string{
					{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.3,
			"maxOutputTokens": 4096,
		},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := o.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("gemini request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("gemini read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini %d: %s", resp.StatusCode, string(body))
	}

	// Parse Gemini response
	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal(body, &geminiResp); err != nil {
		return "", fmt.Errorf("gemini parse: %w", err)
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini returned empty response")
	}

	text := geminiResp.Candidates[0].Content.Parts[0].Text

	// Strip markdown code blocks if present
	if len(text) > 7 && text[:7] == "```json" {
		text = text[7:]
	}
	if len(text) > 3 && text[:3] == "```" {
		text = text[3:]
	}
	if len(text) > 3 && text[len(text)-3:] == "```" {
		text = text[:len(text)-3]
	}

	return text, nil
}
