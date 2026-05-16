package econ

import "strings"

// Catalog is the single source of truth for which economic indicators
// stocktopus surfaces. Each entry routes via the opaque Route token to
// a concrete provider implementation, but consumers only see the
// domain fields.
//
// Conventions:
//   - Country: ISO-2 ("US"). "EZ" for the Eurozone aggregate; "UK", "DE",
//     "JP", "FR" for individual countries.
//   - Code: short, idiomatic. Mirrors FRED IDs where they exist (UNRATE,
//     CPIAUCSL). For DBnomics-sourced series we pick a short user-facing
//     handle (HICP, RATE) since the DBnomics path is unwieldy.
//   - Frequency: D/W/M/Q/A — the prefetcher uses this for TTL bucketing.

// usEntry is a shim — every US row is FRED-routed by the bare FRED code.
func usEntry(code, name, category, freq, units string) CatalogEntry {
	return CatalogEntry{
		Country:     "US",
		Code:        code,
		Name:        name,
		Category:    category,
		Frequency:   freq,
		Units:       units,
		CentralBank: "Federal Reserve (United States)",
		Route:       "fred:" + code,
	}
}

// ezEntry is the corresponding shim for Eurozone via ECB on DBnomics.
// dbPath is the DBnomics "PROVIDER/DATASET/SERIES" path.
func ezEntry(code, name, category, freq, units, dbPath string) CatalogEntry {
	return CatalogEntry{
		Country:     "EZ",
		Code:        code,
		Name:        name,
		Category:    category,
		Frequency:   freq,
		Units:       units,
		CentralBank: "European Central Bank",
		Route:       "dbnomics:" + dbPath,
	}
}

var Catalog = []CatalogEntry{
	// ── United States · Federal Reserve / FRED ──
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

	// ── Eurozone · European Central Bank / DBnomics ──
	// Rates & Monetary
	ezEntry("RATE", "ECB Main Refinancing Rate", "Rates", "D", "%",
		"ECB/FM/D.U2.EUR.4F.KR.MRR_FR.LEV"),
	ezEntry("DEPRATE", "ECB Deposit Facility Rate", "Rates", "D", "%",
		"ECB/FM/D.U2.EUR.4F.KR.DFR.LEV"),
	ezEntry("MLFRATE", "ECB Marginal Lending Facility Rate", "Rates", "D", "%",
		"ECB/FM/D.U2.EUR.4F.KR.MLFR.LEV"),
	ezEntry("10Y", "Euro Area Long-Term Bond Yield (10Y convergence)", "Rates", "M", "%",
		"ECB/IRS/M.U2.L.L40.CI.0000.EUR.N.Z"),
	// Inflation
	ezEntry("HICP", "Euro Area HICP (Annual Rate)", "Inflation", "M", "%",
		"ECB/ICP/M.U2.N.000000.4.ANR"),
	ezEntry("HICPCORE", "Euro Area Core HICP (Annual Rate)", "Inflation", "M", "%",
		"ECB/ICP/M.U2.N.XEF000.4.ANR"),
}

// LookupCatalog returns the curated entry for an identifier. Accepts either
// the full "COUNTRY.CODE" handle or a bare code (which resolves to the first
// matching entry — convenient for v1 where most codes are unambiguous).
func LookupCatalog(identifier string) *CatalogEntry {
	country, code := SplitIdentifier(identifier)
	for i := range Catalog {
		if !strings.EqualFold(Catalog[i].Code, code) {
			continue
		}
		if country == "" || strings.EqualFold(Catalog[i].Country, country) {
			return &Catalog[i]
		}
	}
	return nil
}

// IndicatorsByCountry returns the catalog filtered to a single country (ISO-2).
func IndicatorsByCountry(country string) []CatalogEntry {
	out := make([]CatalogEntry, 0, len(Catalog))
	for _, e := range Catalog {
		if strings.EqualFold(e.Country, country) {
			out = append(out, e)
		}
	}
	return out
}

// CentralBanks returns the deduplicated list of central banks covered by the
// catalog, in the order they first appear. Used by the drill-down screen.
func CentralBanks() []CentralBank {
	seen := map[string]int{}
	out := []CentralBank{}
	for _, e := range Catalog {
		key := e.Country + "|" + e.CentralBank
		if idx, ok := seen[key]; ok {
			out[idx].Indicators++
			continue
		}
		seen[key] = len(out)
		out = append(out, CentralBank{Country: e.Country, Name: e.CentralBank, Indicators: 1})
	}
	return out
}
