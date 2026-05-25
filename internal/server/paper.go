package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"stocktopus/internal/paper"
	"stocktopus/internal/store"
)

// handlePaperPage renders the single-page paper trading surface (ticket + positions + journal).
func (s *Server) handlePaperPage(w http.ResponseWriter, r *http.Request) {
	s.renderPage(w, r, "paper.html", map[string]any{
		"Title":  "Paper",
		"Active": "paper",
	})
}

// --- accounts -----------------------------------------------------------

func (s *Server) handleListPaperAccounts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}
	accounts, err := s.store.GetPaperAccounts()
	if err != nil {
		s.logger.Error("list paper accounts", "error", err)
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	if accounts == nil {
		accounts = []store.PaperAccount{}
	}
	_ = json.NewEncoder(w).Encode(accounts)
}

func (s *Server) handleCreatePaperAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		http.Error(w, "store unavailable", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Name            string  `json:"name"`
		BaseCurrency    string  `json:"baseCurrency"`
		StartingBalance float64 `json:"startingBalance"`
		RiskPct         float64 `json:"riskPct"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.StartingBalance <= 0 || req.RiskPct <= 0 {
		http.Error(w, "name, startingBalance and riskPct are required", http.StatusBadRequest)
		return
	}
	if req.BaseCurrency == "" {
		req.BaseCurrency = "USD"
	}
	id, err := s.store.CreatePaperAccount(req.Name, req.BaseCurrency, req.StartingBalance, req.RiskPct)
	if err != nil {
		s.logger.Error("create paper account", "error", err)
		http.Error(w, "create failed", http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
}

func (s *Server) handleSetPaperAccountSettled(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		http.Error(w, "store unavailable", http.StatusServiceUnavailable)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var req struct {
		Settled bool    `json:"settled"`
		RiskPct float64 `json:"riskPct"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := s.store.SetPaperAccountSettled(id, req.Settled); err != nil {
		http.Error(w, "update failed", http.StatusInternalServerError)
		return
	}
	if req.RiskPct > 0 {
		if err := s.store.SetPaperAccountRisk(id, req.RiskPct); err != nil {
			http.Error(w, "update risk failed", http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- sizing preview -----------------------------------------------------

// handlePaperSizingPreview computes size + risk for the form input. Used live
// by the ticket UI on every keystroke.
func (s *Server) handlePaperSizingPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		InstrumentType string  `json:"instrumentType"`
		Multiplier     float64 `json:"multiplier"`
		Side           string  `json:"side"`
		EntryPrice     float64 `json:"entryPrice"`
		StopPrice      float64 `json:"stopPrice"`
		AccountSize    float64 `json:"accountSize"`
		RiskPct        float64 `json:"riskPct"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	it, err := paper.ParseInstrument(req.InstrumentType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Multiplier == 0 {
		req.Multiplier = paper.DefaultMultiplier(it)
	}
	res, err := paper.ComputeSize(paper.TicketInput{
		InstrumentType: it,
		Multiplier:     req.Multiplier,
		Side:           paper.Side(req.Side),
		EntryPrice:     req.EntryPrice,
		StopPrice:      req.StopPrice,
		AccountSize:    req.AccountSize,
		RiskPct:        req.RiskPct,
	})
	if err != nil {
		// Validation errors are normal user state; return them as JSON, not 500.
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"size":         res.Size,
		"riskAmount":   res.RiskAmount,
		"stopDistance": res.StopDistance,
	})
}

// --- trades -------------------------------------------------------------

func (s *Server) handleOpenPaperTrade(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		http.Error(w, "store unavailable", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		AccountID      int64    `json:"accountId"`
		SketchID       *int64   `json:"sketchId,omitempty"`
		Symbol         string   `json:"symbol"`
		InstrumentType string   `json:"instrumentType"`
		Multiplier     float64  `json:"multiplier"`
		Side           string   `json:"side"`
		EntryPrice     float64  `json:"entryPrice"`
		StopPrice      float64  `json:"stopPrice"`
		TargetPrice    *float64 `json:"targetPrice,omitempty"`
		Thesis         string   `json:"thesis"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	account, err := s.store.GetPaperAccount(req.AccountID)
	if err != nil {
		http.Error(w, "account not found", http.StatusNotFound)
		return
	}
	it, err := paper.ParseInstrument(req.InstrumentType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Multiplier == 0 {
		req.Multiplier = paper.DefaultMultiplier(it)
	}

	sizing, err := paper.ComputeSize(paper.TicketInput{
		InstrumentType: it,
		Multiplier:     req.Multiplier,
		Side:           paper.Side(req.Side),
		EntryPrice:     req.EntryPrice,
		StopPrice:      req.StopPrice,
		AccountSize:    account.CashBalance,
		RiskPct:        account.RiskPct,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if sizing.Size < 1 {
		http.Error(w, "computed size is zero — entry/stop/risk would buy fewer than 1 unit", http.StatusBadRequest)
		return
	}

	trade := store.PaperTrade{
		AccountID:      account.ID,
		SketchID:       req.SketchID,
		Symbol:         strings.ToUpper(strings.TrimSpace(req.Symbol)),
		InstrumentType: string(it),
		Multiplier:     req.Multiplier,
		Side:           req.Side,
		EntryPrice:     req.EntryPrice,
		StopPrice:      req.StopPrice,
		TargetPrice:    req.TargetPrice,
		Size:           sizing.Size,
		RiskPctAtEntry: account.RiskPct,
		RiskAmount:     sizing.RiskAmount,
		OpenedAt:       time.Now().UTC(),
		Thesis:         req.Thesis,
	}
	id, err := s.store.OpenPaperTrade(trade)
	if err != nil {
		s.logger.Error("open paper trade", "error", err)
		http.Error(w, "open failed", http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":         id,
		"size":       sizing.Size,
		"riskAmount": sizing.RiskAmount,
	})
}

func (s *Server) handleListOpenPaperTrades(w http.ResponseWriter, r *http.Request) {
	s.listPaperTrades(w, r, true)
}

func (s *Server) handleListClosedPaperTrades(w http.ResponseWriter, r *http.Request) {
	s.listPaperTrades(w, r, false)
}

func (s *Server) listPaperTrades(w http.ResponseWriter, r *http.Request, open bool) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}
	accountID, err := strconv.ParseInt(r.URL.Query().Get("accountId"), 10, 64)
	if err != nil {
		http.Error(w, "accountId required", http.StatusBadRequest)
		return
	}
	var trades []store.PaperTrade
	if open {
		trades, err = s.store.GetOpenPaperTrades(accountID)
	} else {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		trades, err = s.store.GetClosedPaperTrades(accountID, limit, offset)
	}
	if err != nil {
		s.logger.Error("list paper trades", "error", err)
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	if trades == nil {
		trades = []store.PaperTrade{}
	}
	_ = json.NewEncoder(w).Encode(trades)
}

func (s *Server) handleClosePaperTrade(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		http.Error(w, "store unavailable", http.StatusServiceUnavailable)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var req struct {
		ExitPrice float64 `json:"exitPrice"`
		Reason    string  `json:"reason"` // 'stop' | 'target' | 'manual'
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.ExitPrice <= 0 || req.Reason == "" {
		http.Error(w, "exitPrice and reason required", http.StatusBadRequest)
		return
	}
	if err := s.store.ClosePaperTrade(id, req.ExitPrice, req.Reason); err != nil {
		if errors.Is(err, nil) {
			http.Error(w, "close failed", http.StatusInternalServerError)
			return
		}
		s.logger.Error("close paper trade", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
