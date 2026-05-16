// Package econ is the source-agnostic domain layer for economic indicators.
// It owns the curated catalog (Country.Code → human-friendly metadata) plus
// the routing token that points at the underlying provider — but consumers
// (server handlers, charting, sketchpad) only see the domain fields.
//
// Concrete provider clients (internal/fred, internal/dbnomics) are wired in
// at the seam where this package needs to fetch — kept out of the public
// surface so adding a new provider is a single dispatch-table addition,
// not a catalog schema bump.
package econ

import "strings"

// Observation is one (date, value) point. Dates are YYYY-MM-DD strings.
type Observation struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

// Series is the canonical, provider-neutral shape stored in the cache and
// returned to clients. Provider-specific titles / units get coalesced into
// these fields at fetch time.
type Series struct {
	Identifier   string        `json:"identifier"`
	Title        string        `json:"title"`
	Category     string        `json:"category"`
	Frequency    string        `json:"frequency"` // D/W/M/Q/A
	Units        string        `json:"units"`
	UpdatedAt    string        `json:"updatedAt"` // upstream's last-refresh timestamp
	Observations []Observation `json:"observations"`
}

// CatalogEntry is the public, domain-focused metadata for one indicator.
// The Route field is intentionally NOT JSON-serialised — it's a routing
// implementation detail (e.g. "fred:UNRATE" or "dbnomics:ECB/FM/...") that
// consumers must not depend on. Adding a new provider only requires
// extending the Route grammar + the dispatcher; nothing else.
type CatalogEntry struct {
	Country     string `json:"country"`     // ISO-2 ("US", "EZ", "UK", …)
	Code        string `json:"code"`        // user-facing code ("UNRATE", "HICP", …)
	Name        string `json:"name"`        // human label
	Category    string `json:"category"`    // Rates · Inflation · Growth · Labor · Housing · Consumer · Trade
	Frequency   string `json:"frequency"`   // D/W/M/Q/A
	Units       string `json:"units"`       // %, Index, $B, €B, …
	CentralBank string `json:"centralBank"` // "Federal Reserve (United States)", "European Central Bank", …

	// Route is opaque to consumers. Format: "source:opts".
	//   fred:CODE                  e.g. fred:UNRATE
	//   dbnomics:PROVIDER/DS/CODE  e.g. dbnomics:ECB/FM/D.U2.EUR.4F.KR.MRR_FR.LEV
	Route string `json:"-"`
}

// Identifier returns the public handle "Country.Code".
func (e CatalogEntry) Identifier() string { return e.Country + "." + e.Code }

// SplitIdentifier splits "US.UNRATE" into ("US", "UNRATE"). If there's no
// dot, country is empty and the whole string is the code.
func SplitIdentifier(identifier string) (country, code string) {
	if i := strings.IndexByte(identifier, '.'); i >= 0 {
		return identifier[:i], identifier[i+1:]
	}
	return "", identifier
}

// CentralBank is one row on the catalog drill-down screen.
type CentralBank struct {
	Country     string `json:"country"`
	Name        string `json:"name"`
	Indicators  int    `json:"indicators"`
}
