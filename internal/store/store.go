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
	`)
	return err
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
