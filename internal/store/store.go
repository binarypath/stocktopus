package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// CompanyIntelligence holds AI-generated analysis for a security.
type CompanyIntelligence struct {
	Symbol        string          `json:"symbol"`
	CompanyName   string          `json:"companyName"`
	Sector        string          `json:"sector"`
	Analysis      json.RawMessage `json:"analysis,omitempty"`
	Sentiment     float64         `json:"sentiment"`
	RiskScore     float64         `json:"riskScore"`
	Summary       string          `json:"summary"`
	KeyRisks      []string        `json:"keyRisks"`
	Opportunities []string        `json:"opportunities"`
	Competitors   []string        `json:"competitors"`
	Sources       []string        `json:"sources"`
	GeneratedAt   time.Time       `json:"generatedAt"`
	ModelVersion  string          `json:"modelVersion"`
	Confidence    float64         `json:"confidence"`
}

// TrainingPair holds a prompt/completion pair for fine-tuning.
type TrainingPair struct {
	ID           int64     `json:"id"`
	Symbol       string    `json:"symbol"`
	Prompt       string    `json:"prompt"`
	Completion   string    `json:"completion"`
	Source       string    `json:"source"`
	CreatedAt    time.Time `json:"createdAt"`
	QualityScore float64   `json:"qualityScore"`
}

// Store manages the SQLite database for company intelligence.
type Store struct {
	db *sql.DB
}

func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS company_intelligence (
			symbol TEXT PRIMARY KEY,
			company_name TEXT,
			sector TEXT,
			analysis JSON,
			sentiment REAL DEFAULT 0,
			risk_score REAL DEFAULT 0,
			summary TEXT DEFAULT '',
			key_risks JSON DEFAULT '[]',
			opportunities JSON DEFAULT '[]',
			competitors JSON DEFAULT '[]',
			sources JSON DEFAULT '[]',
			generated_at DATETIME,
			model_version TEXT DEFAULT '',
			confidence REAL DEFAULT 0,
			raw_data JSON DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS training_data (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			symbol TEXT,
			prompt TEXT,
			completion TEXT,
			source TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			quality_score REAL DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_training_symbol ON training_data(symbol);

		CREATE TABLE IF NOT EXISTS watchlists (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			color TEXT NOT NULL DEFAULT '#ff8800',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS watchlist_symbols (
			watchlist_id INTEGER NOT NULL,
			symbol TEXT NOT NULL,
			added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (watchlist_id, symbol),
			FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE
		);

		INSERT OR IGNORE INTO watchlists (name, color) VALUES ('Default', '#ff8800');

		CREATE TABLE IF NOT EXISTS sic_codes (
			sic_code TEXT PRIMARY KEY,
			industry_title TEXT NOT NULL,
			office TEXT DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS sector_intelligence (
			sector TEXT PRIMARY KEY,
			industry TEXT DEFAULT '',
			peers JSON DEFAULT '[]',
			news JSON DEFAULT '[]',
			performance JSON DEFAULT '{}',
			generated_at DATETIME,
			model_version TEXT DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS sec_filings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			symbol TEXT NOT NULL,
			cik TEXT NOT NULL DEFAULT '',
			form_type TEXT NOT NULL,
			filing_date TEXT NOT NULL,
			accepted_date TEXT DEFAULT '',
			link TEXT DEFAULT '',
			final_link TEXT DEFAULT '',
			fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(symbol, form_type, filing_date, link)
		);
		CREATE INDEX IF NOT EXISTS idx_sec_symbol ON sec_filings(symbol);
		CREATE INDEX IF NOT EXISTS idx_sec_form ON sec_filings(form_type);

		CREATE TABLE IF NOT EXISTS sec_form_types (
			form_type TEXT PRIMARY KEY,
			title TEXT NOT NULL DEFAULT '',
			purpose TEXT NOT NULL DEFAULT '',
			timing TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS key_people (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			symbol TEXT NOT NULL,
			name TEXT NOT NULL,
			title TEXT DEFAULT '',
			event_type TEXT DEFAULT '',
			event_date TEXT DEFAULT '',
			source TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_people_symbol ON key_people(symbol);

		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			handle TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		-- Single global user for now — every sketch belongs to this row.
		-- Refactored to per-user later by adding more rows + auth.
		INSERT OR IGNORE INTO users (id, handle, display_name) VALUES (1, 'global', 'Global');

		CREATE TABLE IF NOT EXISTS sketches (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			owner_id INTEGER NOT NULL DEFAULT 1,
			name TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (owner_id) REFERENCES users(id)
		);
		CREATE INDEX IF NOT EXISTS idx_sketches_owner ON sketches(owner_id);

		CREATE TABLE IF NOT EXISTS sketch_metrics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sketch_id INTEGER NOT NULL,
			kind TEXT NOT NULL,        -- 'price' | 'financial' | 'commodity' | 'forex' | 'crypto' | 'index' | 'economic'
			identifier TEXT NOT NULL,  -- 'AAPL' | 'AAPL.revenue' | 'GCUSD' | 'EURUSD' | 'BTCUSD' | 'SPX' | 'UNRATE'
			label TEXT NOT NULL DEFAULT '',
			color TEXT NOT NULL DEFAULT '',
			position INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (sketch_id) REFERENCES sketches(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_sketch_metrics_sketch ON sketch_metrics(sketch_id);

		CREATE TABLE IF NOT EXISTS economic_series (
			code TEXT PRIMARY KEY,        -- FRED series ID (e.g. UNRATE)
			title TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT '',
			frequency TEXT NOT NULL DEFAULT '', -- D / W / M / Q / A — from FRED
			units TEXT NOT NULL DEFAULT '',
			observations TEXT NOT NULL DEFAULT '[]', -- JSON [{date, value}, ...] in ascending date order
			source_updated_at TEXT NOT NULL DEFAULT '', -- FRED's last_updated (string, parse on display)
			fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		return err
	}

	// Idempotent column adds — ignore "duplicate column" errors on existing DBs.
	if _, err := s.db.Exec(`ALTER TABLE sec_filings ADD COLUMN processed_for_people INTEGER NOT NULL DEFAULT 0`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return err
	}

	// Adding is_current is the upgrade signal from the broken-Python-fetcher era
	// to the SEC-compliant Go fetcher: if the column doesn't yet exist, reset the
	// processed flag so previously-attempted filings get a real extraction pass.
	upgradedToSECFetcher := false
	if _, err := s.db.Exec(`ALTER TABLE key_people ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0`); err != nil {
		if !strings.Contains(err.Error(), "duplicate column") {
			return err
		}
	} else {
		upgradedToSECFetcher = true
	}
	if _, err := s.db.Exec(`ALTER TABLE key_people ADD COLUMN as_of_date TEXT DEFAULT ''`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	if _, err := s.db.Exec(`ALTER TABLE key_people ADD COLUMN form_type TEXT DEFAULT ''`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	if _, err := s.db.Exec(`ALTER TABLE sketches ADD COLUMN notes TEXT NOT NULL DEFAULT ''`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	if upgradedToSECFetcher {
		if _, err := s.db.Exec(`UPDATE sec_filings SET processed_for_people = 0`); err != nil {
			return err
		}
	}

	return s.seedSECFormTypes()
}

// Get returns the cached intelligence for a symbol, or nil if not found.
func (s *Store) Get(symbol string) (*CompanyIntelligence, error) {
	row := s.db.QueryRow(`
		SELECT symbol, company_name, sector, analysis, sentiment, risk_score,
		       summary, key_risks, opportunities, competitors, sources,
		       generated_at, model_version, confidence
		FROM company_intelligence WHERE symbol = ?`, symbol)

	var ci CompanyIntelligence
	var keyRisks, opportunities, competitors, sources []byte
	var generatedAt string

	err := row.Scan(&ci.Symbol, &ci.CompanyName, &ci.Sector, &ci.Analysis,
		&ci.Sentiment, &ci.RiskScore, &ci.Summary,
		&keyRisks, &opportunities, &competitors, &sources,
		&generatedAt, &ci.ModelVersion, &ci.Confidence)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal(keyRisks, &ci.KeyRisks)
	json.Unmarshal(opportunities, &ci.Opportunities)
	json.Unmarshal(competitors, &ci.Competitors)
	json.Unmarshal(sources, &ci.Sources)
	ci.GeneratedAt, _ = time.Parse("2006-01-02 15:04:05Z", generatedAt+"Z")

	return &ci, nil
}

// Put upserts company intelligence.
func (s *Store) Put(ci *CompanyIntelligence) error {
	keyRisks, _ := json.Marshal(ci.KeyRisks)
	opportunities, _ := json.Marshal(ci.Opportunities)
	competitors, _ := json.Marshal(ci.Competitors)
	sources, _ := json.Marshal(ci.Sources)

	_, err := s.db.Exec(`
		INSERT INTO company_intelligence
			(symbol, company_name, sector, analysis, sentiment, risk_score,
			 summary, key_risks, opportunities, competitors, sources,
			 generated_at, model_version, confidence)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(symbol) DO UPDATE SET
			company_name = excluded.company_name,
			sector = excluded.sector,
			analysis = excluded.analysis,
			sentiment = excluded.sentiment,
			risk_score = excluded.risk_score,
			summary = excluded.summary,
			key_risks = excluded.key_risks,
			opportunities = excluded.opportunities,
			competitors = excluded.competitors,
			sources = excluded.sources,
			generated_at = excluded.generated_at,
			model_version = excluded.model_version,
			confidence = excluded.confidence`,
		ci.Symbol, ci.CompanyName, ci.Sector, ci.Analysis,
		ci.Sentiment, ci.RiskScore, ci.Summary,
		keyRisks, opportunities, competitors, sources,
		ci.GeneratedAt.UTC().Format("2006-01-02 15:04:05"),
		ci.ModelVersion, ci.Confidence)

	return err
}

// IsFresh returns true if the analysis is younger than maxAge.
func (s *Store) IsFresh(symbol string, maxAge time.Duration) bool {
	ci, err := s.Get(symbol)
	if err != nil || ci == nil {
		return false
	}
	return time.Since(ci.GeneratedAt) < maxAge
}

// Rename clones a company record under a new symbol.
func (s *Store) Rename(oldSymbol, newSymbol string) error {
	ci, err := s.Get(oldSymbol)
	if err != nil || ci == nil {
		return fmt.Errorf("source not found: %s", oldSymbol)
	}
	ci.Symbol = newSymbol
	return s.Put(ci)
}

// AddTrainingPair stores a prompt/completion pair for fine-tuning.
func (s *Store) AddTrainingPair(symbol, prompt, completion, source string, quality float64) error {
	_, err := s.db.Exec(`
		INSERT INTO training_data (symbol, prompt, completion, source, quality_score)
		VALUES (?, ?, ?, ?, ?)`, symbol, prompt, completion, source, quality)
	return err
}

// ExportTrainingData returns all training pairs as JSONL-ready structs.
func (s *Store) ExportTrainingData(minQuality float64) ([]TrainingPair, error) {
	rows, err := s.db.Query(`
		SELECT id, symbol, prompt, completion, source, created_at, quality_score
		FROM training_data WHERE quality_score >= ? ORDER BY created_at`, minQuality)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pairs []TrainingPair
	for rows.Next() {
		var tp TrainingPair
		var createdAt string
		err := rows.Scan(&tp.ID, &tp.Symbol, &tp.Prompt, &tp.Completion,
			&tp.Source, &createdAt, &tp.QualityScore)
		if err != nil {
			return nil, err
		}
		tp.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		pairs = append(pairs, tp)
	}
	return pairs, nil
}

// TrainingDataCount returns the number of training pairs.
func (s *Store) TrainingDataCount() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM training_data`).Scan(&count)
	return count, err
}

// ── Watchlists ──

// Watchlist represents a named watchlist with a color.
type Watchlist struct {
	ID      int64    `json:"id"`
	Name    string   `json:"name"`
	Color   string   `json:"color"`
	Symbols []string `json:"symbols"`
}

// Preset colors for new watchlists
var watchlistColors = []string{
	"#ff8800", "#4499ff", "#00cc66", "#ff4444",
	"#cc66ff", "#ffcc00", "#00cccc", "#ff6699",
}

// GetWatchlists returns all watchlists with their symbols.
func (s *Store) GetWatchlists() ([]Watchlist, error) {
	rows, err := s.db.Query(`SELECT id, name, color FROM watchlists ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lists []Watchlist
	for rows.Next() {
		var w Watchlist
		if err := rows.Scan(&w.ID, &w.Name, &w.Color); err != nil {
			return nil, err
		}
		lists = append(lists, w)
	}

	// Load symbols for each
	for i := range lists {
		symRows, err := s.db.Query(`SELECT symbol FROM watchlist_symbols WHERE watchlist_id = ? ORDER BY added_at`, lists[i].ID)
		if err != nil {
			continue
		}
		for symRows.Next() {
			var sym string
			symRows.Scan(&sym)
			lists[i].Symbols = append(lists[i].Symbols, sym)
		}
		symRows.Close()
	}

	return lists, nil
}

// CreateWatchlist creates a new watchlist with an auto-assigned color.
func (s *Store) CreateWatchlist(name string) (*Watchlist, error) {
	// Count existing for color assignment
	var count int
	s.db.QueryRow(`SELECT COUNT(*) FROM watchlists`).Scan(&count)
	color := watchlistColors[count%len(watchlistColors)]

	res, err := s.db.Exec(`INSERT INTO watchlists (name, color) VALUES (?, ?)`, name, color)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Watchlist{ID: id, Name: name, Color: color}, nil
}

// AddToWatchlist adds a symbol to a watchlist. Uses default watchlist if watchlistID is 0.
func (s *Store) AddToWatchlist(watchlistID int64, symbol string) error {
	if watchlistID == 0 {
		s.db.QueryRow(`SELECT id FROM watchlists ORDER BY id LIMIT 1`).Scan(&watchlistID)
	}
	_, err := s.db.Exec(`INSERT OR IGNORE INTO watchlist_symbols (watchlist_id, symbol) VALUES (?, ?)`,
		watchlistID, symbol)
	return err
}

// RemoveFromWatchlist removes a symbol from a watchlist.
func (s *Store) RemoveFromWatchlist(watchlistID int64, symbol string) error {
	_, err := s.db.Exec(`DELETE FROM watchlist_symbols WHERE watchlist_id = ? AND symbol = ?`,
		watchlistID, symbol)
	return err
}

// GetSymbolWatchlists returns which watchlists a symbol belongs to.
func (s *Store) GetSymbolWatchlists(symbol string) ([]Watchlist, error) {
	rows, err := s.db.Query(`
		SELECT w.id, w.name, w.color FROM watchlists w
		JOIN watchlist_symbols ws ON w.id = ws.watchlist_id
		WHERE ws.symbol = ?`, symbol)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lists []Watchlist
	for rows.Next() {
		var w Watchlist
		rows.Scan(&w.ID, &w.Name, &w.Color)
		lists = append(lists, w)
	}
	return lists, nil
}

// ── Sector Intelligence ──

type SectorIntelligence struct {
	Sector      string          `json:"sector"`
	Industry    string          `json:"industry"`
	Peers       json.RawMessage `json:"peers"`
	News        json.RawMessage `json:"news"`
	Performance json.RawMessage `json:"performance"`
	GeneratedAt time.Time       `json:"generatedAt"`
}

func (s *Store) GetSector(sector string) (*SectorIntelligence, error) {
	row := s.db.QueryRow(`SELECT sector, industry, peers, news, performance, generated_at FROM sector_intelligence WHERE sector = ?`, sector)
	var si SectorIntelligence
	var genAt string
	err := row.Scan(&si.Sector, &si.Industry, &si.Peers, &si.News, &si.Performance, &genAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	si.GeneratedAt, _ = time.Parse("2006-01-02 15:04:05Z", genAt+"Z")
	return &si, nil
}

func (s *Store) PutSector(si *SectorIntelligence) error {
	_, err := s.db.Exec(`
		INSERT INTO sector_intelligence (sector, industry, peers, news, performance, generated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(sector) DO UPDATE SET
			industry = excluded.industry,
			peers = excluded.peers,
			news = excluded.news,
			performance = excluded.performance,
			generated_at = excluded.generated_at`,
		si.Sector, si.Industry, si.Peers, si.News, si.Performance,
		si.GeneratedAt.UTC().Format("2006-01-02 15:04:05"))
	return err
}

func (s *Store) IsSectorFresh(sector string, maxAge time.Duration) bool {
	si, err := s.GetSector(sector)
	if err != nil || si == nil {
		return false
	}
	return time.Since(si.GeneratedAt) < maxAge
}

// ── SIC Codes ──

type SICCode struct {
	Code          string `json:"sicCode"`
	IndustryTitle string `json:"industryTitle"`
	Office        string `json:"office"`
}

// PopulateSIC bulk-inserts SIC codes (idempotent).
func (s *Store) PopulateSIC(codes []SICCode) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO sic_codes (sic_code, industry_title, office) VALUES (?, ?, ?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	for _, c := range codes {
		stmt.Exec(c.Code, c.IndustryTitle, c.Office)
	}
	return tx.Commit()
}

// GetSICCode returns an SIC entry by code.
func (s *Store) GetSICCode(code string) (*SICCode, error) {
	var c SICCode
	err := s.db.QueryRow(`SELECT sic_code, industry_title, office FROM sic_codes WHERE sic_code = ?`, code).
		Scan(&c.Code, &c.IndustryTitle, &c.Office)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &c, err
}

// GetAllSICCodes returns all SIC codes.
func (s *Store) GetAllSICCodes() ([]SICCode, error) {
	rows, err := s.db.Query(`SELECT sic_code, industry_title, office FROM sic_codes ORDER BY sic_code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var codes []SICCode
	for rows.Next() {
		var c SICCode
		rows.Scan(&c.Code, &c.IndustryTitle, &c.Office)
		codes = append(codes, c)
	}
	return codes, nil
}

// SICCodeCount returns the number of SIC codes stored.
func (s *Store) SICCodeCount() int {
	var count int
	s.db.QueryRow(`SELECT COUNT(*) FROM sic_codes`).Scan(&count)
	return count
}

// GetAllWatchedSymbols returns all unique symbols across all watchlists.
func (s *Store) GetAllWatchedSymbols() ([]string, error) {
	rows, err := s.db.Query(`SELECT DISTINCT symbol FROM watchlist_symbols ORDER BY symbol`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var symbols []string
	for rows.Next() {
		var sym string
		rows.Scan(&sym)
		symbols = append(symbols, sym)
	}
	return symbols, nil
}

// ── SEC Filings ──

// SECFiling represents a cached SEC filing.
type SECFiling struct {
	Symbol       string `json:"symbol"`
	CIK          string `json:"cik"`
	FormType     string `json:"formType"`
	FilingDate   string `json:"filingDate"`
	AcceptedDate string `json:"acceptedDate"`
	Link         string `json:"link"`
	FinalLink    string `json:"finalLink"`
}

// SECFormType describes a tracked SEC form type.
type SECFormType struct {
	FormType string `json:"formType"`
	Title    string `json:"title"`
	Purpose  string `json:"purpose"`
	Timing   string `json:"timing"`
	Category string `json:"category"`
}

// KeyPerson represents either a current leadership snapshot row (IsCurrent=true,
// sourced from 10-K Item 10/11/12 or DEF 14A) or a personnel-change event
// (IsCurrent=false, sourced from 8-K Item 5.02 — appointed / resigned / departed / promoted).
type KeyPerson struct {
	Symbol    string `json:"symbol"`
	Name      string `json:"name"`
	Title     string `json:"title"`
	EventType string `json:"eventType"`
	EventDate string `json:"eventDate"`
	Source    string `json:"source"`
	IsCurrent bool   `json:"isCurrent"`
	AsOfDate  string `json:"asOfDate"`
	FormType  string `json:"formType"`
}

func (s *Store) seedSECFormTypes() error {
	forms := []SECFormType{
		{"S-1", "Registration Statement", "Register securities for IPO or primary offering", "As needed", "registration"},
		{"S-3", "Registration Statement", "Simplified registration for follow-on offerings after IPO", "As needed", "registration"},
		{"S-8", "Registration Statement", "Register securities for employee benefit plans", "As needed", "registration"},
		{"3", "Initial Statement of Beneficial Ownership", "Initial insider ownership declaration", "Within 10 days of becoming insider", "ownership"},
		{"4", "Statement of Changes in Beneficial Ownership", "Insider stock transactions", "Within 2 business days", "ownership"},
		{"5", "Annual Statement of Beneficial Ownership", "Annual summary of insider transactions", "Within 45 days of fiscal year end", "ownership"},
		{"6-K", "Foreign Private Issuer Report", "Material events for foreign issuers", "As needed", "event"},
		{"8-K", "Current Report", "Material events — M&A, exec changes, operational developments", "As needed", "event"},
		{"10-K", "Annual Report", "Comprehensive annual business and financial report", "Annually", "periodic"},
		{"10-Q", "Quarterly Report", "Quarterly financial performance snapshot", "Quarterly", "periodic"},
		{"11-K", "Employee Plan Annual Report", "Employee stock purchase and savings plan reports", "Annually", "periodic"},
		{"20-F", "Foreign Annual Report", "Annual report for non-US/Canadian companies trading in US", "Annually", "periodic"},
		{"SC 13D", "Beneficial Ownership Report", "Filed when acquiring >5%% of shares — identity, purpose", "Within 10 days", "ownership"},
		{"SC 13G", "Passive Beneficial Ownership", "Passive >5%% ownership report with exemptions", "Annually", "ownership"},
		{"DEF 14A", "Proxy Statement", "Shareholder meeting info — director elections, exec compensation", "Before annual meeting", "proxy"},
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO sec_form_types (form_type, title, purpose, timing, category) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, f := range forms {
		stmt.Exec(f.FormType, f.Title, f.Purpose, f.Timing, f.Category)
	}
	return tx.Commit()
}

// PutSECFilings bulk inserts SEC filings (ignoring duplicates).
func (s *Store) PutSECFilings(filings []SECFiling) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO sec_filings (symbol, cik, form_type, filing_date, accepted_date, link, final_link) VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, f := range filings {
		stmt.Exec(f.Symbol, f.CIK, f.FormType, f.FilingDate, f.AcceptedDate, f.Link, f.FinalLink)
	}
	return tx.Commit()
}

// GetSECFilings returns cached filings for a symbol, optionally filtered by form type.
func (s *Store) GetSECFilings(symbol, formType string, limit int) ([]SECFiling, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT symbol, cik, form_type, filing_date, accepted_date, link, final_link FROM sec_filings WHERE symbol = ?`
	args := []interface{}{symbol}
	if formType != "" {
		query += ` AND form_type = ?`
		args = append(args, formType)
	}
	query += ` ORDER BY filing_date DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filings []SECFiling
	for rows.Next() {
		var f SECFiling
		if err := rows.Scan(&f.Symbol, &f.CIK, &f.FormType, &f.FilingDate, &f.AcceptedDate, &f.Link, &f.FinalLink); err != nil {
			continue
		}
		filings = append(filings, f)
	}
	return filings, nil
}

// IsSECFresh checks if we have filings cached recently enough.
func (s *Store) IsSECFresh(symbol string, maxAge time.Duration) bool {
	var fetchedAt time.Time
	err := s.db.QueryRow(`SELECT MAX(fetched_at) FROM sec_filings WHERE symbol = ?`, symbol).Scan(&fetchedAt)
	if err != nil {
		return false
	}
	return time.Since(fetchedAt) < maxAge
}

// GetUnprocessedSECFilings returns filings that have not yet had key-people extraction attempted.
// Use this so we don't repeatedly LLM-process 8-Ks that contained no personnel changes.
func (s *Store) GetUnprocessedSECFilings(symbol, formType string, limit int) ([]SECFiling, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT symbol, cik, form_type, filing_date, accepted_date, link, final_link FROM sec_filings WHERE symbol = ? AND processed_for_people = 0`
	args := []interface{}{symbol}
	if formType != "" {
		query += ` AND form_type = ?`
		args = append(args, formType)
	}
	query += ` ORDER BY filing_date DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filings []SECFiling
	for rows.Next() {
		var f SECFiling
		if err := rows.Scan(&f.Symbol, &f.CIK, &f.FormType, &f.FilingDate, &f.AcceptedDate, &f.Link, &f.FinalLink); err != nil {
			continue
		}
		filings = append(filings, f)
	}
	return filings, nil
}

// MarkSECFilingProcessedForPeople flags a filing as having been considered for key-people
// extraction (regardless of whether any people were actually found in it).
func (s *Store) MarkSECFilingProcessedForPeople(symbol, link string) error {
	_, err := s.db.Exec(`UPDATE sec_filings SET processed_for_people = 1 WHERE symbol = ? AND link = ?`, symbol, link)
	return err
}

// GetSECFormTypes returns all tracked SEC form type definitions.
func (s *Store) GetSECFormTypes() ([]SECFormType, error) {
	rows, err := s.db.Query(`SELECT form_type, title, purpose, timing, category FROM sec_form_types ORDER BY form_type`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var types []SECFormType
	for rows.Next() {
		var t SECFormType
		if err := rows.Scan(&t.FormType, &t.Title, &t.Purpose, &t.Timing, &t.Category); err != nil {
			continue
		}
		types = append(types, t)
	}
	return types, nil
}

// PutKeyPerson inserts a key person record.
func (s *Store) PutKeyPerson(kp KeyPerson) error {
	current := 0
	if kp.IsCurrent {
		current = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO key_people (symbol, name, title, event_type, event_date, source, is_current, as_of_date, form_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		kp.Symbol, kp.Name, kp.Title, kp.EventType, kp.EventDate, kp.Source, current, kp.AsOfDate, kp.FormType)
	return err
}

// ReplaceCurrentKeyPeople atomically swaps the current-leadership snapshot for a
// symbol+formType — older snapshot rows from the same form are deleted before
// inserting the new ones. Event rows (is_current=0) are untouched.
func (s *Store) ReplaceCurrentKeyPeople(symbol, formType string, people []KeyPerson) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM key_people WHERE symbol = ? AND form_type = ? AND is_current = 1`, symbol, formType); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO key_people (symbol, name, title, event_type, event_date, source, is_current, as_of_date, form_type) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, p := range people {
		if _, err := stmt.Exec(p.Symbol, p.Name, p.Title, p.EventType, p.EventDate, p.Source, p.AsOfDate, formType); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetKeyPeople returns all key people rows for a symbol — both current snapshot
// rows (is_current=1) and historical events (is_current=0). Caller separates by
// inspecting IsCurrent.
func (s *Store) GetKeyPeople(symbol string) ([]KeyPerson, error) {
	rows, err := s.db.Query(`SELECT symbol, name, title, event_type, event_date, source, is_current, COALESCE(as_of_date, ''), COALESCE(form_type, '') FROM key_people WHERE symbol = ? ORDER BY is_current DESC, event_date DESC`, symbol)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var people []KeyPerson
	for rows.Next() {
		var p KeyPerson
		var isCurrent int
		if err := rows.Scan(&p.Symbol, &p.Name, &p.Title, &p.EventType, &p.EventDate, &p.Source, &isCurrent, &p.AsOfDate, &p.FormType); err != nil {
			continue
		}
		p.IsCurrent = isCurrent == 1
		people = append(people, p)
	}
	return people, nil
}

// ── Ideas Sketchpad ──────────────────────────────────────────────────────────

// SketchMetric is one series in a sketch — a metric to plot alongside others.
type SketchMetric struct {
	ID         int64  `json:"id"`
	SketchID   int64  `json:"sketchId"`
	Kind       string `json:"kind"`       // 'price' | 'financial' | 'commodity' | 'forex' | 'crypto' | 'index'
	Identifier string `json:"identifier"` // 'AAPL' | 'AAPL.revenue' | 'GCUSD' | 'EURUSD' | 'BTCUSD' | 'SPX'
	Label      string `json:"label"`
	Color      string `json:"color"`
	Position   int    `json:"position"`
}

// Sketch is a saved comparison chart — a named bag of metrics owned by a user.
type Sketch struct {
	ID        int64          `json:"id"`
	OwnerID   int64          `json:"ownerId"`
	Name      string         `json:"name"`
	Notes     string         `json:"notes"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	Metrics   []SketchMetric `json:"metrics"`
}

// CreateSketch inserts a new sketch (typically empty) and returns its id.
func (s *Store) CreateSketch(ownerID int64, name string) (int64, error) {
	if ownerID == 0 {
		ownerID = 1
	}
	res, err := s.db.Exec(`INSERT INTO sketches (owner_id, name) VALUES (?, ?)`, ownerID, name)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// RenameSketch updates an existing sketch's name and bumps updated_at.
func (s *Store) RenameSketch(id int64, name string) error {
	_, err := s.db.Exec(`UPDATE sketches SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, name, id)
	return err
}

// UpdateSketchNotes saves the free-text notes panel for a sketch.
func (s *Store) UpdateSketchNotes(id int64, notes string) error {
	_, err := s.db.Exec(`UPDATE sketches SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, notes, id)
	return err
}

// DeleteSketch removes a sketch and (cascade) its metrics.
func (s *Store) DeleteSketch(id int64) error {
	_, err := s.db.Exec(`DELETE FROM sketches WHERE id = ?`, id)
	return err
}

// ListSketches returns all sketches for an owner, newest first.
func (s *Store) ListSketches(ownerID int64) ([]Sketch, error) {
	if ownerID == 0 {
		ownerID = 1
	}
	rows, err := s.db.Query(`SELECT id, owner_id, name, COALESCE(notes, ''), created_at, updated_at FROM sketches WHERE owner_id = ? ORDER BY updated_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Sketch
	for rows.Next() {
		var sk Sketch
		if err := rows.Scan(&sk.ID, &sk.OwnerID, &sk.Name, &sk.Notes, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
			continue
		}
		out = append(out, sk)
	}
	return out, nil
}

// GetSketch returns a single sketch with its metrics in position order.
func (s *Store) GetSketch(id int64) (*Sketch, error) {
	row := s.db.QueryRow(`SELECT id, owner_id, name, COALESCE(notes, ''), created_at, updated_at FROM sketches WHERE id = ?`, id)
	var sk Sketch
	if err := row.Scan(&sk.ID, &sk.OwnerID, &sk.Name, &sk.Notes, &sk.CreatedAt, &sk.UpdatedAt); err != nil {
		return nil, err
	}
	mrows, err := s.db.Query(`SELECT id, sketch_id, kind, identifier, label, color, position FROM sketch_metrics WHERE sketch_id = ? ORDER BY position ASC, id ASC`, id)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var m SketchMetric
		if err := mrows.Scan(&m.ID, &m.SketchID, &m.Kind, &m.Identifier, &m.Label, &m.Color, &m.Position); err == nil {
			sk.Metrics = append(sk.Metrics, m)
		}
	}
	return &sk, nil
}

// AddSketchMetric appends a metric to a sketch. Position defaults to current count.
func (s *Store) AddSketchMetric(m SketchMetric) (int64, error) {
	if m.Position == 0 {
		var n int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM sketch_metrics WHERE sketch_id = ?`, m.SketchID).Scan(&n)
		m.Position = n
	}
	res, err := s.db.Exec(
		`INSERT INTO sketch_metrics (sketch_id, kind, identifier, label, color, position) VALUES (?, ?, ?, ?, ?, ?)`,
		m.SketchID, m.Kind, m.Identifier, m.Label, m.Color, m.Position,
	)
	if err != nil {
		return 0, err
	}
	_, _ = s.db.Exec(`UPDATE sketches SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, m.SketchID)
	return res.LastInsertId()
}

// RemoveSketchMetric drops a metric row by id.
func (s *Store) RemoveSketchMetric(id int64) error {
	_, err := s.db.Exec(`DELETE FROM sketch_metrics WHERE id = ?`, id)
	return err
}

// EconomicObservation is one (date, value) point on an economic series.
// Mirrors fred.Observation so the store package stays independent of the
// FRED client.
type EconomicObservation struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// EconomicSeries is the persisted row for one indicator.
type EconomicSeries struct {
	Code            string                `json:"code"`
	Title           string                `json:"title"`
	Category        string                `json:"category"`
	Frequency       string                `json:"frequency"`
	Units           string                `json:"units"`
	Observations    []EconomicObservation `json:"observations"`
	SourceUpdatedAt string                `json:"sourceUpdatedAt"`
	FetchedAt       time.Time             `json:"fetchedAt"`
}

// PutEconomicSeries upserts a series row. Observations are stored as JSON in
// ascending date order so the chart layer can stream straight through.
func (s *Store) PutEconomicSeries(es *EconomicSeries) error {
	obs, err := json.Marshal(es.Observations)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO economic_series
			(code, title, category, frequency, units, observations, source_updated_at, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(code) DO UPDATE SET
			title             = excluded.title,
			category          = excluded.category,
			frequency         = excluded.frequency,
			units             = excluded.units,
			observations      = excluded.observations,
			source_updated_at = excluded.source_updated_at,
			fetched_at        = CURRENT_TIMESTAMP
	`, es.Code, es.Title, es.Category, es.Frequency, es.Units, string(obs), es.SourceUpdatedAt)
	return err
}

// GetEconomicSeries returns a series by code, or nil if not cached.
func (s *Store) GetEconomicSeries(code string) (*EconomicSeries, error) {
	row := s.db.QueryRow(`
		SELECT code, title, category, frequency, units, observations, source_updated_at, fetched_at
		FROM economic_series WHERE code = ?
	`, code)
	var es EconomicSeries
	var obsJSON, fetchedAt string
	err := row.Scan(&es.Code, &es.Title, &es.Category, &es.Frequency, &es.Units, &obsJSON, &es.SourceUpdatedAt, &fetchedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(obsJSON), &es.Observations); err != nil {
		return nil, err
	}
	es.FetchedAt, _ = time.Parse("2006-01-02 15:04:05Z", fetchedAt+"Z")
	return &es, nil
}

// IsEconomicFresh returns true if the cached series is younger than ttl.
func (s *Store) IsEconomicFresh(code string, ttl time.Duration) bool {
	var fetchedAt string
	err := s.db.QueryRow(`SELECT fetched_at FROM economic_series WHERE code = ?`, code).Scan(&fetchedAt)
	if err != nil {
		return false
	}
	t, err := time.Parse("2006-01-02 15:04:05Z", fetchedAt+"Z")
	if err != nil {
		return false
	}
	return time.Since(t) < ttl
}
