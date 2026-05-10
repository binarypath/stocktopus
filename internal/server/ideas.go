package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"stocktopus/internal/store"
)

// globalOwnerID is the single user the sketchpad is scoped to today.
// Refactored to per-user later by reading session/auth.
const globalOwnerID = int64(1)

// handleIdeas serves the /ideas page (default sketchpad) and /ideas/{id}.
func (s *Server) handleIdeas(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.renderPage(w, r, "ideas.html", map[string]any{
		"Title":     "Ideas",
		"Active":    "ideas",
		"SketchID":  id,
	})
}

// handleListSketches returns sketches owned by the global user (newest first).
func (s *Server) handleListSketches(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		json.NewEncoder(w).Encode([]any{})
		return
	}
	sketches, err := s.store.ListSketches(globalOwnerID)
	if err != nil {
		s.logger.Error("list sketches", "error", err)
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	if sketches == nil {
		sketches = []store.Sketch{}
	}
	json.NewEncoder(w).Encode(sketches)
}

// handleCreateSketch creates an empty (or pre-populated) sketch and returns the new id.
func (s *Server) handleCreateSketch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.store == nil {
		http.Error(w, "store unavailable", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	id, err := s.store.CreateSketch(globalOwnerID, strings.TrimSpace(req.Name))
	if err != nil {
		http.Error(w, "create failed", http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]int64{"id": id})
}

func (s *Server) handleGetSketch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	sk, err := s.store.GetSketch(id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if sk.Metrics == nil {
		sk.Metrics = []store.SketchMetric{}
	}
	json.NewEncoder(w).Encode(sk)
}

func (s *Server) handleRenameSketch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if err := s.store.RenameSketch(id, strings.TrimSpace(req.Name)); err != nil {
		http.Error(w, "rename failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSketchNotes(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var req struct {
		Notes string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if err := s.store.UpdateSketchNotes(id, req.Notes); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteSketch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	if err := s.store.DeleteSketch(id); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAddSketchMetric(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var m store.SketchMetric
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	m.SketchID = id
	if m.Kind == "" || m.Identifier == "" {
		http.Error(w, "kind and identifier required", http.StatusBadRequest)
		return
	}
	mid, err := s.store.AddSketchMetric(m)
	if err != nil {
		http.Error(w, "add failed", http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]int64{"id": mid})
}

func (s *Server) handleRemoveSketchMetric(w http.ResponseWriter, r *http.Request) {
	mid, err := strconv.ParseInt(r.PathValue("metricId"), 10, 64)
	if err != nil {
		http.Error(w, "bad metricId", http.StatusBadRequest)
		return
	}
	if err := s.store.RemoveSketchMetric(mid); err != nil {
		http.Error(w, "remove failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleHistorical fronts FMP's historical EOD endpoint for any kind+symbol.
// kind is informational here — FMP's /historical-price-eod/light?symbol=X
// is uniform across stocks, commodities, forex pairs, crypto, and indices.
//
// For kind="financial" with identifier "SYMBOL.field" we delegate to the
// existing financials handler, since FMP exposes a different endpoint.
//
// Tickers can themselves contain periods (BRK.A, BRK.B, GOOG.L, etc.), so we
// split on the *rightmost* dot — everything after is the FMP field name (which
// is camelCase and case-sensitive — don't normalize the casing).
func (s *Server) handleHistorical(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	kind := r.PathValue("kind")
	rawSymbol := r.PathValue("symbol")

	if kind == "financial" {
		dot := strings.LastIndex(rawSymbol, ".")
		if dot <= 0 || dot >= len(rawSymbol)-1 {
			http.Error(w, "financial requires SYMBOL.field", http.StatusBadRequest)
			return
		}
		sym := strings.ToUpper(rawSymbol[:dot])
		field := rawSymbol[dot+1:] // preserve camelCase
		stmt := guessStatementType(field)
		raw, err := s.news.GetFinancials(r.Context(), sym, stmt, 5)
		if err != nil {
			http.Error(w, "fmp error", http.StatusBadGateway)
			return
		}
		var rows []map[string]any
		if err := json.Unmarshal(raw, &rows); err != nil {
			http.Error(w, "bad fmp response", http.StatusBadGateway)
			return
		}
		out := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			date, _ := row["date"].(string)
			if date == "" {
				if fy, ok := row["fiscalYear"].(string); ok {
					date = fy + "-12-31"
				}
			}
			v, ok := row[field]
			if !ok {
				continue
			}
			out = append(out, map[string]any{"date": date, "value": v})
		}
		json.NewEncoder(w).Encode(out)
		return
	}

	// EOD path — covers stocks, commodities, forex, crypto, indices uniformly.
	symbol := strings.ToUpper(rawSymbol)
	raw, err := s.news.GetHistoricalPriceLight(r.Context(), symbol)
	if err != nil {
		s.logger.Error("historical fetch", "kind", kind, "symbol", symbol, "error", err)
		http.Error(w, fmt.Sprintf("fmp error: %v", err), http.StatusBadGateway)
		return
	}
	w.Write(raw)
}

// guessStatementType maps a financial field name to its statement type.
// (FMP serves income / balance / cashflow as separate endpoints.)
func guessStatementType(field string) string {
	balance := map[string]bool{
		"totalAssets": true, "totalLiabilities": true, "totalStockholdersEquity": true,
		"totalDebt": true, "longTermDebt": true, "shortTermDebt": true,
		"cashAndCashEquivalents": true, "shortTermInvestments": true,
		"netReceivables": true, "inventory": true, "goodwill": true, "intangibleAssets": true,
		"totalCurrentAssets": true, "totalCurrentLiabilities": true, "retainedEarnings": true,
	}
	cashflow := map[string]bool{
		"operatingCashFlow": true, "freeCashFlow": true, "capitalExpenditure": true,
		"netCashUsedForInvestingActivities": true, "netCashUsedProvidedByFinancingActivities": true,
		"depreciationAndAmortization": true, "stockBasedCompensation": true,
		"accountsReceivables": true, "accountsPayables": true,
		"netChangeInCash": true, "dividendsPaid": true, "commonStockRepurchased": true,
		"debtRepayment": true,
	}
	if balance[field] {
		return "balance"
	}
	if cashflow[field] {
		return "cashflow"
	}
	return "income"
}
