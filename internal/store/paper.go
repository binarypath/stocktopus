package store

import (
	"database/sql"
	"fmt"
	"time"
)

// PaperAccount mirrors the paper_accounts row.
type PaperAccount struct {
	ID              int64     `json:"id"`
	Name            string    `json:"name"`
	BaseCurrency    string    `json:"baseCurrency"`
	StartingBalance float64   `json:"startingBalance"`
	CashBalance     float64   `json:"cashBalance"`
	RiskPct         float64   `json:"riskPct"`
	Settled         bool      `json:"settled"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// PaperTrade mirrors the paper_trades row. Nullable columns surface as pointers
// so JSON marshalling sends null rather than zero-value lies.
type PaperTrade struct {
	ID              int64      `json:"id"`
	AccountID       int64      `json:"accountId"`
	SketchID        *int64     `json:"sketchId,omitempty"`
	Symbol          string     `json:"symbol"`
	InstrumentType  string     `json:"instrumentType"`
	Multiplier      float64    `json:"multiplier"`
	Side            string     `json:"side"`
	EntryPrice      float64    `json:"entryPrice"`
	StopPrice       float64    `json:"stopPrice"`
	TargetPrice     *float64   `json:"targetPrice,omitempty"`
	Size            float64    `json:"size"`
	RiskPctAtEntry  float64    `json:"riskPctAtEntry"`
	RiskAmount      float64    `json:"riskAmount"`
	Status          string     `json:"status"`
	OpenedAt        time.Time  `json:"openedAt"`
	ClosedAt        *time.Time `json:"closedAt,omitempty"`
	ExitPrice       *float64   `json:"exitPrice,omitempty"`
	RealizedPnL     *float64   `json:"realizedPnl,omitempty"`
	Thesis          string     `json:"thesis"`
	Notes           string     `json:"notes"`
}

// CreatePaperAccount inserts a new account and returns its id.
func (s *Store) CreatePaperAccount(name, currency string, startingBalance, riskPct float64) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO paper_accounts (name, base_currency, starting_balance, cash_balance, risk_pct)
		VALUES (?, ?, ?, ?, ?)`,
		name, currency, startingBalance, startingBalance, riskPct)
	if err != nil {
		return 0, fmt.Errorf("insert paper_account: %w", err)
	}
	return res.LastInsertId()
}

// GetPaperAccounts returns every account, newest first.
func (s *Store) GetPaperAccounts() ([]PaperAccount, error) {
	rows, err := s.db.Query(`
		SELECT id, name, base_currency, starting_balance, cash_balance,
		       risk_pct, settled, created_at, updated_at
		FROM paper_accounts ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PaperAccount
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetPaperAccount returns one account or sql.ErrNoRows.
func (s *Store) GetPaperAccount(id int64) (*PaperAccount, error) {
	row := s.db.QueryRow(`
		SELECT id, name, base_currency, starting_balance, cash_balance,
		       risk_pct, settled, created_at, updated_at
		FROM paper_accounts WHERE id = ?`, id)
	a, err := scanAccount(row)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// SetPaperAccountRisk updates the risk_pct. Used by the manual settle flip
// (2% → 1%) but also any ad-hoc adjustment.
func (s *Store) SetPaperAccountRisk(id int64, riskPct float64) error {
	_, err := s.db.Exec(`
		UPDATE paper_accounts SET risk_pct = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`, riskPct, id)
	return err
}

// SetPaperAccountSettled flips the settled flag.
func (s *Store) SetPaperAccountSettled(id int64, settled bool) error {
	v := 0
	if settled {
		v = 1
	}
	_, err := s.db.Exec(`
		UPDATE paper_accounts SET settled = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`, v, id)
	return err
}

// OpenPaperTrade inserts the trade row and an 'opened' event in a single txn.
// Caller has already done sizing math; we just persist.
func (s *Store) OpenPaperTrade(t PaperTrade) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO paper_trades (
			account_id, sketch_id, symbol, instrument_type, multiplier, side,
			entry_price, stop_price, target_price, size,
			risk_pct_at_entry, risk_amount, status, opened_at, thesis, notes
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
		t.AccountID, t.SketchID, t.Symbol, t.InstrumentType, t.Multiplier, t.Side,
		t.EntryPrice, t.StopPrice, t.TargetPrice, t.Size,
		t.RiskPctAtEntry, t.RiskAmount, t.OpenedAt.UTC(), t.Thesis, t.Notes,
	)
	if err != nil {
		return 0, fmt.Errorf("insert paper_trade: %w", err)
	}
	tradeID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	if _, err := tx.Exec(`
		INSERT INTO paper_trade_events (trade_id, event_type, payload)
		VALUES (?, 'opened', ?)`,
		tradeID, fmt.Sprintf(`{"entry":%g,"stop":%g,"size":%g}`, t.EntryPrice, t.StopPrice, t.Size),
	); err != nil {
		return 0, fmt.Errorf("insert opened event: %w", err)
	}

	return tradeID, tx.Commit()
}

// GetOpenPaperTrades returns open positions for the account.
func (s *Store) GetOpenPaperTrades(accountID int64) ([]PaperTrade, error) {
	return s.queryPaperTrades(`
		WHERE account_id = ? AND status = 'open'
		ORDER BY opened_at DESC`, accountID)
}

// GetClosedPaperTrades returns closed positions for the journal view.
func (s *Store) GetClosedPaperTrades(accountID int64, limit, offset int) ([]PaperTrade, error) {
	if limit <= 0 {
		limit = 100
	}
	return s.queryPaperTrades(`
		WHERE account_id = ? AND status != 'open'
		ORDER BY closed_at DESC LIMIT `+fmt.Sprintf("%d OFFSET %d", limit, offset),
		accountID)
}

// ClosePaperTrade marks the trade closed, writes realized P&L, records event.
// reason is one of: 'stop' | 'target' | 'manual'.
func (s *Store) ClosePaperTrade(tradeID int64, exitPrice float64, reason string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	trade, err := s.scanOnePaperTradeTx(tx, tradeID)
	if err != nil {
		return err
	}
	if trade.Status != "open" {
		return fmt.Errorf("trade %d is not open", tradeID)
	}

	pnl := realizedPnL(trade, exitPrice)
	statusByReason := map[string]string{
		"stop":   "closed_stop",
		"target": "closed_target",
		"manual": "closed_manual",
	}
	status, ok := statusByReason[reason]
	if !ok {
		return fmt.Errorf("unknown close reason %q", reason)
	}

	if _, err := tx.Exec(`
		UPDATE paper_trades
		SET status = ?, closed_at = ?, exit_price = ?, realized_pnl = ?
		WHERE id = ?`,
		status, time.Now().UTC(), exitPrice, pnl, tradeID,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(`
		UPDATE paper_accounts SET cash_balance = cash_balance + ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`, pnl, trade.AccountID); err != nil {
		return err
	}

	if _, err := tx.Exec(`
		INSERT INTO paper_trade_events (trade_id, event_type, payload)
		VALUES (?, 'closed', ?)`,
		tradeID, fmt.Sprintf(`{"exit":%g,"pnl":%g,"reason":%q}`, exitPrice, pnl, reason),
	); err != nil {
		return err
	}

	return tx.Commit()
}

// realizedPnL = (exit - entry) × size × multiplier × (+1 long / -1 short)
func realizedPnL(t PaperTrade, exit float64) float64 {
	dir := 1.0
	if t.Side == "short" {
		dir = -1
	}
	return (exit - t.EntryPrice) * t.Size * t.Multiplier * dir
}

// --- internals ----------------------------------------------------------

func (s *Store) queryPaperTrades(whereClause string, args ...any) ([]PaperTrade, error) {
	q := `SELECT id, account_id, sketch_id, symbol, instrument_type, multiplier, side,
	             entry_price, stop_price, target_price, size,
	             risk_pct_at_entry, risk_amount, status, opened_at, closed_at,
	             exit_price, realized_pnl, thesis, notes
	      FROM paper_trades ` + whereClause
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PaperTrade
	for rows.Next() {
		t, err := scanPaperTrade(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) scanOnePaperTradeTx(tx *sql.Tx, id int64) (PaperTrade, error) {
	row := tx.QueryRow(`
		SELECT id, account_id, sketch_id, symbol, instrument_type, multiplier, side,
		       entry_price, stop_price, target_price, size,
		       risk_pct_at_entry, risk_amount, status, opened_at, closed_at,
		       exit_price, realized_pnl, thesis, notes
		FROM paper_trades WHERE id = ?`, id)
	return scanPaperTrade(row)
}

// rowScanner is anything Scan-able (sql.Row or sql.Rows).
type rowScanner interface {
	Scan(dest ...any) error
}

func scanAccount(r rowScanner) (PaperAccount, error) {
	var a PaperAccount
	var settled int
	var createdAt, updatedAt string
	if err := r.Scan(&a.ID, &a.Name, &a.BaseCurrency, &a.StartingBalance,
		&a.CashBalance, &a.RiskPct, &settled, &createdAt, &updatedAt); err != nil {
		return a, err
	}
	a.Settled = settled != 0
	a.CreatedAt = parseSQLiteTime(createdAt)
	a.UpdatedAt = parseSQLiteTime(updatedAt)
	return a, nil
}

// parseSQLiteTime handles both SQLite's CURRENT_TIMESTAMP format
// ("2006-01-02 15:04:05") and the mattn/go-sqlite3 driver's time.Time
// serialization ("2006-01-02 15:04:05.999999999-07:00"), plus RFC3339 as a
// fallback. Returns zero time only if all attempts fail.
func parseSQLiteTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	layouts := []string{
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func scanPaperTrade(r rowScanner) (PaperTrade, error) {
	var t PaperTrade
	var sketchID sql.NullInt64
	var targetPrice, exitPrice, realizedPnL sql.NullFloat64
	var closedAt sql.NullString
	var openedAt string

	if err := r.Scan(
		&t.ID, &t.AccountID, &sketchID, &t.Symbol, &t.InstrumentType, &t.Multiplier, &t.Side,
		&t.EntryPrice, &t.StopPrice, &targetPrice, &t.Size,
		&t.RiskPctAtEntry, &t.RiskAmount, &t.Status, &openedAt, &closedAt,
		&exitPrice, &realizedPnL, &t.Thesis, &t.Notes,
	); err != nil {
		return t, err
	}
	if sketchID.Valid {
		t.SketchID = &sketchID.Int64
	}
	if targetPrice.Valid {
		t.TargetPrice = &targetPrice.Float64
	}
	if exitPrice.Valid {
		t.ExitPrice = &exitPrice.Float64
	}
	if realizedPnL.Valid {
		t.RealizedPnL = &realizedPnL.Float64
	}
	t.OpenedAt = parseSQLiteTime(openedAt)
	if closedAt.Valid {
		ct := parseSQLiteTime(closedAt.String)
		t.ClosedAt = &ct
	}
	return t, nil
}
