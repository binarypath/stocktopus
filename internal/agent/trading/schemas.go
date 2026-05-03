package trading

import (
	"encoding/json"
	"time"
)

// Rating is the 5-tier investment recommendation scale.
type Rating string

const (
	RatingBuy         Rating = "Buy"
	RatingOverweight  Rating = "Overweight"
	RatingHold        Rating = "Hold"
	RatingUnderweight Rating = "Underweight"
	RatingSell        Rating = "Sell"
)

// StageStatus tracks the state of each pipeline stage.
type StageStatus string

const (
	StagePending  StageStatus = "pending"
	StageRunning  StageStatus = "running"
	StageComplete StageStatus = "complete"
	StageFailed   StageStatus = "failed"
	StageSkipped  StageStatus = "skipped"
)

// Stage represents one step in the trading pipeline.
type Stage struct {
	Name      string      `json:"name"`
	Status    StageStatus `json:"status"`
	StartedAt time.Time   `json:"startedAt,omitempty"`
	Duration  float64     `json:"duration,omitempty"` // seconds
	Error     string      `json:"error,omitempty"`
}

// AnalystReport is the output of one of the 4 analyst agents.
type AnalystReport struct {
	Analyst   string          `json:"analyst"`   // technical, fundamentals, news, sentiment
	Symbol    string          `json:"symbol"`
	Outlook   string          `json:"outlook"`   // bullish, bearish, neutral
	Summary   string          `json:"summary"`
	KeyPoints []string        `json:"keyPoints"`
	Score     float64         `json:"score"`     // -1.0 to 1.0
	RawData   json.RawMessage `json:"rawData,omitempty"`
	Duration  float64         `json:"duration"`  // seconds
}

// InvestmentPlan is the output of the research debate phase.
type InvestmentPlan struct {
	Symbol         string   `json:"symbol"`
	Rating         Rating   `json:"rating"`
	Rationale      string   `json:"rationale"`
	BullArguments  []string `json:"bullArguments"`
	BearArguments  []string `json:"bearArguments"`
	KeyActions     []string `json:"keyActions"`
	DebateRounds   int      `json:"debateRounds"`
}

// TraderProposal is the output of the trader agent.
type TraderProposal struct {
	Symbol         string  `json:"symbol"`
	Action         string  `json:"action"` // buy, sell, hold
	Reasoning      string  `json:"reasoning"`
	EntryPrice     float64 `json:"entryPrice,omitempty"`
	StopLoss       float64 `json:"stopLoss,omitempty"`
	TakeProfit     float64 `json:"takeProfit,omitempty"`
	PositionSize   string  `json:"positionSize"` // e.g. "5% of portfolio"
	TimeHorizon    string  `json:"timeHorizon"`  // e.g. "3-6 months"
}

// FinalDecision is the output of the risk debate + portfolio manager.
type FinalDecision struct {
	Symbol          string   `json:"symbol"`
	Rating          Rating   `json:"rating"`
	Confidence      float64  `json:"confidence"` // 0.0 to 1.0
	Reasoning       string   `json:"reasoning"`
	RiskFactors     []string `json:"riskFactors"`
	AggressiveView  string   `json:"aggressiveView"`
	ConservativeView string  `json:"conservativeView"`
	NeutralView     string   `json:"neutralView"`
	DebateRounds    int      `json:"debateRounds"`
}

// CostBreakdown tracks API costs per stage.
type CostBreakdown struct {
	Stage        string `json:"stage"`
	Requests     int    `json:"requests"`
	PromptTokens int64  `json:"promptTokens"`
	OutputTokens int64  `json:"outputTokens"`
	CostUSD      float64 `json:"costUsd"`
}

// PipelineResult is the complete output of a trading analysis.
type PipelineResult struct {
	Symbol         string           `json:"symbol"`
	AnalystReports []AnalystReport  `json:"analystReports"`
	InvestmentPlan *InvestmentPlan  `json:"investmentPlan,omitempty"`
	TraderProposal *TraderProposal  `json:"traderProposal,omitempty"`
	FinalDecision  *FinalDecision   `json:"finalDecision,omitempty"`
	Stages         []Stage          `json:"stages"`
	CostBreakdown  []CostBreakdown  `json:"costBreakdown"`
	TotalCostUSD   float64          `json:"totalCostUsd"`
	StartedAt      time.Time        `json:"startedAt"`
	FinishedAt     time.Time        `json:"finishedAt,omitempty"`
	Error          string           `json:"error,omitempty"`
}
