package trading

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Debater runs the bull/bear research debate using Ollama.
type Debater struct {
	ollamaHost  string
	ollamaModel string
	client      *http.Client
	logger      *slog.Logger
	rounds      int
}

func NewDebater(ollamaHost, ollamaModel string, rounds int, logger *slog.Logger) *Debater {
	if ollamaHost == "" {
		ollamaHost = "http://localhost:11434"
	}
	if ollamaModel == "" {
		ollamaModel = "gemma3"
	}
	if rounds <= 0 {
		rounds = 2
	}
	return &Debater{
		ollamaHost:  ollamaHost,
		ollamaModel: ollamaModel,
		client:      &http.Client{Timeout: 120 * time.Second},
		logger:      logger.With("component", "debate"),
		rounds:      rounds,
	}
}

// RunResearchDebate executes the bull/bear debate and returns an investment plan.
func (d *Debater) RunResearchDebate(ctx context.Context, symbol string, reports []AnalystReport) (*InvestmentPlan, error) {
	start := time.Now()

	// Build analyst summary for both debaters
	analystSummary := buildAnalystSummary(reports)

	var bullHistory, bearHistory []string
	var lastBullArg, lastBearArg string

	for round := 0; round < d.rounds; round++ {
		d.logger.Info("debate round", "symbol", symbol, "round", round+1, "of", d.rounds)

		// Bull argues
		bullPrompt := buildBullPrompt(symbol, analystSummary, lastBearArg, bullHistory, round)
		bullArg, err := d.callOllama(ctx, bullPrompt)
		if err != nil {
			return nil, fmt.Errorf("bull round %d: %w", round+1, err)
		}
		lastBullArg = bullArg
		bullHistory = append(bullHistory, bullArg)

		// Bear argues
		bearPrompt := buildBearPrompt(symbol, analystSummary, lastBullArg, bearHistory, round)
		bearArg, err := d.callOllama(ctx, bearPrompt)
		if err != nil {
			return nil, fmt.Errorf("bear round %d: %w", round+1, err)
		}
		lastBearArg = bearArg
		bearHistory = append(bearHistory, bearArg)
	}

	// Research manager synthesizes
	plan, err := d.synthesize(ctx, symbol, analystSummary, bullHistory, bearHistory)
	if err != nil {
		return nil, fmt.Errorf("synthesis: %w", err)
	}
	plan.DebateRounds = d.rounds

	d.logger.Info("debate complete", "symbol", symbol, "rating", plan.Rating,
		"duration", time.Since(start), "rounds", d.rounds)

	return plan, nil
}

func buildAnalystSummary(reports []AnalystReport) string {
	var sb strings.Builder
	for _, r := range reports {
		sb.WriteString(fmt.Sprintf("=== %s Analyst (%s, score: %.2f) ===\n", strings.Title(r.Analyst), r.Outlook, r.Score))
		sb.WriteString(r.Summary + "\n")
		if r.Reasoning != "" {
			sb.WriteString("Reasoning: " + r.Reasoning + "\n")
		}
		for _, kp := range r.KeyPoints {
			sb.WriteString("- " + kp + "\n")
		}
		sb.WriteString("\n")
	}
	return sb.String()
}

func buildBullPrompt(symbol, analystSummary, lastBearArg string, history []string, round int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`You are a Bull Researcher advocating for investing in %s. Build a strong, evidence-based case emphasizing growth potential, competitive advantages, and positive indicators.

Focus on:
- **Growth Potential**: Market opportunities, revenue projections, scalability
- **Competitive Advantages**: Unique products, strong branding, dominant market position
- **Positive Indicators**: Financial health, industry trends, positive news
- **Counter the Bear**: Address bearish concerns with specific data and reasoning

Be conversational and engage directly with the bear's points. Debate, don't just list data.

Analyst Reports:
%s`, symbol, analystSummary))

	if round > 0 && lastBearArg != "" {
		sb.WriteString(fmt.Sprintf("\nBear's latest argument:\n%s\n\nCounter this argument specifically.", lastBearArg))
	}

	if len(history) > 0 {
		sb.WriteString("\nYour previous arguments:\n")
		for i, h := range history {
			sb.WriteString(fmt.Sprintf("Round %d: %s\n", i+1, h))
		}
		sb.WriteString("\nBuild on your previous points. Don't repeat yourself.")
	}

	return sb.String()
}

func buildBearPrompt(symbol, analystSummary, lastBullArg string, history []string, round int) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`You are a Bear Researcher making the case against investing in %s. Present a well-reasoned argument emphasizing risks, challenges, and negative indicators.

Focus on:
- **Risks and Challenges**: Market saturation, financial instability, macro threats
- **Competitive Weaknesses**: Weaker positioning, declining innovation, competitor threats
- **Negative Indicators**: Financial data, adverse trends, negative news
- **Counter the Bull**: Expose weaknesses or over-optimistic assumptions in the bull case

Be conversational and engage directly with the bull's points. Debate, don't just list data.

Analyst Reports:
%s`, symbol, analystSummary))

	if lastBullArg != "" {
		sb.WriteString(fmt.Sprintf("\nBull's latest argument:\n%s\n\nCounter this argument specifically.", lastBullArg))
	}

	if len(history) > 0 {
		sb.WriteString("\nYour previous arguments:\n")
		for i, h := range history {
			sb.WriteString(fmt.Sprintf("Round %d: %s\n", i+1, h))
		}
		sb.WriteString("\nBuild on your previous points. Don't repeat yourself.")
	}

	return sb.String()
}

func (d *Debater) synthesize(ctx context.Context, symbol, analystSummary string, bullHistory, bearHistory []string) (*InvestmentPlan, error) {
	var debateLog strings.Builder
	maxRounds := len(bullHistory)
	if len(bearHistory) > maxRounds {
		maxRounds = len(bearHistory)
	}
	for i := 0; i < maxRounds; i++ {
		debateLog.WriteString(fmt.Sprintf("--- Round %d ---\n", i+1))
		if i < len(bullHistory) {
			debateLog.WriteString("BULL: " + bullHistory[i] + "\n\n")
		}
		if i < len(bearHistory) {
			debateLog.WriteString("BEAR: " + bearHistory[i] + "\n\n")
		}
	}

	prompt := fmt.Sprintf(`You are the Research Manager for %s. Evaluate the bull/bear debate and deliver a clear investment plan.

Rating scale (use exactly one):
- Buy: Strong conviction in the bull thesis
- Overweight: Constructive view, gradually increase exposure
- Hold: Balanced view, maintain current position
- Underweight: Cautious view, trim exposure
- Sell: Strong conviction in the bear thesis

Commit to a clear stance when the evidence warrants one. Reserve Hold only when evidence is genuinely balanced.

Analyst Reports:
%s

Debate:
%s`, symbol, analystSummary, debateLog.String())

	reqBody, _ := json.Marshal(map[string]interface{}{
		"model":  d.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"format": map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"rating":        map[string]interface{}{"type": "string", "enum": []string{"Buy", "Overweight", "Hold", "Underweight", "Sell"}},
				"rationale":     map[string]string{"type": "string"},
				"bullArguments": map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}},
				"bearArguments": map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}},
				"keyActions":    map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}},
			},
			"required": []string{"rating", "rationale", "bullArguments", "bearArguments", "keyActions"},
		},
		"options": map[string]interface{}{
			"temperature": 0.3,
			"num_predict": 1024,
		},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", d.ollamaHost+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, string(body))
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	var plan InvestmentPlan
	if err := json.Unmarshal([]byte(strings.TrimSpace(ollamaResp.Response)), &plan); err != nil {
		d.logger.Warn("failed to parse investment plan", "error", err, "raw", ollamaResp.Response)
		return &InvestmentPlan{
			Symbol:    symbol,
			Rating:    RatingHold,
			Rationale: ollamaResp.Response,
		}, nil
	}
	plan.Symbol = symbol

	return &plan, nil
}

// callOllama sends a free-form prompt and returns the text response.
func (d *Debater) callOllama(ctx context.Context, prompt string) (string, error) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model":  d.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"options": map[string]interface{}{
			"temperature": 0.5,
			"num_predict": 512,
		},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", d.ollamaHost+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama %d: %s", resp.StatusCode, string(body))
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return "", fmt.Errorf("parse: %w", err)
	}

	return strings.TrimSpace(ollamaResp.Response), nil
}
