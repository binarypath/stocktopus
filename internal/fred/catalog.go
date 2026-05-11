package fred

// Curated catalog — the ~30 indicators surfaced on /economics and acceptable as
// `:add <code>` on sketches. Categories mirror Bloomberg's ECST buckets.
//
// Frequencies determine cache TTLs (see ttl.go). Keep the catalog small —
// users who want anything else can extend it later, and FRED's 800k-series
// universe is a search problem, not a curation problem.

// CatalogEntry is one curated indicator. The user-facing handle is
// `{Country}.{Code}` (e.g. US.UNRATE) so v2 can add EZ.HICP / UK.CPI /
// BUBA.X without colliding. Country is ISO 3166-1 alpha-2 (special-case "EZ"
// for the Eurozone aggregate).
type CatalogEntry struct {
	Country     string `json:"country"`     // ISO-2 (US, EZ, UK, …)
	Code        string `json:"code"`        // FRED series ID — also the suffix of the public handle
	Provider    string `json:"provider"`    // Data source label, e.g. "FRED · Federal Reserve". Surfaced on the drill-down screen.
	CentralBank string `json:"centralBank"` // Human label for the central bank list ("Federal Reserve (United States)")
	Name        string `json:"name"`        // Human label for the legend ("U.S. Unemployment Rate")
	Category    string `json:"category"`    // Rates · Inflation · Growth · Labor · Housing · Consumer · Trade
	Frequency   string `json:"frequency"`   // D / W / M / Q / A — informational; client also stores what FRED reports
	Units       string `json:"units"`       // Short units ("%", "Index", "$bn")
}

// Identifier returns the public handle "Country.Code" (e.g. "US.UNRATE").
func (e CatalogEntry) Identifier() string { return e.Country + "." + e.Code }

// usEntry is a tiny shim so the catalog reads cleanly — every row in v1 is
// Federal Reserve / United States, so we factor that boilerplate out.
func usEntry(code, name, category, freq, units string) CatalogEntry {
	return CatalogEntry{
		Country:     "US",
		Code:        code,
		Provider:    "FRED",
		CentralBank: "Federal Reserve (United States)",
		Name:        name,
		Category:    category,
		Frequency:   freq,
		Units:       units,
	}
}

var Catalog = []CatalogEntry{
	// Rates & Monetary
	usEntry("FEDFUNDS", "Federal Funds Effective Rate", "Rates", "M", "%"),
	usEntry("DFF", "Federal Funds Rate (Daily)", "Rates", "D", "%"),
	usEntry("DGS10", "10-Year Treasury Constant Maturity", "Rates", "D", "%"),
	usEntry("DGS2", "2-Year Treasury Constant Maturity", "Rates", "D", "%"),
	usEntry("T10Y2Y", "10Y–2Y Treasury Spread", "Rates", "D", "%"),
	usEntry("SOFR", "Secured Overnight Financing Rate", "Rates", "D", "%"),
	usEntry("WALCL", "Fed Balance Sheet (Total Assets)", "Rates", "W", "$M"),
	usEntry("M2SL", "M2 Money Supply", "Rates", "M", "$B"),

	// Inflation
	usEntry("CPIAUCSL", "Consumer Price Index (All Items)", "Inflation", "M", "Index"),
	usEntry("CPILFESL", "Core CPI (Less Food & Energy)", "Inflation", "M", "Index"),
	usEntry("PCEPI", "PCE Price Index", "Inflation", "M", "Index"),
	usEntry("PCEPILFE", "Core PCE Price Index", "Inflation", "M", "Index"),
	usEntry("PPIACO", "Producer Price Index (All Commodities)", "Inflation", "M", "Index"),
	usEntry("T5YIE", "5-Year Breakeven Inflation Rate", "Inflation", "D", "%"),

	// Growth
	usEntry("GDPC1", "Real GDP", "Growth", "Q", "$B"),
	usEntry("GDP", "Nominal GDP", "Growth", "Q", "$B"),
	usEntry("INDPRO", "Industrial Production Index", "Growth", "M", "Index"),
	usEntry("RSAFS", "Retail Sales (Advance)", "Growth", "M", "$M"),
	usEntry("USSLIND", "Leading Index for the United States", "Growth", "M", "%"),

	// Labor
	usEntry("UNRATE", "Unemployment Rate", "Labor", "M", "%"),
	usEntry("PAYEMS", "Total Nonfarm Payrolls", "Labor", "M", "Thousands"),
	usEntry("ICSA", "Initial Jobless Claims", "Labor", "W", "Persons"),
	usEntry("CIVPART", "Labor Force Participation Rate", "Labor", "M", "%"),
	usEntry("AHETPI", "Average Hourly Earnings (Production)", "Labor", "M", "$"),

	// Housing
	usEntry("HOUST", "Housing Starts", "Housing", "M", "Thousands"),
	usEntry("PERMIT", "Building Permits", "Housing", "M", "Thousands"),
	usEntry("MORTGAGE30US", "30-Year Fixed Mortgage Rate", "Housing", "W", "%"),
	usEntry("CSUSHPISA", "S&P/Case-Shiller U.S. National HPI", "Housing", "M", "Index"),

	// Consumer
	usEntry("UMCSENT", "U. Michigan Consumer Sentiment", "Consumer", "M", "Index"),
	usEntry("PSAVERT", "Personal Saving Rate", "Consumer", "M", "%"),
	usEntry("PCE", "Personal Consumption Expenditures", "Consumer", "M", "$B"),

	// Trade
	usEntry("BOPGSTB", "Trade Balance: Goods and Services", "Trade", "M", "$M"),
	usEntry("DTWEXBGS", "Trade-Weighted Dollar Index (Broad)", "Trade", "D", "Index"),
}

// CentralBank is one row on the catalog's drill-down screen.
type CentralBank struct {
	Country     string `json:"country"`     // ISO-2
	Code        string `json:"code"`        // CentralBank code: "FRED" / "ECB" / "BOE" / "BUBA" — used in URLs
	Name        string `json:"name"`        // Human-readable, "Federal Reserve (United States)"
	Description string `json:"description"` // Optional one-liner shown next to the row
	Indicators  int    `json:"indicators"`  // Number of curated indicators
}

// CentralBanks returns the deduplicated list of central banks covered by the
// catalog, sorted by name. Used by the drill-down screen.
func CentralBanks() []CentralBank {
	seen := map[string]*CentralBank{}
	order := []string{}
	for i := range Catalog {
		e := &Catalog[i]
		key := e.Country + "/" + e.Provider
		cb, ok := seen[key]
		if !ok {
			cb = &CentralBank{
				Country: e.Country,
				Code:    e.Provider,
				Name:    e.CentralBank,
			}
			seen[key] = cb
			order = append(order, key)
		}
		cb.Indicators++
	}
	out := make([]CentralBank, 0, len(order))
	for _, k := range order {
		out = append(out, *seen[k])
	}
	return out
}

// IndicatorsByCountry returns the catalog filtered to a single country (ISO-2).
func IndicatorsByCountry(country string) []CatalogEntry {
	out := make([]CatalogEntry, 0, len(Catalog))
	for _, e := range Catalog {
		if equalFold(e.Country, country) {
			out = append(out, e)
		}
	}
	return out
}

// LookupCatalog returns the curated entry for an identifier. Accepts either
// the full "COUNTRY.CODE" handle (US.UNRATE) or a bare code (UNRATE) — the
// bare form is a v1 convenience that resolves to the first matching entry,
// since we only have one country for now.
func LookupCatalog(identifier string) *CatalogEntry {
	country, code := SplitIdentifier(identifier)
	for i := range Catalog {
		if !equalFold(Catalog[i].Code, code) {
			continue
		}
		if country == "" || equalFold(Catalog[i].Country, country) {
			return &Catalog[i]
		}
	}
	return nil
}

// SplitIdentifier splits "US.UNRATE" into ("US", "UNRATE"). If there's no
// dot, country is empty and the whole string is treated as a code.
func SplitIdentifier(identifier string) (country, code string) {
	for i := 0; i < len(identifier); i++ {
		if identifier[i] == '.' {
			return identifier[:i], identifier[i+1:]
		}
	}
	return "", identifier
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
