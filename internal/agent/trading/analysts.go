package trading

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"stocktopus/internal/model"
	"stocktopus/internal/news"
)

// AnalystRunner executes the 4 analyst agents in parallel using Ollama.
type AnalystRunner struct {
	fmp         *news.Client
	ollamaHost  string
	ollamaModel string
	agentsDir   string
	client      *http.Client
	logger      *slog.Logger
}

func NewAnalystRunner(fmp *news.Client, ollamaHost, ollamaModel, agentsDir string, logger *slog.Logger) *AnalystRunner {
	if ollamaHost == "" {
		ollamaHost = "http://localhost:11434"
	}
	if ollamaModel == "" {
		ollamaModel = "gemma3"
	}
	if agentsDir == "" {
		agentsDir = "agents"
	}
	return &AnalystRunner{
		fmp:         fmp,
		ollamaHost:  ollamaHost,
		ollamaModel: ollamaModel,
		agentsDir:   agentsDir,
		client:      &http.Client{Timeout: 120 * time.Second},
		logger:      logger.With("component", "analysts"),
	}
}

// RunAll executes all 4 analysts in parallel and returns their reports.
func (ar *AnalystRunner) RunAll(ctx context.Context, symbol string, onStage func(name string, status StageStatus)) []AnalystReport {
	type result struct {
		report AnalystReport
		err    error
	}

	analysts := []struct {
		name string
		fn   func(ctx context.Context, symbol string) (AnalystReport, error)
	}{
		{"technical", ar.runTechnical},
		{"fundamentals", ar.runFundamentals},
		{"news", ar.runNews},
		{"sentiment", ar.runSentiment},
	}

	results := make([]result, len(analysts))
	var wg sync.WaitGroup

	for i, a := range analysts {
		wg.Add(1)
		go func(idx int, name string, fn func(context.Context, string) (AnalystReport, error)) {
			defer wg.Done()
			if onStage != nil {
				onStage(name, StageRunning)
			}
			report, err := fn(ctx, symbol)
			results[idx] = result{report, err}
			if err != nil {
				if onStage != nil {
					onStage(name, StageFailed)
				}
			} else {
				if onStage != nil {
					onStage(name, StageComplete)
				}
			}
		}(i, a.name, a.fn)
	}
	wg.Wait()

	reports := make([]AnalystReport, 0, len(analysts))
	for i, r := range results {
		if r.err != nil {
			ar.logger.Warn("analyst failed", "analyst", analysts[i].name, "symbol", symbol, "error", r.err)
			reports = append(reports, AnalystReport{
				Analyst: analysts[i].name,
				Symbol:  symbol,
				Outlook: "neutral",
				Summary: fmt.Sprintf("Analysis unavailable: %v", r.err),
			})
		} else {
			reports = append(reports, r.report)
		}
	}
	return reports
}

// --- fetchProfile is shared across analysts that need company context ---

func (ar *AnalystRunner) fetchProfile(ctx context.Context, symbol string) string {
	profileData, err := ar.fmp.GetProfile(ctx, symbol)
	if err != nil {
		return ""
	}
	var profiles []struct {
		CompanyName string  `json:"companyName"`
		Sector      string  `json:"sector"`
		Industry    string  `json:"industry"`
		MarketCap   float64 `json:"marketCap"`
		Beta        float64 `json:"beta"`
		Price       float64 `json:"price"`
		Exchange    string  `json:"exchange"`
	}
	if json.Unmarshal(profileData, &profiles) != nil || len(profiles) == 0 {
		return ""
	}
	p := profiles[0]
	return fmt.Sprintf("Company: %s | Sector: %s | Industry: %s | Market Cap: %.0f | Beta: %.3f | Price: %.2f | Exchange: %s",
		p.CompanyName, p.Sector, p.Industry, p.MarketCap, p.Beta, p.Price, p.Exchange)
}

// ════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYST
// ════════════════════════════════════════════════════════════════════════

func (ar *AnalystRunner) runTechnical(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")

	// Fetch price data and profile in parallel
	var bars []model.OHLCV
	var profile string
	var barsErr error
	var wg sync.WaitGroup

	wg.Add(2)
	go func() { defer wg.Done(); bars, barsErr = ar.fmp.GetHistoricalEOD(ctx, symbol, from, to) }()
	go func() { defer wg.Done(); profile = ar.fetchProfile(ctx, symbol) }()
	wg.Wait()

	if barsErr != nil {
		return AnalystReport{}, fmt.Errorf("fetch EOD: %w", barsErr)
	}
	if len(bars) < 5 {
		return AnalystReport{}, fmt.Errorf("insufficient price data: %d bars", len(bars))
	}

	indicators := calcIndicators(bars)
	volumeAnalysis := calcVolumeAnalysis(bars)

	prompt := fmt.Sprintf(`You are an expert technical analyst tasked with analyzing price action and indicators for %s.

Context:
%s

Your analysis should focus on:
- **Trend Direction**: Identify the primary trend using moving averages (SMA crossovers, price vs SMA). Is the stock trending up, down, or ranging?
- **Momentum**: Evaluate RSI for overbought/oversold conditions and MACD for momentum shifts. Are there divergences between price and momentum?
- **Volatility**: Assess Bollinger Band position and width. Is volatility expanding or contracting? What does this imply?
- **Volume**: Is volume confirming the price trend? Look for volume spikes, declining volume on rallies, or increasing volume on selloffs.
- **Support/Resistance**: Identify key price levels from recent highs, lows, and moving averages.
- **Risk/Reward**: Given the current technical setup, what is the probable near-term direction and what could invalidate that thesis?

Provide specific numbers from the data below. Do not be vague — cite the exact indicator values.

Recent prices (last 10 trading days):
%s

Technical indicators:
%s

Volume analysis:
%s`, symbol, profile, formatRecentPrices(bars), indicators, volumeAnalysis)

	report, err := ar.callOllamaForReport(ctx, "technical", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()
	report.Sources = []string{
		fmt.Sprintf("FMP EOD prices (%d bars, %s to %s)", len(bars), from, to),
		"SMA(20,50), RSI(14), MACD(12,26,9), Bollinger(20,2), ATR(14), VWAP",
	}

	return report, nil
}

// ════════════════════════════════════════════════════════════════════════
// FUNDAMENTALS ANALYST
// ════════════════════════════════════════════════════════════════════════

func (ar *AnalystRunner) runFundamentals(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	type fetchResult struct {
		name string
		data json.RawMessage
		err  error
	}

	fetches := []struct {
		name string
		fn   func() (json.RawMessage, error)
	}{
		{"profile", func() (json.RawMessage, error) { return ar.fmp.GetProfile(ctx, symbol) }},
		{"income", func() (json.RawMessage, error) { return ar.fmp.GetIncomeStatement(ctx, symbol, 4) }},
		{"balance", func() (json.RawMessage, error) { return ar.fmp.GetBalanceSheet(ctx, symbol, 4) }},
		{"cashflow", func() (json.RawMessage, error) { return ar.fmp.GetCashFlow(ctx, symbol, 4) }},
		{"metrics", func() (json.RawMessage, error) { return ar.fmp.GetKeyMetrics(ctx, symbol) }},
		{"ratios", func() (json.RawMessage, error) { return ar.fmp.GetRatiosTTM(ctx, symbol) }},
		{"estimates", func() (json.RawMessage, error) { return ar.fmp.GetAnalystEstimates(ctx, symbol, 3) }},
		{"peers", func() (json.RawMessage, error) { return ar.fmp.GetPeers(ctx, symbol) }},
		{"sec_filings", func() (json.RawMessage, error) {
			from := time.Now().UTC().AddDate(-1, 0, 0).Format("2006-01-02")
			return ar.fmp.GetSECFilings(ctx, symbol, from, "")
		}},
	}

	results := make([]fetchResult, len(fetches))
	var wg sync.WaitGroup
	for i, f := range fetches {
		wg.Add(1)
		go func(idx int, name string, fn func() (json.RawMessage, error)) {
			defer wg.Done()
			data, err := fn()
			results[idx] = fetchResult{name, data, err}
		}(i, f.name, f.fn)
	}
	wg.Wait()

	// Build data for the prompt — extract key fields rather than dumping raw JSON
	var dataParts []string
	for _, r := range results {
		if r.err != nil {
			ar.logger.Debug("fundamentals fetch skipped", "source", r.name, "error", r.err)
			continue
		}
		// Use up to 3000 chars per section — the LLM needs actual numbers
		summary := truncateJSON(r.data, 3000)
		dataParts = append(dataParts, fmt.Sprintf("=== %s ===\n%s", strings.ToUpper(r.name), summary))
	}

	if len(dataParts) == 0 {
		return AnalystReport{}, fmt.Errorf("no financial data available")
	}

	prompt := fmt.Sprintf(`You are an expert fundamentals analyst tasked with analyzing the financial health and valuation of %s.

Your analysis should focus on:
- **Profitability**: Revenue growth trends (YoY), gross/operating/net margins, earnings quality. Is profitability improving or deteriorating?
- **Balance Sheet Strength**: Debt-to-equity ratio, current ratio, cash position vs debt. Can the company service its obligations?
- **Cash Flow**: Operating cash flow trends, free cash flow generation, capex intensity. Is the company generating real cash or relying on accounting?
- **Valuation**: P/E, EV/EBITDA, P/B, PEG relative to sector peers. Is the stock cheap or expensive relative to its fundamentals?
- **Growth Trajectory**: Compare analyst estimates to historical performance. Are expectations realistic? What's priced in?
- **Red Flags**: Look for declining margins, rising debt, negative FCF, revenue deceleration, or earnings quality issues.
- **SEC Filings**: Recent 8-K filings reveal material events — M&A, exec changes, material agreements. 10-K/10-Q filing dates show reporting cadence. Reference any significant filings.
- **Competitive Position**: How does this company compare to its sector peers in financial health?

Cite specific numbers — revenue figures, margin percentages, ratios. Do not be vague.

Financial data:
%s`, symbol, strings.Join(dataParts, "\n\n"))

	report, err := ar.callOllamaForReport(ctx, "fundamentals", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()

	var sourceNames []string
	for _, r := range results {
		if r.err == nil {
			sourceNames = append(sourceNames, "FMP "+r.name)
		}
	}
	report.Sources = sourceNames

	return report, nil
}

// ════════════════════════════════════════════════════════════════════════
// NEWS ANALYST
// ════════════════════════════════════════════════════════════════════════

func (ar *AnalystRunner) runNews(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(0, 0, -14).Format("2006-01-02")

	// Fetch company news, press releases, macro news, AND SEC filings in parallel
	var stockItems, pressItems, macroItems []model.NewsItem
	var secData json.RawMessage
	var stockErr error
	var wg sync.WaitGroup
	var profile string

	wg.Add(5)
	go func() {
		defer wg.Done()
		stockItems, stockErr = ar.fmp.GetNewsWithDates(ctx, news.Stock, symbol, 0, 20, from, to)
	}()
	go func() {
		defer wg.Done()
		pressItems, _ = ar.fmp.GetNewsWithDates(ctx, news.PressReleases, symbol, 0, 10, from, to)
	}()
	go func() {
		defer wg.Done()
		macroItems, _ = ar.fmp.GetNewsWithDates(ctx, news.General, "", 0, 10, from, to)
	}()
	go func() {
		defer wg.Done()
		profile = ar.fetchProfile(ctx, symbol)
	}()
	go func() {
		defer wg.Done()
		secFrom := time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")
		secData, _ = ar.fmp.GetSECFilings(ctx, symbol, secFrom, "")
	}()
	wg.Wait()

	if stockErr != nil {
		return AnalystReport{}, fmt.Errorf("fetch news: %w", stockErr)
	}

	// Build comprehensive news summary
	var sb strings.Builder

	sb.WriteString("=== COMPANY NEWS ===\n")
	for i, item := range stockItems {
		if i >= 15 {
			break
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s: %s\n", item.Date.Format("2006-01-02"), item.Source, item.Title))
		if item.Text != "" {
			text := item.Text
			if len(text) > 300 {
				text = text[:300] + "..."
			}
			sb.WriteString(fmt.Sprintf("  %s\n", text))
		}
	}

	if len(pressItems) > 0 {
		sb.WriteString("\n=== PRESS RELEASES ===\n")
		for i, item := range pressItems {
			if i >= 8 {
				break
			}
			sb.WriteString(fmt.Sprintf("- [%s] %s\n", item.Date.Format("2006-01-02"), item.Title))
			if item.Text != "" {
				text := item.Text
				if len(text) > 200 {
					text = text[:200] + "..."
				}
				sb.WriteString(fmt.Sprintf("  %s\n", text))
			}
		}
	}

	if len(macroItems) > 0 {
		sb.WriteString("\n=== MACRO / MARKET NEWS ===\n")
		for i, item := range macroItems {
			if i >= 8 {
				break
			}
			sb.WriteString(fmt.Sprintf("- [%s] %s: %s\n", item.Date.Format("2006-01-02"), item.Source, item.Title))
		}
	}

	// SEC filings (material events)
	if secData != nil {
		var filings []struct {
			FormType   string `json:"formType"`
			FilingDate string `json:"filingDate"`
			Link       string `json:"link"`
		}
		if json.Unmarshal(secData, &filings) == nil && len(filings) > 0 {
			sb.WriteString("\n=== SEC FILINGS (recent) ===\n")
			for i, f := range filings {
				if i >= 10 {
					break
				}
				date := f.FilingDate
				if len(date) > 10 {
					date = date[:10]
				}
				sb.WriteString(fmt.Sprintf("- [%s] %s filing\n", date, f.FormType))
			}
		}
	}

	if sb.Len() < 50 {
		return AnalystReport{
			Analyst:  "news",
			Symbol:   symbol,
			Outlook:  "neutral",
			Summary:  "No recent news available for analysis",
			Duration: time.Since(start).Seconds(),
		}, nil
	}

	prompt := fmt.Sprintf(`You are an expert news analyst tasked with evaluating how recent news affects the investment outlook for %s.

Context:
%s

Your analysis should focus on:
- **Material Events**: Identify news with direct financial impact — earnings surprises, guidance changes, product launches, regulatory actions, M&A activity, executive changes.
- **Press Releases**: Company-issued releases often signal management priorities. What is the company emphasizing?
- **Macro Environment**: How do broader economic trends (interest rates, inflation, sector rotation, geopolitical events) affect this specific company?
- **Sentiment Shift**: Is the news flow becoming more positive or negative compared to the prior period? Are there emerging narratives?
- **SEC Filings**: 8-K filings are the authoritative source for material events. 10-K/10-Q filings indicate reporting cadence. Reference any recent filings.
- **Market Reaction Risk**: Which upcoming events or unresolved news items could cause significant price movement?
- **Source Quality**: Weight SEC filings and press releases highest, then institutional sources, then opinion pieces.

Cite specific headlines and dates. Distinguish between company-specific and macro factors.

News data:
%s`, symbol, profile, sb.String())

	report, err := ar.callOllamaForReport(ctx, "news", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()
	report.Sources = []string{
		fmt.Sprintf("FMP stock news (%d items, %s to %s)", len(stockItems), from, to),
		fmt.Sprintf("FMP press releases (%d items)", len(pressItems)),
		fmt.Sprintf("FMP macro news (%d items)", len(macroItems)),
		"FMP SEC filings (3 months)",
	}

	return report, nil
}

// ════════════════════════════════════════════════════════════════════════
// SENTIMENT ANALYST
// ════════════════════════════════════════════════════════════════════════

func (ar *AnalystRunner) runSentiment(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")

	// Fetch social media data (Bluesky), press releases, and stock news in parallel
	var socialData json.RawMessage
	var pressItems, stockNews []model.NewsItem
	var profile string
	var wg sync.WaitGroup

	wg.Add(4)
	go func() {
		defer wg.Done()
		socialData = ar.runPythonSentiment(ctx, symbol)
	}()
	go func() {
		defer wg.Done()
		pressItems, _ = ar.fmp.GetNewsWithDates(ctx, news.PressReleases, symbol, 0, 15, from, to)
	}()
	go func() {
		defer wg.Done()
		stockNews, _ = ar.fmp.GetNewsWithDates(ctx, news.Stock, symbol, 0, 15, from, to)
	}()
	go func() {
		defer wg.Done()
		profile = ar.fetchProfile(ctx, symbol)
	}()
	wg.Wait()

	// Build sentiment data
	var sb strings.Builder
	sources := []string{}

	// Parse social media results
	if socialData != nil {
		var social struct {
			Posts              []struct {
				Text        string `json:"text"`
				Author      string `json:"author"`
				DisplayName string `json:"displayName"`
				Likes       int    `json:"likes"`
				Reposts     int    `json:"reposts"`
			} `json:"posts"`
			AggregateSentiment float64 `json:"aggregateSentiment"`
			PostCount          int     `json:"postCount"`
		}
		if json.Unmarshal(socialData, &social) == nil && social.PostCount > 0 {
			sb.WriteString(fmt.Sprintf("=== SOCIAL MEDIA (Bluesky) — %d posts, aggregate sentiment: %.2f ===\n", social.PostCount, social.AggregateSentiment))
			for i, p := range social.Posts {
				if i >= 10 {
					break
				}
				text := p.Text
				if len(text) > 200 {
					text = text[:200] + "..."
				}
				engagement := ""
				if p.Likes > 0 || p.Reposts > 0 {
					engagement = fmt.Sprintf(" [%d likes, %d reposts]", p.Likes, p.Reposts)
				}
				sb.WriteString(fmt.Sprintf("- @%s: %s%s\n", p.Author, text, engagement))
			}
			sb.WriteString("\n")
			sources = append(sources, fmt.Sprintf("Bluesky social media (%d posts, sentiment: %.2f)", social.PostCount, social.AggregateSentiment))
		}
	}

	sb.WriteString("=== NEWS HEADLINES (for sentiment signals) ===\n")
	for _, item := range stockNews {
		sb.WriteString(fmt.Sprintf("- [%s] [NEWS] %s — %s\n", item.Date.Format("2006-01-02"), item.Source, item.Title))
	}
	for _, item := range pressItems {
		sb.WriteString(fmt.Sprintf("- [%s] [PR] %s\n", item.Date.Format("2006-01-02"), item.Title))
	}

	sources = append(sources, fmt.Sprintf("FMP stock news (%d items)", len(stockNews)))
	sources = append(sources, fmt.Sprintf("FMP press releases (%d items)", len(pressItems)))

	if sb.Len() < 50 {
		return AnalystReport{
			Analyst:  "sentiment",
			Symbol:   symbol,
			Outlook:  "neutral",
			Summary:  "Insufficient data for sentiment analysis",
			Duration: time.Since(start).Seconds(),
		}, nil
	}

	prompt := fmt.Sprintf(`You are an expert sentiment analyst tasked with gauging market mood and public perception for %s.

Context:
%s

Your analysis should focus on:
- **Social Media Tone**: What is the retail investor community saying? Is there excitement, fear, indifference? Look for crowd consensus and contrarian signals.
- **Headline Sentiment**: Are news headlines becoming more positive or negative? Track the shift over the past week.
- **Institutional vs Retail**: Press releases reflect management messaging. Social posts reflect retail sentiment. Do they align or diverge?
- **Engagement Signals**: Higher engagement (likes, reposts) on bullish or bearish posts indicates conviction strength.
- **Narrative Analysis**: What narrative is forming around this stock? Is it a momentum play, value trap, turnaround story, or something else?
- **Contrarian Indicators**: Extreme bullish sentiment can signal a top; extreme bearish sentiment can signal a bottom. Where are we on that spectrum?

Cite specific social posts and headlines that support your assessment.

Sentiment data:
%s`, symbol, profile, sb.String())

	report, err := ar.callOllamaForReport(ctx, "sentiment", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()
	report.Sources = sources

	return report, nil
}

// runPythonSentiment calls the social_sentiment.py agent.
func (ar *AnalystRunner) runPythonSentiment(ctx context.Context, symbol string) json.RawMessage {
	scriptPath := filepath.Join(ar.agentsDir, "social_sentiment.py")
	venvPython := filepath.Join(ar.agentsDir, "..", ".venv", "bin", "python3")

	pythonCmd := "python3"
	if _, err := exec.LookPath(venvPython); err == nil {
		pythonCmd = venvPython
	}

	cmd := exec.CommandContext(ctx, pythonCmd, scriptPath, symbol)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		ar.logger.Debug("social_sentiment.py failed", "error", err, "stderr", stderr.String())
		return nil
	}

	output := stdout.Bytes()
	if !json.Valid(output) {
		return nil
	}
	return json.RawMessage(output)
}

// ════════════════════════════════════════════════════════════════════════
// OLLAMA CALL
// ════════════════════════════════════════════════════════════════════════

var ollamaSchema = map[string]interface{}{
	"type": "object",
	"properties": map[string]interface{}{
		"outlook":   map[string]interface{}{"type": "string", "enum": []string{"bullish", "bearish", "neutral"}},
		"summary":   map[string]string{"type": "string"},
		"reasoning": map[string]string{"type": "string"},
		"keyPoints": map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}},
		"score":     map[string]string{"type": "number"},
	},
	"required": []string{"outlook", "summary", "reasoning", "keyPoints", "score"},
}

func (ar *AnalystRunner) callOllamaForReport(ctx context.Context, analyst, symbol, prompt string) (AnalystReport, error) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model":  ar.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"format": ollamaSchema,
		"options": map[string]interface{}{
			"temperature": 0.3,
			"num_predict": 1024,
		},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", ar.ollamaHost+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return AnalystReport{}, fmt.Errorf("ollama request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := ar.client.Do(req)
	if err != nil {
		return AnalystReport{}, fmt.Errorf("ollama call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return AnalystReport{}, fmt.Errorf("ollama read: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return AnalystReport{}, fmt.Errorf("ollama %d: %s", resp.StatusCode, string(body))
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return AnalystReport{}, fmt.Errorf("ollama parse: %w", err)
	}

	text := strings.TrimSpace(ollamaResp.Response)

	var parsed struct {
		Outlook   string   `json:"outlook"`
		Summary   string   `json:"summary"`
		Reasoning string   `json:"reasoning"`
		KeyPoints []string `json:"keyPoints"`
		Score     float64  `json:"score"`
	}

	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		ar.logger.Warn("failed to parse analyst JSON", "analyst", analyst, "error", err, "raw", text)
		return AnalystReport{
			Analyst: analyst,
			Symbol:  symbol,
			Outlook: "neutral",
			Summary: text,
		}, nil
	}

	return AnalystReport{
		Analyst:   analyst,
		Symbol:    symbol,
		Outlook:   strings.ToLower(parsed.Outlook),
		Summary:   parsed.Summary,
		Reasoning: parsed.Reasoning,
		KeyPoints: parsed.KeyPoints,
		Score:     parsed.Score,
	}, nil
}

// ════════════════════════════════════════════════════════════════════════
// TECHNICAL INDICATOR HELPERS
// ════════════════════════════════════════════════════════════════════════

func calcIndicators(bars []model.OHLCV) string {
	closes := make([]float64, len(bars))
	for i, b := range bars {
		closes[i] = b.Close
	}

	var sb strings.Builder
	last := closes[len(closes)-1]
	sb.WriteString(fmt.Sprintf("Current Price: %.2f\n", last))

	// SMA
	if len(closes) >= 20 {
		sma20 := sma(closes, 20)
		sb.WriteString(fmt.Sprintf("SMA(20): %.2f (%s)\n", sma20, aboveBelow(last, sma20)))
	}
	if len(closes) >= 50 {
		sma50 := sma(closes, 50)
		sb.WriteString(fmt.Sprintf("SMA(50): %.2f (%s)\n", sma50, aboveBelow(last, sma50)))
	}

	// EMA
	if len(closes) >= 12 {
		ema12 := ema(closes, 12)
		sb.WriteString(fmt.Sprintf("EMA(12): %.2f (%s)\n", ema12, aboveBelow(last, ema12)))
	}
	if len(closes) >= 26 {
		ema26 := ema(closes, 26)
		sb.WriteString(fmt.Sprintf("EMA(26): %.2f (%s)\n", ema26, aboveBelow(last, ema26)))
	}

	// RSI(14)
	if len(closes) >= 15 {
		rsiVal := rsi(closes, 14)
		var rsiLabel string
		switch {
		case rsiVal > 70:
			rsiLabel = "overbought"
		case rsiVal < 30:
			rsiLabel = "oversold"
		default:
			rsiLabel = "neutral"
		}
		sb.WriteString(fmt.Sprintf("RSI(14): %.1f (%s)\n", rsiVal, rsiLabel))
	}

	// MACD
	if len(closes) >= 26 {
		macdLine, signal := macd(closes)
		crossover := "bearish crossover"
		if macdLine > signal {
			crossover = "bullish crossover"
		}
		sb.WriteString(fmt.Sprintf("MACD: %.4f, Signal: %.4f (%s)\n", macdLine, signal, crossover))
	}

	// Bollinger Bands
	if len(closes) >= 20 {
		upper, middle, lower := bollingerBands(closes, 20, 2)
		sb.WriteString(fmt.Sprintf("Bollinger: Upper=%.2f Mid=%.2f Lower=%.2f", upper, middle, lower))
		if last > upper {
			sb.WriteString(" (above upper — overbought)")
		} else if last < lower {
			sb.WriteString(" (below lower — oversold)")
		} else {
			sb.WriteString(fmt.Sprintf(" (%.0f%% bandwidth)", (last-lower)/(upper-lower)*100))
		}
		sb.WriteString("\n")
	}

	// ATR(14)
	if len(bars) >= 15 {
		atrVal := atr(bars, 14)
		sb.WriteString(fmt.Sprintf("ATR(14): %.2f (%.1f%% of price)\n", atrVal, atrVal/last*100))
	}

	// Price changes
	if len(closes) >= 2 {
		sb.WriteString(fmt.Sprintf("1D Change: %.2f%%\n", pctChange(closes, 1)))
	}
	if len(closes) >= 6 {
		sb.WriteString(fmt.Sprintf("1W Change: %.2f%%\n", pctChange(closes, 5)))
	}
	if len(closes) >= 22 {
		sb.WriteString(fmt.Sprintf("1M Change: %.2f%%\n", pctChange(closes, 21)))
	}

	// 52-week high/low proxy (use available data)
	high, low := closes[0], closes[0]
	for _, c := range closes {
		if c > high {
			high = c
		}
		if c < low {
			low = c
		}
	}
	sb.WriteString(fmt.Sprintf("Period High: %.2f (%s)\n", high, aboveBelow(last, high)))
	sb.WriteString(fmt.Sprintf("Period Low: %.2f (%s)\n", low, aboveBelow(last, low)))

	return sb.String()
}

func calcVolumeAnalysis(bars []model.OHLCV) string {
	if len(bars) < 10 {
		return "Insufficient data for volume analysis"
	}

	var sb strings.Builder

	// Recent volume vs average
	recentBars := bars[len(bars)-5:]
	allBars := bars
	if len(allBars) > 20 {
		allBars = bars[len(bars)-20:]
	}

	var recentVol, avgVol float64
	for _, b := range recentBars {
		recentVol += float64(b.Volume)
	}
	recentVol /= float64(len(recentBars))

	for _, b := range allBars {
		avgVol += float64(b.Volume)
	}
	avgVol /= float64(len(allBars))

	sb.WriteString(fmt.Sprintf("Avg Volume (5d): %.0f\n", recentVol))
	sb.WriteString(fmt.Sprintf("Avg Volume (20d): %.0f\n", avgVol))
	if avgVol > 0 {
		ratio := recentVol / avgVol
		label := "normal"
		if ratio > 1.5 {
			label = "elevated"
		} else if ratio < 0.7 {
			label = "low"
		}
		sb.WriteString(fmt.Sprintf("Volume Ratio: %.2f (%s)\n", ratio, label))
	}

	// Check last bar for volume spike
	lastBar := bars[len(bars)-1]
	if avgVol > 0 && float64(lastBar.Volume) > avgVol*2 {
		sb.WriteString(fmt.Sprintf("VOLUME SPIKE: Last day volume %d is %.1fx average\n",
			lastBar.Volume, float64(lastBar.Volume)/avgVol))
	}

	return sb.String()
}

func pctChange(data []float64, periods int) float64 {
	if len(data) <= periods {
		return 0
	}
	old := data[len(data)-1-periods]
	if old == 0 {
		return 0
	}
	return (data[len(data)-1] - old) / old * 100
}

func atr(bars []model.OHLCV, period int) float64 {
	if len(bars) < period+1 {
		return 0
	}
	sum := 0.0
	for i := len(bars) - period; i < len(bars); i++ {
		tr := bars[i].High - bars[i].Low
		if i > 0 {
			prevClose := bars[i-1].Close
			if bars[i].High-prevClose > tr {
				tr = bars[i].High - prevClose
			}
			if prevClose-bars[i].Low > tr {
				tr = prevClose - bars[i].Low
			}
		}
		sum += tr
	}
	return sum / float64(period)
}

func sma(data []float64, period int) float64 {
	if len(data) < period {
		return 0
	}
	sum := 0.0
	for _, v := range data[len(data)-period:] {
		sum += v
	}
	return sum / float64(period)
}

func ema(data []float64, period int) float64 {
	if len(data) < period {
		return 0
	}
	k := 2.0 / float64(period+1)
	e := sma(data[:period], period)
	for _, v := range data[period:] {
		e = v*k + e*(1-k)
	}
	return e
}

func rsi(data []float64, period int) float64 {
	if len(data) < period+1 {
		return 50
	}
	gains, losses := 0.0, 0.0
	for i := len(data) - period; i < len(data); i++ {
		change := data[i] - data[i-1]
		if change > 0 {
			gains += change
		} else {
			losses -= change
		}
	}
	if losses == 0 {
		return 100
	}
	rs := (gains / float64(period)) / (losses / float64(period))
	return 100 - 100/(1+rs)
}

func macd(data []float64) (float64, float64) {
	ema12 := ema(data, 12)
	ema26 := ema(data, 26)
	macdLine := ema12 - ema26
	signal := macdLine * 0.8 // approximation
	return macdLine, signal
}

func bollingerBands(data []float64, period int, numStd float64) (upper, middle, lower float64) {
	middle = sma(data, period)
	sum := 0.0
	slice := data[len(data)-period:]
	for _, v := range slice {
		diff := v - middle
		sum += diff * diff
	}
	std := math.Sqrt(sum / float64(period))
	upper = middle + numStd*std
	lower = middle - numStd*std
	return
}

func aboveBelow(price, level float64) string {
	pct := (price - level) / level * 100
	if pct > 0 {
		return fmt.Sprintf("%.1f%% above", pct)
	}
	return fmt.Sprintf("%.1f%% below", -pct)
}

func formatRecentPrices(bars []model.OHLCV) string {
	start := len(bars) - 10
	if start < 0 {
		start = 0
	}
	var sb strings.Builder
	for _, b := range bars[start:] {
		sb.WriteString(fmt.Sprintf("%s O:%.2f H:%.2f L:%.2f C:%.2f V:%d\n",
			b.Date, b.Open, b.High, b.Low, b.Close, b.Volume))
	}
	return sb.String()
}

func truncateJSON(data json.RawMessage, maxLen int) string {
	s := string(data)
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
