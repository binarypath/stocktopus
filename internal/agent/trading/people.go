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
	"sync"
	"time"

	"stocktopus/internal/store"
)

// PeopleExtractor pulls leadership data out of SEC filings:
//   - 8-K Item 5.02 → personnel-change events (appointed / resigned / departed / promoted)
//   - 10-K Item 10/11/12 → snapshot of current directors and executive officers
//   - DEF 14A → snapshot of board of directors and named executive officers
//
// Snapshot rows replace previous snapshots from the same form when a newer filing arrives.
// Event rows accumulate.
type PeopleExtractor struct {
	ollamaHost  string
	ollamaModel string
	store       *store.Store
	sec         *SECFetcher
	client      *http.Client
	logger      *slog.Logger

	mu       sync.Mutex
	inFlight map[string]bool // symbol → currently being processed
}

func NewPeopleExtractor(ollamaHost, ollamaModel string, st *store.Store, logger *slog.Logger) *PeopleExtractor {
	if ollamaHost == "" {
		ollamaHost = "http://localhost:11434"
	}
	if ollamaModel == "" {
		ollamaModel = "gemma3"
	}
	return &PeopleExtractor{
		ollamaHost:  ollamaHost,
		ollamaModel: ollamaModel,
		store:       st,
		sec:         NewSECFetcher(logger),
		client:      &http.Client{Timeout: 5 * time.Minute},
		logger:      logger.With("component", "people-extractor"),
		inFlight:    make(map[string]bool),
	}
}

// ExtractFromFilings processes all unprocessed personnel-relevant filings for a symbol.
// Per-symbol singleflight guards against concurrent runs; the processed_for_people flag
// on sec_filings prevents re-LLM'ing filings that yielded no people.
func (pe *PeopleExtractor) ExtractFromFilings(ctx context.Context, symbol string) {
	pe.mu.Lock()
	if pe.inFlight[symbol] {
		pe.mu.Unlock()
		return
	}
	pe.inFlight[symbol] = true
	pe.mu.Unlock()
	defer func() {
		pe.mu.Lock()
		delete(pe.inFlight, symbol)
		pe.mu.Unlock()
	}()

	// Process 8-K events (multiple per period — events accumulate)
	pe.processForm(ctx, symbol, "8-K", 10)

	// Snapshots: only the most-recent filing of each type matters
	pe.processForm(ctx, symbol, "10-K", 1)
	pe.processForm(ctx, symbol, "DEF 14A", 1)
}

func (pe *PeopleExtractor) processForm(ctx context.Context, symbol, formType string, limit int) {
	filings, err := pe.store.GetUnprocessedSECFilings(symbol, formType, limit)
	if err != nil || len(filings) == 0 {
		return
	}

	for _, f := range filings {
		pe.logger.Debug("extracting people", "symbol", symbol, "form", formType, "date", f.FilingDate)

		text, err := pe.sec.FetchFilingText(ctx, f.Link, formType)
		if err != nil {
			pe.logger.Debug("sec fetch failed", "url", f.Link, "error", err)
			// Mark processed anyway so we don't retry endlessly on a permanently broken link
			_ = pe.store.MarkSECFilingProcessedForPeople(symbol, f.Link)
			continue
		}

		filingDate := f.FilingDate
		if len(filingDate) > 10 {
			filingDate = filingDate[:10]
		}

		switch formType {
		case "8-K":
			people := pe.extractEvents(ctx, symbol, text, filingDate, f.Link)
			for _, p := range people {
				if err := pe.store.PutKeyPerson(p); err != nil {
					pe.logger.Debug("failed to store event", "error", err)
				}
			}
		case "10-K", "DEF 14A":
			section := relevantSection(text, formType)
			people := pe.extractSnapshot(ctx, symbol, section, filingDate, f.Link, formType)
			if len(people) > 0 {
				if err := pe.store.ReplaceCurrentKeyPeople(symbol, formType, people); err != nil {
					pe.logger.Debug("failed to replace snapshot", "error", err)
				}
			}
		}

		if err := pe.store.MarkSECFilingProcessedForPeople(symbol, f.Link); err != nil {
			pe.logger.Debug("failed to mark processed", "link", f.Link, "error", err)
		}
	}
}

// relevantSection narrows huge filings down to the leadership-relevant slice so
// the LLM doesn't have to scan an entire 200k+ char document. Smaller input also
// keeps Ollama response time reasonable on consumer-grade GPUs.
func relevantSection(text, formType string) string {
	switch formType {
	case "10-K":
		// Item 10 ("Directors, Executive Officers and Corporate Governance") sits late in the document.
		// Find its heading and grab through Item 13 or 30k chars, whichever comes first.
		lower := strings.ToLower(text)
		idx := strings.Index(lower, "item 10.")
		if idx < 0 {
			idx = strings.Index(lower, "item 10 ")
		}
		if idx < 0 {
			// No Item 10 heading detected (or parsing missed it) — fall back to last 30k chars,
			// which is where these items usually sit in a 10-K.
			if len(text) > 30000 {
				return text[len(text)-30000:]
			}
			return text
		}
		end := idx + 30000
		if end > len(text) {
			end = len(text)
		}
		return text[idx:end]
	case "DEF 14A":
		return def14aLeadershipSection(text)
	default:
		return text
	}
}

// def14aLeadershipSection finds the directors+officers section of a proxy and
// returns ~40k chars from there, falling back to the first 50k chars if no
// recognised marker is present. Skipping the comp tables further down avoids
// XBRL pay-for-performance noise like "PeoMember" and "NonPeoNeo" tags.
func def14aLeadershipSection(text string) string {
	const sectionLen = 40000
	const fallbackLen = 50000

	lower := strings.ToLower(text)
	markers := []string{
		"election of directors",
		"director nominees",
		"information about our directors",
		"information about the director nominees",
		"our directors",
		"our board of directors",
		"executive officers of the registrant",
		"information about our executive officers",
	}
	bestIdx := -1
	for _, m := range markers {
		if i := strings.Index(lower, m); i >= 0 && (bestIdx < 0 || i < bestIdx) {
			bestIdx = i
		}
	}
	if bestIdx < 0 {
		if len(text) > fallbackLen {
			return text[:fallbackLen]
		}
		return text
	}
	end := bestIdx + sectionLen
	if end > len(text) {
		end = len(text)
	}
	return text[bestIdx:end]
}

// ── Ollama prompt + extraction for 8-K events ────────────────────────────────

func (pe *PeopleExtractor) extractEvents(ctx context.Context, symbol, text, filingDate, source string) []store.KeyPerson {
	prompt := fmt.Sprintf(`Extract executive and board member changes from this SEC 8-K filing for %s.
Look for: appointments, resignations, departures, promotions, compensation changes.
If no personnel changes are mentioned, return an empty people array.

Filing text:
%s`, symbol, text)

	schema := map[string]interface{}{
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
	}

	var parsed struct {
		People []struct {
			Name      string `json:"name"`
			Title     string `json:"title"`
			EventType string `json:"eventType"`
		} `json:"people"`
	}
	if err := pe.callOllama(ctx, prompt, schema, &parsed); err != nil {
		pe.logger.Debug("ollama call failed", "form", "8-K", "error", err)
		return nil
	}

	var result []store.KeyPerson
	for _, p := range parsed.People {
		if !looksLikeRealPerson(p.Name) {
			continue
		}
		result = append(result, store.KeyPerson{
			Symbol:    symbol,
			Name:      p.Name,
			Title:     p.Title,
			EventType: p.EventType,
			EventDate: filingDate,
			Source:    source,
			IsCurrent: false,
			FormType:  "8-K",
		})
	}
	return result
}

// ── Ollama prompt + extraction for 10-K / DEF 14A snapshots ──────────────────

func (pe *PeopleExtractor) extractSnapshot(ctx context.Context, symbol, text, filingDate, source, formType string) []store.KeyPerson {
	formDescription := map[string]string{
		"10-K":    "Item 10 of an SEC 10-K annual report (Directors, Executive Officers and Corporate Governance).",
		"DEF 14A": "section of an SEC DEF 14A proxy statement (board nominees, named executive officers).",
	}[formType]
	if formDescription == "" {
		formDescription = "an SEC filing."
	}

	prompt := fmt.Sprintf(`Extract the current directors and executive officers of %s from this %s
For each person, provide their full name and current title at the company. Skip people only mentioned for historical context.
If the document incorporates this information by reference to another filing and contains no actual names, return an empty array.

Filing text:
%s`, symbol, formDescription, text)

	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"people": map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"name":  map[string]string{"type": "string"},
						"title": map[string]string{"type": "string"},
						"role":  map[string]interface{}{"type": "string", "enum": []string{"director", "officer", "both"}},
					},
					"required": []string{"name", "title", "role"},
				},
			},
		},
		"required": []string{"people"},
	}

	var parsed struct {
		People []struct {
			Name  string `json:"name"`
			Title string `json:"title"`
			Role  string `json:"role"`
		} `json:"people"`
	}
	if err := pe.callOllama(ctx, prompt, schema, &parsed); err != nil {
		pe.logger.Debug("ollama call failed", "form", formType, "error", err)
		return nil
	}

	var result []store.KeyPerson
	for _, p := range parsed.People {
		if !looksLikeRealPerson(p.Name) {
			continue
		}
		// Title "Member" by itself is a compensation-table column header, not a real role —
		// only keep these if some other DEF 14A entry gives the person a more descriptive title.
		title := strings.TrimSpace(p.Title)
		if strings.EqualFold(title, "member") || strings.EqualFold(title, "members") {
			title = ""
		}
		result = append(result, store.KeyPerson{
			Symbol:    symbol,
			Name:      p.Name,
			Title:     title,
			EventType: p.Role,
			EventDate: filingDate,
			Source:    source,
			IsCurrent: true,
			AsOfDate:  filingDate,
			FormType:  formType,
		})
	}
	return result
}

// ── Name sanity filter ───────────────────────────────────────────────────────

// looksLikeRealPerson rejects extraction garbage that the LLM sometimes mistakes
// for a person — XBRL taxonomy element names (e.g. "NonPeoNeoAvgChange" or
// "YrEndFrValOfEqtyAwrdsGrntd"), legal-entity names (Computershare Inc.,
// Trustee), and pure category labels ("Board of Directors").
func looksLikeRealPerson(name string) bool {
	name = strings.TrimSpace(name)
	n := len(name)
	if n < 3 || n > 60 {
		return false
	}

	// Real human names contain at least one space (first + last).
	if !strings.Contains(name, " ") {
		return false
	}

	// Reject legal-entity suffixes — these are organisations, not people.
	lower := strings.ToLower(name)
	for _, suffix := range []string{
		" inc", " inc.", " llc", " l.l.c.", " corp", " corp.",
		" co.", " company", " trust", " bank", " n.a.", " n.a",
		" l.p.", " lp", " plc", " ltd", " ltd.",
	} {
		if strings.HasSuffix(lower, suffix) {
			return false
		}
	}

	// Reject pure category labels.
	for _, blocked := range []string{
		"board of directors", "compensation committee", "audit committee",
		"named executive", "principal executive", "non-employee director",
		"initial purchaser", "registered holder", "beneficial owner",
	} {
		if lower == blocked {
			return false
		}
	}

	// Reject if any word is longer than 22 chars — XBRL identifiers like
	// "YrEndFrValOfEqtyAwrdsGrntdInCvrdYrOutsdngAndUnvstd" run together
	// without spaces and dwarf normal name lengths.
	for _, word := range strings.Fields(name) {
		word = strings.Trim(word, "().,;:'\"")
		if len(word) > 22 {
			return false
		}
	}

	return true
}

// ── Ollama wrapper ───────────────────────────────────────────────────────────

func (pe *PeopleExtractor) callOllama(ctx context.Context, prompt string, schema map[string]interface{}, into interface{}) error {
	reqBody, err := json.Marshal(map[string]interface{}{
		"model":  pe.ollamaModel,
		"prompt": prompt,
		"stream": false,
		"format": schema,
		"options": map[string]interface{}{
			"temperature": 0.1,
			"num_predict": 2048,
		},
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", pe.ollamaHost+"/api/generate", bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := pe.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ollama http %d", resp.StatusCode)
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return err
	}
	return json.Unmarshal([]byte(strings.TrimSpace(ollamaResp.Response)), into)
}
