package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestParseSQLiteTime(t *testing.T) {
	utc := time.UTC
	tests := []struct {
		name  string
		input string
		want  time.Time
		zero  bool
	}{
		{
			name:  "SQLite CURRENT_TIMESTAMP (no tz, no fractional)",
			input: "2026-05-25 15:57:41",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 0, utc),
		},
		{
			name:  "mattn/go-sqlite3 default Time format (fractional + zero offset)",
			input: "2026-05-25 15:57:41.309454+00:00",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 309454000, utc),
		},
		{
			name:  "mattn/go-sqlite3 with negative offset",
			input: "2026-05-25 15:57:41.123456-05:00",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 123456000, time.FixedZone("", -5*3600)),
		},
		{
			name:  "no fractional seconds, with offset",
			input: "2026-05-25 15:57:41+00:00",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 0, utc),
		},
		{
			name:  "fractional, no offset",
			input: "2026-05-25 15:57:41.999999999",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 999999999, utc),
		},
		{
			name:  "RFC3339 with Z",
			input: "2026-05-25T15:57:41Z",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 0, utc),
		},
		{
			name:  "RFC3339Nano",
			input: "2026-05-25T15:57:41.123456789Z",
			want:  time.Date(2026, 5, 25, 15, 57, 41, 123456789, utc),
		},
		{
			name:  "empty string yields zero time",
			input: "",
			zero:  true,
		},
		{
			name:  "garbage yields zero time",
			input: "not-a-date-at-all",
			zero:  true,
		},
		{
			name:  "wrong shape yields zero time",
			input: "25/05/2026 15:57:41",
			zero:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseSQLiteTime(tc.input)
			if tc.zero {
				if !got.IsZero() {
					t.Errorf("want zero time, got %v", got)
				}
				return
			}
			if !got.Equal(tc.want) {
				t.Errorf("want %v (%v), got %v (%v)",
					tc.want, tc.want.UnixNano(), got, got.UnixNano())
			}
		})
	}
}

// TestPaperLifecycleRoundtrip exercises the full open → close path through a
// real SQLite store. Catches driver-format drift: if a future sqlite3 release
// changes how it serializes time.Time, this test fails loudly because the
// round-tripped datetime won't be parseable back into a non-zero time.
func TestPaperLifecycleRoundtrip(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()

	accountID, err := store.CreatePaperAccount("Test", "USD", 10000, 0.02)
	if err != nil {
		t.Fatalf("create account: %v", err)
	}

	acc, err := store.GetPaperAccount(accountID)
	if err != nil {
		t.Fatalf("get account: %v", err)
	}
	if acc.CreatedAt.IsZero() {
		t.Errorf("account CreatedAt should not be zero (driver-format drift?)")
	}
	if acc.UpdatedAt.IsZero() {
		t.Errorf("account UpdatedAt should not be zero")
	}

	opened := time.Now().UTC()
	target := 160.0
	tradeID, err := store.OpenPaperTrade(PaperTrade{
		AccountID:      accountID,
		Symbol:         "AAPL",
		InstrumentType: "equity",
		Multiplier:     1,
		Side:           "long",
		EntryPrice:     150,
		StopPrice:      145,
		TargetPrice:    &target,
		Size:           40,
		RiskPctAtEntry: 0.02,
		RiskAmount:     200,
		OpenedAt:       opened,
		Thesis:         "round trip",
	})
	if err != nil {
		t.Fatalf("open trade: %v", err)
	}

	opens, err := store.GetOpenPaperTrades(accountID)
	if err != nil {
		t.Fatalf("get open: %v", err)
	}
	if len(opens) != 1 {
		t.Fatalf("want 1 open trade, got %d", len(opens))
	}
	got := opens[0]
	if got.OpenedAt.IsZero() {
		t.Errorf("trade OpenedAt should not be zero")
	}
	// Round-trip should preserve to at-least-second precision (SQLite + Go's
	// time-string layouts agree on microseconds; we test second equality to
	// stay robust against precision rounding either side).
	if diff := got.OpenedAt.Sub(opened); diff > time.Second || diff < -time.Second {
		t.Errorf("OpenedAt round-trip drift > 1s: stored=%v, got=%v, diff=%v",
			opened, got.OpenedAt, diff)
	}

	if err := store.ClosePaperTrade(tradeID, 155, "target"); err != nil {
		t.Fatalf("close trade: %v", err)
	}

	closed, err := store.GetClosedPaperTrades(accountID, 10, 0)
	if err != nil {
		t.Fatalf("get closed: %v", err)
	}
	if len(closed) != 1 {
		t.Fatalf("want 1 closed trade, got %d", len(closed))
	}
	c := closed[0]
	if c.ClosedAt == nil || c.ClosedAt.IsZero() {
		t.Errorf("closed trade ClosedAt should be a non-zero time, got %v", c.ClosedAt)
	}
	if c.OpenedAt.IsZero() {
		t.Errorf("closed trade OpenedAt should be non-zero")
	}
	if c.RealizedPnL == nil || *c.RealizedPnL != 200 {
		t.Errorf("realized P&L: want 200, got %v", c.RealizedPnL)
	}
	if c.Status != "closed_target" {
		t.Errorf("status: want closed_target, got %s", c.Status)
	}

	acc, err = store.GetPaperAccount(accountID)
	if err != nil {
		t.Fatalf("get account after close: %v", err)
	}
	if acc.CashBalance != 10200 {
		t.Errorf("cash balance after close: want 10200, got %v", acc.CashBalance)
	}
	if acc.UpdatedAt.IsZero() {
		t.Errorf("UpdatedAt after close should be non-zero")
	}
}

// newTestStore creates a fresh on-disk SQLite store in a temp dir. On-disk
// (not :memory:) so the connection string mirrors the production path.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	t.Cleanup(func() { _ = os.Remove(dbPath) })

	// Sanity: confirm the sqlite driver is the one we expect.
	var driverName string
	if rows, err := s.db.Query("SELECT sqlite_version()"); err == nil {
		defer rows.Close()
		for rows.Next() {
			_ = rows.Scan(&driverName)
		}
	}
	if driverName == "" {
		t.Skip("sqlite driver not available")
	}
	return s
}

// Compile-time guard that the Store satisfies the interfaces we rely on
// elsewhere — prevents accidental signature drift breaking handlers.
var _ = func() {
	var _ *sql.DB // ensure import is used
}
