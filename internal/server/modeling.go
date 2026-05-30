package server

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
)

// modeling.go implements a CFI-style three-statement model for a security.
// Inputs: 5y FMP income/balance/cashflow. Outputs: a 12-driver assumption
// vector derived from history, plus a 5y forward projection of IS/BS/CF
// with a balance-sheet check. Drivers can be overridden per forecast year
// via the request body; defaults are recomputed from history each call.
//
// Driver math is identical to the CFI Corporate Finance Institute case
// study (scripts/CFI-Case-Study-Three-Statement-Model.xlsx): every BS
// line ties to a driver, the cash row is the closing balance plug from
// the cash flow, and `Total Assets - Total L&E` is emitted as `bsCheck`
// (which must round to zero on a balanced model).

// ModelingPeriod is one year of statements, historical or forecast.
type ModelingPeriod struct {
	Year       int  `json:"year"`
	Historical bool `json:"historical"`

	// Income statement
	Revenue     float64 `json:"revenue"`
	COGS        float64 `json:"cogs"`
	GrossProfit float64 `json:"grossProfit"`
	OpEx        float64 `json:"opex"` // operating expenses excl D&A and interest
	DA          float64 `json:"da"`
	Interest    float64 `json:"interest"`
	TotalExp    float64 `json:"totalExp"`
	EBT         float64 `json:"ebt"`
	Tax         float64 `json:"tax"`
	NetEarnings float64 `json:"netEarnings"`

	// Balance sheet
	Cash             float64 `json:"cash"`
	AR               float64 `json:"ar"`
	Inventory        float64 `json:"inventory"`
	PPE              float64 `json:"ppe"`
	TotalAssets      float64 `json:"totalAssets"`
	AP               float64 `json:"ap"`
	Debt             float64 `json:"debt"`
	Equity           float64 `json:"equity"`
	RetainedEarnings float64 `json:"retainedEarnings"`
	TotalLE          float64 `json:"totalLE"`
	BSCheck          float64 `json:"bsCheck"`

	// Cash flow
	OperatingCF   float64 `json:"operatingCF"`
	InvestingCF   float64 `json:"investingCF"`
	FinancingCF   float64 `json:"financingCF"`
	NetChangeCash float64 `json:"netChangeCash"`
}

// ModelingAssumptions is the 12-driver vector. Each slice has one entry
// per forecast year. The frontend can submit a partial override; missing
// years fall back to the derived default for that index.
type ModelingAssumptions struct {
	RevenueGrowth  []float64 `json:"revenueGrowth"`
	COGSPct        []float64 `json:"cogsPct"`
	OpExPct        []float64 `json:"opexPct"`
	DAPct          []float64 `json:"daPct"`
	InterestPct    []float64 `json:"interestPct"`
	TaxRate        []float64 `json:"taxRate"`
	ARDays         []float64 `json:"arDays"`
	InventoryDays  []float64 `json:"inventoryDays"`
	APDays         []float64 `json:"apDays"`
	Capex          []float64 `json:"capex"`
	DebtIssuance   []float64 `json:"debtIssuance"`
	EquityIssuance []float64 `json:"equityIssuance"`
}

// ModelingResponse is the wire shape returned by /api/security/{sym}/modeling.
type ModelingResponse struct {
	Symbol      string              `json:"symbol"`
	Historical  []ModelingPeriod    `json:"historical"`
	Forecast    []ModelingPeriod    `json:"forecast"`
	Assumptions ModelingAssumptions `json:"assumptions"`
}

// ForecastYears is fixed at 5 to mirror the CFI case study. A future
// pass can parameterise this, but every driver slice currently assumes
// `len == ForecastYears`.
const ForecastYears = 5

// pickFloat extracts a numeric field from an FMP statement row. FMP
// statements come back with mixed types (raw ints for whole numbers,
// floats for percentages), so we accept both.
func pickFloat(row map[string]any, keys ...string) float64 {
	for _, k := range keys {
		v, ok := row[k]
		if !ok || v == nil {
			continue
		}
		switch n := v.(type) {
		case float64:
			return n
		case float32:
			return float64(n)
		case int:
			return float64(n)
		case int64:
			return float64(n)
		case json.Number:
			f, _ := n.Float64()
			return f
		case string:
			f, _ := strconv.ParseFloat(n, 64)
			return f
		}
	}
	return 0
}

// statementYear returns the fiscal year as an int. FMP gives us
// `fiscalYear` (string) on newer endpoints and `date` (YYYY-MM-DD) on
// older ones — read either.
func statementYear(row map[string]any) int {
	if fy, ok := row["fiscalYear"].(string); ok && len(fy) >= 4 {
		y, _ := strconv.Atoi(fy[:4])
		return y
	}
	if d, ok := row["date"].(string); ok && len(d) >= 4 {
		y, _ := strconv.Atoi(d[:4])
		return y
	}
	return 0
}

// buildHistorical assembles a slice of ModelingPeriods from the three
// FMP statement arrays. Statements are aligned by fiscal year; years
// missing from any of the three are dropped. The result is sorted
// ascending so index 0 is the oldest year — the forecast loop reads
// `historical[last]` to seed its first projection.
func buildHistorical(income, balance, cashflow []map[string]any) []ModelingPeriod {
	type yearRow struct {
		inc, bal, cf map[string]any
	}
	byYear := map[int]*yearRow{}
	add := func(rows []map[string]any, kind string) {
		for _, r := range rows {
			y := statementYear(r)
			if y == 0 {
				continue
			}
			yr, ok := byYear[y]
			if !ok {
				yr = &yearRow{}
				byYear[y] = yr
			}
			switch kind {
			case "inc":
				yr.inc = r
			case "bal":
				yr.bal = r
			case "cf":
				yr.cf = r
			}
		}
	}
	add(income, "inc")
	add(balance, "bal")
	add(cashflow, "cf")

	out := make([]ModelingPeriod, 0, len(byYear))
	for y, yr := range byYear {
		if yr.inc == nil || yr.bal == nil || yr.cf == nil {
			continue
		}
		p := ModelingPeriod{Year: y, Historical: true}

		// Income statement — FMP fields. `operatingExpenses` includes D&A
		// for some filers and excludes it for others; we subtract D&A
		// explicitly so the driver math is consistent.
		p.Revenue = pickFloat(yr.inc, "revenue")
		p.COGS = pickFloat(yr.inc, "costOfRevenue")
		p.GrossProfit = p.Revenue - p.COGS
		p.DA = pickFloat(yr.cf, "depreciationAndAmortization")
		p.Interest = pickFloat(yr.inc, "interestExpense")
		opIncome := pickFloat(yr.inc, "operatingIncome")
		// OpEx (excl D&A and interest) = Gross Profit − Operating Income.
		// This recovers the "salaries + rent + other" bucket in one driver
		// without depending on FMP's inconsistent SG&A breakdown.
		p.OpEx = p.GrossProfit - opIncome - p.DA
		if p.OpEx < 0 {
			p.OpEx = 0
		}
		p.TotalExp = p.OpEx + p.DA + p.Interest
		p.EBT = pickFloat(yr.inc, "incomeBeforeTax")
		p.Tax = pickFloat(yr.inc, "incomeTaxExpense")
		p.NetEarnings = pickFloat(yr.inc, "netIncome")

		// Balance sheet
		p.Cash = pickFloat(yr.bal, "cashAndCashEquivalents")
		p.AR = pickFloat(yr.bal, "netReceivables", "accountsReceivables")
		p.Inventory = pickFloat(yr.bal, "inventory")
		p.PPE = pickFloat(yr.bal, "propertyPlantEquipmentNet")
		// FMP names it `accountPayables` (no 's') on the balance sheet,
		// but `accountsPayables` (with 's') on the cash flow statement.
		// Accept either to be tolerant of FMP renames.
		p.AP = pickFloat(yr.bal, "accountPayables", "accountsPayables")
		p.Debt = pickFloat(yr.bal, "totalDebt")
		if p.Debt == 0 {
			p.Debt = pickFloat(yr.bal, "shortTermDebt") + pickFloat(yr.bal, "longTermDebt")
		}
		p.RetainedEarnings = pickFloat(yr.bal, "retainedEarnings")
		totalEquity := pickFloat(yr.bal, "totalStockholdersEquity", "totalEquity")
		// Equity capital = total equity − retained earnings (paid-in capital
		// + treasury + accumulated OCI). Driving this back out keeps the
		// projected RE roll-forward clean.
		p.Equity = totalEquity - p.RetainedEarnings
		// We carry the *subset* TA/TLE used by the projection, not FMP's
		// full reported balance. Two reasons: (1) forecast math sums the
		// same four assets and four L&E lines, so historical and forecast
		// rows are comparable; (2) the projection's accounting identity
		// (Δ TA_subset = Δ TLE_subset) only ties if both sides exclude
		// the un-modelled buckets (LT investments, goodwill, deferred
		// taxes, AOCI, etc.). The constant gap between this subset and
		// FMP's full BS is the plug that BSCheck cancels out.
		p.TotalAssets = p.Cash + p.AR + p.Inventory + p.PPE
		p.TotalLE = p.AP + p.Debt + p.Equity + p.RetainedEarnings
		p.BSCheck = p.TotalAssets - p.TotalLE

		// Cash flow
		// FMP's `capitalExpenditure` is negative (cash out); store as
		// positive magnitude for the driver, sign-flip when we plug it
		// into Investing CF.
		capex := pickFloat(yr.cf, "capitalExpenditure")
		if capex < 0 {
			capex = -capex
		}
		p.OperatingCF = pickFloat(yr.cf, "operatingCashFlow", "netCashProvidedByOperatingActivities")
		p.InvestingCF = pickFloat(yr.cf, "netCashProvidedByInvestingActivities", "netCashUsedForInvestingActivities")
		p.FinancingCF = pickFloat(yr.cf, "netCashProvidedByFinancingActivities", "netCashUsedProvidedByFinancingActivities")
		p.NetChangeCash = p.OperatingCF + p.InvestingCF + p.FinancingCF

		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Year < out[j].Year })
	return out
}

// DeriveDefaults reads the last historical year and the year before it to
// produce a flat 5-year assumption vector. Each driver projects forward
// at the last observed value — the user's job in the UI is to edit these
// to taste before the LLM call. Where a ratio's denominator is zero, the
// driver falls back to a neutral default (0 growth, 0 days, etc.).
func DeriveDefaults(hist []ModelingPeriod) ModelingAssumptions {
	a := ModelingAssumptions{
		RevenueGrowth:  make([]float64, ForecastYears),
		COGSPct:        make([]float64, ForecastYears),
		OpExPct:        make([]float64, ForecastYears),
		DAPct:          make([]float64, ForecastYears),
		InterestPct:    make([]float64, ForecastYears),
		TaxRate:        make([]float64, ForecastYears),
		ARDays:         make([]float64, ForecastYears),
		InventoryDays:  make([]float64, ForecastYears),
		APDays:         make([]float64, ForecastYears),
		Capex:          make([]float64, ForecastYears),
		DebtIssuance:   make([]float64, ForecastYears),
		EquityIssuance: make([]float64, ForecastYears),
	}
	if len(hist) == 0 {
		return a
	}
	last := hist[len(hist)-1]

	var growth float64
	if len(hist) >= 2 {
		prev := hist[len(hist)-2]
		if prev.Revenue > 0 {
			growth = (last.Revenue - prev.Revenue) / prev.Revenue
		}
	}

	var cogsPct, opexPct, taxRate, arDays, invDays, apDays float64
	if last.Revenue > 0 {
		cogsPct = last.COGS / last.Revenue
		opexPct = last.OpEx / last.Revenue
		arDays = last.AR * 365 / last.Revenue
	}
	if last.COGS > 0 {
		invDays = last.Inventory * 365 / last.COGS
		apDays = last.AP * 365 / last.COGS
	}
	if last.EBT > 0 {
		taxRate = last.Tax / last.EBT
	}

	var daPct, interestPct float64
	if len(hist) >= 2 {
		prev := hist[len(hist)-2]
		if prev.PPE > 0 {
			daPct = last.DA / prev.PPE
		}
		if prev.Debt > 0 {
			interestPct = last.Interest / prev.Debt
		}
	}

	capex := last.NetChangeCash // overwritten below from cashflow if available
	// Better: the capex driver should be the absolute investing-side
	// outflow. We stored InvestingCF (signed) and lost capex itself; for
	// the default, approximate as |InvestingCF| since CFI treats
	// investing as pure capex.
	if last.InvestingCF < 0 {
		capex = -last.InvestingCF
	}

	for i := 0; i < ForecastYears; i++ {
		a.RevenueGrowth[i] = growth
		a.COGSPct[i] = cogsPct
		a.OpExPct[i] = opexPct
		a.DAPct[i] = daPct
		a.InterestPct[i] = interestPct
		a.TaxRate[i] = taxRate
		a.ARDays[i] = arDays
		a.InventoryDays[i] = invDays
		a.APDays[i] = apDays
		a.Capex[i] = capex
		// Debt/equity issuance default to zero — projecting forward last
		// year's one-off financing action would be a bad default.
		a.DebtIssuance[i] = 0
		a.EquityIssuance[i] = 0
	}
	return a
}

// mergeAssumptions overlays user-supplied assumptions on top of defaults.
// Any slice on the override that's the right length wins; otherwise the
// default for that driver is used. This lets the frontend POST a partial
// edit (e.g. "I only changed Revenue Growth and Tax Rate").
func mergeAssumptions(defaults, override ModelingAssumptions) ModelingAssumptions {
	pick := func(d, o []float64) []float64 {
		if len(o) == ForecastYears {
			return o
		}
		return d
	}
	return ModelingAssumptions{
		RevenueGrowth:  pick(defaults.RevenueGrowth, override.RevenueGrowth),
		COGSPct:        pick(defaults.COGSPct, override.COGSPct),
		OpExPct:        pick(defaults.OpExPct, override.OpExPct),
		DAPct:          pick(defaults.DAPct, override.DAPct),
		InterestPct:    pick(defaults.InterestPct, override.InterestPct),
		TaxRate:        pick(defaults.TaxRate, override.TaxRate),
		ARDays:         pick(defaults.ARDays, override.ARDays),
		InventoryDays:  pick(defaults.InventoryDays, override.InventoryDays),
		APDays:         pick(defaults.APDays, override.APDays),
		Capex:          pick(defaults.Capex, override.Capex),
		DebtIssuance:   pick(defaults.DebtIssuance, override.DebtIssuance),
		EquityIssuance: pick(defaults.EquityIssuance, override.EquityIssuance),
	}
}

// Project rolls forward `ForecastYears` years from the last historical
// period using the supplied assumption vector. The math is the CFI
// case-study model verbatim:
//
//	Revenueₜ        = Revenueₜ₋₁ × (1 + g)
//	COGSₜ           = Revenueₜ × COGS%
//	OpExₜ           = Revenueₜ × OpEx%
//	D&Aₜ            = PPEₜ₋₁ × D&A%
//	Interestₜ       = Debtₜ₋₁ × Int%
//	EBTₜ            = Gross − (OpEx + D&A + Interest)
//	Taxₜ            = EBTₜ × Tax%
//	Net Earningsₜ   = EBTₜ − Taxₜ
//	ARₜ             = Revenueₜ × AR_days / 365
//	Invₜ            = COGSₜ × Inv_days / 365
//	APₜ             = COGSₜ × AP_days / 365
//	PPEₜ            = PPEₜ₋₁ + Capex − D&A
//	Debtₜ           = Debtₜ₋₁ + DebtIssuance
//	Equityₜ         = Equityₜ₋₁ + EquityIssuance
//	REₜ             = REₜ₋₁ + Net Earnings
//	ΔNWC            = (AR+Inv−AP)ₜ − (AR+Inv−AP)ₜ₋₁
//	Operating CF    = Net Earnings + D&A − ΔNWC
//	Investing CF    = −Capex
//	Financing CF    = DebtIssuance + EquityIssuance
//	Cashₜ           = Cashₜ₋₁ + Operating + Investing + Financing
//
// The balance-sheet check `Total Assets − Total L&E` is computed but not
// enforced — for a well-behaved driver set it sits at zero (within FP
// noise), and divergence flags a driver inconsistency to the user.
func Project(hist []ModelingPeriod, a ModelingAssumptions) []ModelingPeriod {
	if len(hist) == 0 {
		return nil
	}
	out := make([]ModelingPeriod, 0, ForecastYears)
	prior := hist[len(hist)-1]
	// The forecast tracks only four asset and four L&E lines; everything
	// else (LT investments, goodwill, deferred taxes, AOCI, …) collapses
	// into a constant plug. The accounting identity guarantees Δ TA_subset
	// = Δ TLE_subset over each step (proof: every flow that lands on one
	// side has a mirror on the other — cash absorbs NetEarnings via the
	// CF identity, RE absorbs it via the BS roll-forward), so this plug
	// is invariant. Subtracting it from BSCheck means a self-consistent
	// model displays zero and a broken driver set surfaces the drift.
	plug := prior.TotalAssets - prior.TotalLE
	for i := 0; i < ForecastYears; i++ {
		p := ModelingPeriod{Year: prior.Year + 1, Historical: false}

		// Income statement
		p.Revenue = prior.Revenue * (1 + a.RevenueGrowth[i])
		p.COGS = p.Revenue * a.COGSPct[i]
		p.GrossProfit = p.Revenue - p.COGS
		p.OpEx = p.Revenue * a.OpExPct[i]
		p.DA = prior.PPE * a.DAPct[i]
		p.Interest = prior.Debt * a.InterestPct[i]
		p.TotalExp = p.OpEx + p.DA + p.Interest
		p.EBT = p.GrossProfit - p.TotalExp
		p.Tax = p.EBT * a.TaxRate[i]
		p.NetEarnings = p.EBT - p.Tax

		// Balance sheet (everything except cash, which is the CF plug)
		if p.Revenue > 0 {
			p.AR = p.Revenue * a.ARDays[i] / 365
		}
		if p.COGS > 0 {
			p.Inventory = p.COGS * a.InventoryDays[i] / 365
			p.AP = p.COGS * a.APDays[i] / 365
		}
		p.PPE = prior.PPE + a.Capex[i] - p.DA
		p.Debt = prior.Debt + a.DebtIssuance[i]
		p.Equity = prior.Equity + a.EquityIssuance[i]
		p.RetainedEarnings = prior.RetainedEarnings + p.NetEarnings

		// Cash flow
		nwcPrior := prior.AR + prior.Inventory - prior.AP
		nwcNow := p.AR + p.Inventory - p.AP
		changeNWC := nwcNow - nwcPrior
		p.OperatingCF = p.NetEarnings + p.DA - changeNWC
		p.InvestingCF = -a.Capex[i]
		p.FinancingCF = a.DebtIssuance[i] + a.EquityIssuance[i]
		p.NetChangeCash = p.OperatingCF + p.InvestingCF + p.FinancingCF
		p.Cash = prior.Cash + p.NetChangeCash

		p.TotalAssets = p.Cash + p.AR + p.Inventory + p.PPE
		p.TotalLE = p.AP + p.Debt + p.Equity + p.RetainedEarnings
		p.BSCheck = (p.TotalAssets - p.TotalLE) - plug

		out = append(out, p)
		prior = p
	}
	return out
}

// handleSecurityModeling fetches 5y income/balance/cashflow from FMP,
// builds the historical periods, derives default drivers, applies any
// user-supplied override from the request body, projects 5y forward,
// and emits the combined response.
//
//	GET  /api/security/{sym}/modeling                 → defaults + projection
//	POST /api/security/{sym}/modeling  body=overrides → user assumptions
//
// Overrides arrive as a `ModelingAssumptions` JSON; any slice of length
// other than ForecastYears falls back to the default for that driver.
func (s *Server) handleSecurityModeling(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	ctx := r.Context()

	// 10y of history — the upgraded FMP plan returns the full window;
	// the lower tier silently caps at 5y, so this is a strict
	// non-regression. The forecast loop only reads `historical[last]`
	// so the additional years just enrich the displayed time line.
	const HistYears = 10
	incomeRaw, err := s.news.GetIncomeStatement(ctx, symbol, HistYears)
	if err != nil {
		http.Error(w, "income statement fetch failed", http.StatusBadGateway)
		return
	}
	balanceRaw, err := s.news.GetBalanceSheet(ctx, symbol, HistYears)
	if err != nil {
		http.Error(w, "balance sheet fetch failed", http.StatusBadGateway)
		return
	}
	cashflowRaw, err := s.news.GetCashFlow(ctx, symbol, HistYears)
	if err != nil {
		http.Error(w, "cash flow fetch failed", http.StatusBadGateway)
		return
	}

	var income, balance, cashflow []map[string]any
	if err := json.Unmarshal(incomeRaw, &income); err != nil {
		http.Error(w, "bad income response", http.StatusBadGateway)
		return
	}
	if err := json.Unmarshal(balanceRaw, &balance); err != nil {
		http.Error(w, "bad balance response", http.StatusBadGateway)
		return
	}
	if err := json.Unmarshal(cashflowRaw, &cashflow); err != nil {
		http.Error(w, "bad cashflow response", http.StatusBadGateway)
		return
	}

	hist := buildHistorical(income, balance, cashflow)
	defaults := DeriveDefaults(hist)

	assumptions := defaults
	if r.Method == http.MethodPost {
		var override ModelingAssumptions
		if err := json.NewDecoder(r.Body).Decode(&override); err == nil {
			assumptions = mergeAssumptions(defaults, override)
		}
	}

	forecast := Project(hist, assumptions)

	resp := ModelingResponse{
		Symbol:      symbol,
		Historical:  hist,
		Forecast:    forecast,
		Assumptions: assumptions,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
