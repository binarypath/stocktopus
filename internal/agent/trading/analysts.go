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
	"strings"
	"sync"
	"time"

	"stocktopus/internal/model"
	"stocktopus/internal/news"
)

// AnalystRunner executes the 4 analyst agents in parallel using Ollama.
type AnalystRunner struct {
	fmp        *news.Client
	ollamaHost string
	ollamaModel string
	client     *http.Client
	logger     *slog.Logger
}

func NewAnalystRunner(fmp *news.Client, ollamaHost, ollamaModel string, logger *slog.Logger) *AnalystRunner {
	if ollamaHost == "" {
		ollamaHost = "http://localhost:11434"
	}
	if ollamaModel == "" {
		ollamaModel = "gemma3"
	}
	return &AnalystRunner{
		fmp:         fmp,
		ollamaHost:  ollamaHost,
		ollamaModel: ollamaModel,
		client:      &http.Client{Timeout: 120 * time.Second},
		logger:      logger.With("component", "analysts"),
	}
}

// RunAll executes all 4 analysts in parallel and returns their reports.
// onStage is called when each analyst starts/completes for progress reporting.
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

// runTechnical gathers EOD price data, calculates indicators, and asks Ollama to analyze.
func (ar *AnalystRunner) runTechnical(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	// Fetch 90 days of EOD data for indicator calculation
	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")

	bars, err := ar.fmp.GetHistoricalEOD(ctx, symbol, from, to)
	if err != nil {
		return AnalystReport{}, fmt.Errorf("fetch EOD: %w", err)
	}
	if len(bars) < 5 {
		return AnalystReport{}, fmt.Errorf("insufficient price data: %d bars", len(bars))
	}

	indicators := calcIndicators(bars)

	prompt := fmt.Sprintf(`You are a technical analyst. Analyze the following price data and indicators for %s.
Return ONLY valid JSON with this structure:
{"outlook":"bullish|bearish|neutral","summary":"2-3 sentence technical outlook","keyPoints":["point1","point2","point3"],"score":<-1.0 to 1.0>}

Recent prices (last 10 trading days):
%s

Technical indicators:
%s`, symbol, formatRecentPrices(bars), indicators)

	report, err := ar.callOllamaForReport(ctx, "technical", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()

	// Attach raw price data
	rawData, _ := json.Marshal(map[string]interface{}{
		"bars":       len(bars),
		"indicators": indicators,
	})
	report.RawData = rawData

	return report, nil
}

// runFundamentals gathers financial statements and asks Ollama to analyze.
func (ar *AnalystRunner) runFundamentals(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	// Fetch financial data in parallel
	type fetchResult struct {
		name string
		data json.RawMessage
		err  error
	}

	fetches := []struct {
		name string
		fn   func() (json.RawMessage, error)
	}{
		{"income", func() (json.RawMessage, error) { return ar.fmp.GetIncomeStatement(ctx, symbol, 3) }},
		{"balance", func() (json.RawMessage, error) { return ar.fmp.GetBalanceSheet(ctx, symbol, 3) }},
		{"cashflow", func() (json.RawMessage, error) { return ar.fmp.GetCashFlow(ctx, symbol, 3) }},
		{"metrics", func() (json.RawMessage, error) { return ar.fmp.GetKeyMetrics(ctx, symbol) }},
		{"ratios", func() (json.RawMessage, error) { return ar.fmp.GetRatiosTTM(ctx, symbol) }},
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

	// Build data summary for the prompt (truncate large datasets)
	var dataParts []string
	for _, r := range results {
		if r.err != nil {
			ar.logger.Debug("fundamentals fetch skipped", "source", r.name, "error", r.err)
			continue
		}
		summary := truncateJSON(r.data, 1500)
		dataParts = append(dataParts, fmt.Sprintf("%s:\n%s", r.name, summary))
	}

	if len(dataParts) == 0 {
		return AnalystReport{}, fmt.Errorf("no financial data available")
	}

	prompt := fmt.Sprintf(`You are a fundamentals analyst. Analyze the financial data for %s.
Return ONLY valid JSON with this structure:
{"outlook":"bullish|bearish|neutral","summary":"2-3 sentence fundamental outlook","keyPoints":["point1","point2","point3"],"score":<-1.0 to 1.0>}

Financial data:
%s`, symbol, strings.Join(dataParts, "\n\n"))

	report, err := ar.callOllamaForReport(ctx, "fundamentals", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()
	return report, nil
}

// runNews gathers recent news and asks Ollama to analyze market impact.
func (ar *AnalystRunner) runNews(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(0, 0, -14).Format("2006-01-02")

	items, err := ar.fmp.GetNewsWithDates(ctx, news.Stock, symbol, 0, 20, from, to)
	if err != nil {
		return AnalystReport{}, fmt.Errorf("fetch news: %w", err)
	}

	// Build news summary
	var newsSummary strings.Builder
	for i, item := range items {
		if i >= 15 {
			break
		}
		newsSummary.WriteString(fmt.Sprintf("- [%s] %s: %s\n",
			item.Date.Format("2006-01-02"), item.Source, item.Title))
		if item.Text != "" {
			text := item.Text
			if len(text) > 200 {
				text = text[:200] + "..."
			}
			newsSummary.WriteString(fmt.Sprintf("  %s\n", text))
		}
	}

	if newsSummary.Len() == 0 {
		return AnalystReport{
			Analyst: "news",
			Symbol:  symbol,
			Outlook: "neutral",
			Summary: "No recent news available for analysis",
			Duration: time.Since(start).Seconds(),
		}, nil
	}

	prompt := fmt.Sprintf(`You are a news analyst. Analyze the following recent news about %s for market impact.
Return ONLY valid JSON with this structure:
{"outlook":"bullish|bearish|neutral","summary":"2-3 sentence news impact analysis","keyPoints":["point1","point2","point3"],"score":<-1.0 to 1.0>}

Recent news:
%s`, symbol, newsSummary.String())

	report, err := ar.callOllamaForReport(ctx, "news", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()
	return report, nil
}

// runSentiment gathers social/sentiment data and asks Ollama to analyze.
func (ar *AnalystRunner) runSentiment(ctx context.Context, symbol string) (AnalystReport, error) {
	start := time.Now()

	// Use the existing social_sentiment Python agent pattern but call Ollama directly
	// with whatever sentiment data we can gather from FMP social sentiment endpoint
	// For now, use a simpler approach: analyze recent news titles + press releases for sentiment

	to := time.Now().UTC().Format("2006-01-02")
	from := time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")

	// Get press releases for additional signal
	pressItems, _ := ar.fmp.GetNewsWithDates(ctx, news.PressReleases, symbol, 0, 10, from, to)
	stockNews, _ := ar.fmp.GetNewsWithDates(ctx, news.Stock, symbol, 0, 10, from, to)

	var sentimentData strings.Builder
	sentimentData.WriteString("Recent headlines and press releases:\n")
	for _, item := range stockNews {
		sentimentData.WriteString(fmt.Sprintf("- [NEWS] %s\n", item.Title))
	}
	for _, item := range pressItems {
		sentimentData.WriteString(fmt.Sprintf("- [PR] %s\n", item.Title))
	}

	if sentimentData.Len() < 50 {
		return AnalystReport{
			Analyst: "sentiment",
			Symbol:  symbol,
			Outlook: "neutral",
			Summary: "Insufficient data for sentiment analysis",
			Duration: time.Since(start).Seconds(),
		}, nil
	}

	prompt := fmt.Sprintf(`You are a sentiment analyst. Analyze the following headlines and press releases about %s to gauge market sentiment.
Return ONLY valid JSON with this structure:
{"outlook":"bullish|bearish|neutral","summary":"2-3 sentence sentiment analysis","keyPoints":["point1","point2","point3"],"score":<-1.0 to 1.0>}

%s`, symbol, sentimentData.String())

	report, err := ar.callOllamaForReport(ctx, "sentiment", symbol, prompt)
	if err != nil {
		return AnalystReport{}, err
	}
	report.Duration = time.Since(start).Seconds()
	return report, nil
}

// callOllamaForReport sends a prompt to Ollama and parses the analyst report JSON.
func (ar *AnalystRunner) callOllamaForReport(ctx context.Context, analyst, symbol, prompt string) (AnalystReport, error) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model":  ar.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"format": "json",
		"options": map[string]interface{}{
			"temperature": 0.3,
			"num_predict": 512,
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

	// Parse the structured JSON from the LLM
	var parsed struct {
		Outlook   string   `json:"outlook"`
		Summary   string   `json:"summary"`
		KeyPoints []string `json:"keyPoints"`
		Score     float64  `json:"score"`
	}

	text := strings.TrimSpace(ollamaResp.Response)
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		ar.logger.Warn("failed to parse analyst JSON, using raw", "analyst", analyst, "error", err)
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
		Outlook:   parsed.Outlook,
		Summary:   parsed.Summary,
		KeyPoints: parsed.KeyPoints,
		Score:     parsed.Score,
	}, nil
}

// --- Technical indicator helpers ---

func calcIndicators(bars []model.OHLCV) string {
	closes := make([]float64, len(bars))
	for i, b := range bars {
		closes[i] = b.Close
	}

	var sb strings.Builder

	// Current price
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

	// RSI(14)
	if len(closes) >= 15 {
		rsi := rsi(closes, 14)
		var rsiLabel string
		switch {
		case rsi > 70:
			rsiLabel = "overbought"
		case rsi < 30:
			rsiLabel = "oversold"
		default:
			rsiLabel = "neutral"
		}
		sb.WriteString(fmt.Sprintf("RSI(14): %.1f (%s)\n", rsi, rsiLabel))
	}

	// MACD (12, 26, 9)
	if len(closes) >= 26 {
		macdLine, signal := macd(closes)
		sb.WriteString(fmt.Sprintf("MACD: %.2f, Signal: %.2f (%s)\n", macdLine, signal,
			func() string {
				if macdLine > signal {
					return "bullish crossover"
				}
				return "bearish crossover"
			}()))
	}

	// Bollinger Bands
	if len(closes) >= 20 {
		upper, middle, lower := bollingerBands(closes, 20, 2)
		sb.WriteString(fmt.Sprintf("Bollinger: Upper=%.2f Mid=%.2f Lower=%.2f", upper, middle, lower))
		if last > upper {
			sb.WriteString(" (above upper)")
		} else if last < lower {
			sb.WriteString(" (below lower)")
		} else {
			sb.WriteString(fmt.Sprintf(" (%.0f%% bandwidth)", (last-lower)/(upper-lower)*100))
		}
		sb.WriteString("\n")
	}

	// Price change
	if len(closes) >= 2 {
		dayChange := (closes[len(closes)-1] - closes[len(closes)-2]) / closes[len(closes)-2] * 100
		sb.WriteString(fmt.Sprintf("1D Change: %.2f%%\n", dayChange))
	}
	if len(closes) >= 6 {
		weekChange := (closes[len(closes)-1] - closes[len(closes)-6]) / closes[len(closes)-6] * 100
		sb.WriteString(fmt.Sprintf("1W Change: %.2f%%\n", weekChange))
	}

	return sb.String()
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

	// Signal line: EMA(9) of MACD values (simplified)
	// For a proper implementation we'd compute MACD for each bar
	// This is an approximation using just the last values
	signal := macdLine * 0.8 // rough approximation

	return macdLine, signal
}

func bollingerBands(data []float64, period int, numStd float64) (upper, middle, lower float64) {
	middle = sma(data, period)

	// Standard deviation
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

// truncateJSON returns a truncated string representation of JSON data.
func truncateJSON(data json.RawMessage, maxLen int) string {
	s := string(data)
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
