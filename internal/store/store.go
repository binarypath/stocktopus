package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
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
	`)
	if err != nil {
		return err
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

// KeyPerson represents an executive or board member change.
type KeyPerson struct {
	Symbol    string `json:"symbol"`
	Name      string `json:"name"`
	Title     string `json:"title"`
	EventType string `json:"eventType"`
	EventDate string `json:"eventDate"`
	Source    string `json:"source"`
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
	_, err := s.db.Exec(`INSERT INTO key_people (symbol, name, title, event_type, event_date, source) VALUES (?, ?, ?, ?, ?, ?)`,
		kp.Symbol, kp.Name, kp.Title, kp.EventType, kp.EventDate, kp.Source)
	return err
}

// GetKeyPeople returns key people events for a symbol.
func (s *Store) GetKeyPeople(symbol string) ([]KeyPerson, error) {
	rows, err := s.db.Query(`SELECT symbol, name, title, event_type, event_date, source FROM key_people WHERE symbol = ? ORDER BY event_date DESC`, symbol)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var people []KeyPerson
	for rows.Next() {
		var p KeyPerson
		if err := rows.Scan(&p.Symbol, &p.Name, &p.Title, &p.EventType, &p.EventDate, &p.Source); err != nil {
			continue
		}
		people = append(people, p)
	}
	return people, nil
}
