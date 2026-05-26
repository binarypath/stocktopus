package server

import "testing"

func TestCompanyPrefix(t *testing.T) {
	tests := []struct {
		name       string
		kind       string
		identifier string
		want       string
	}{
		{"price equity", "price", "AAPL", "AAPL"},
		{"price equity lowercase normalises", "price", "aapl", "AAPL"},
		{"price equity with whitespace", "price", "  AAPL  ", "AAPL"},
		{"financial standard", "financial", "AAPL.revenue", "AAPL"},
		{"financial preserves dot ticker", "financial", "BRK.A.revenue", "BRK.A"},
		{"financial preserves L-suffix ticker", "financial", "GOOG.L.ebitda", "GOOG.L"},
		{"financial without field is rejected", "financial", "AAPL", ""},
		{"financial trailing dot is rejected", "financial", "AAPL.", ""},
		{"financial leading dot is rejected", "financial", ".revenue", ""},
		{"commodity has no company", "commodity", "GCUSD", ""},
		{"forex has no company", "forex", "EURUSD", ""},
		{"crypto has no company", "crypto", "BTCUSD", ""},
		{"index has no company", "index", "SPX", ""},
		{"economic has no company", "economic", "US.FEDFUNDS", ""},
		{"empty identifier", "price", "", ""},
		{"unknown kind", "wat", "AAPL", ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := companyPrefix(tc.kind, tc.identifier)
			if got != tc.want {
				t.Errorf("companyPrefix(%q, %q) = %q, want %q",
					tc.kind, tc.identifier, got, tc.want)
			}
		})
	}
}
