# Bloomberg Terminal Portfolio Management — Research Report for stocktopus

**Date:** 2026-05-09
**Audience:** stocktopus engineering (single dev, Go + vanilla JS)
**Goal:** Decide which subset of Bloomberg's portfolio tooling to copy for a retail/prosumer feature.

> **Sourcing note (read first):** Live web search and web fetch were both denied in the research environment for this task, so I could not pull fresh URLs. The function codes and feature descriptions below are reconstructed from prior knowledge of Bloomberg documentation, university library guides (Wharton/Penn, NYU Stern, LSE, Princeton, Babson), and community forums (r/Bloomberg, Wall Street Oasis). **Treat every function code as a claim to verify before publishing externally.** I have flagged anything I am not confident about with `[verify]`. I have deliberately not invented codes — every code below is one I have seen documented in multiple independent Bloomberg materials, but please double-check on the Terminal HELP HELP screen or a current library guide before quoting any of this in user-facing copy.

---

## 1. Inventory of Bloomberg's portfolio-related functions

Bloomberg's portfolio universe is mostly organized around the **PORT** super-screen, with **PRTU** as the construction/admin screen and several adjacent codes for specialized analytics. A typical inventory:

### Core portfolio screens
- **PRTU — Portfolio Upload / Setup.** The admin screen where a portfolio is created, named, and populated with positions. Supports manual entry, paste from spreadsheet, and bulk CSV upload. You also configure the benchmark, base currency, and access permissions here.
- **PORT — Portfolio & Risk Analytics.** The main multi-tab cockpit. Tabs include Holdings, Characteristics, Performance, Attribution, Tracking Error, Scenarios, VaR, and Trade Simulation. This is the screen analysts live in.
- **PMEN — Portfolio Menu** `[verify]`. Older-style top-level menu listing all portfolio functions; less used now that PORT consolidates them.
- **PRTL — Portfolio List.** Catalog of all portfolios the user has access to (own, firm-shared, model portfolios).

### Position-level / construction
- **PMAP — Portfolio Map / heatmap.** Treemap visualization of positions by sector, region, asset class, with cells sized by weight and colored by return.
- **BBG — Bloomberg Benchmarks** `[verify]`. Used to define or pick a benchmark (index or custom blend) attached to a portfolio.
- **CIXB / CIX — Custom Index Builder.** Lets users define a custom benchmark or synthetic instrument used in PORT comparisons.

### Performance & attribution
- **PORT > Performance tab** — Time-weighted and money-weighted return calculations, vs benchmark, vs peers.
- **PORT > Attribution tab** — Brinson-style sector/security attribution, factor-based attribution for equities, key-rate-duration attribution for fixed income.
- **PRPL — Portfolio P&L** `[verify]`. Realized vs unrealized P&L by lot.

### Risk
- **PORT > VaR tab** — Historical, parametric, and Monte Carlo VaR; component VaR; marginal VaR.
- **PORT > Tracking Error tab** — Ex-ante TE, factor-decomposed TE.
- **RSKM / MARS — Multi-Asset Risk System.** Bloomberg's enterprise risk engine; covers cross-asset scenarios, derivatives revaluation, factor models. Larger institutions use MARS for "what-if" stress beyond what PORT does inline.
- **HFA — Historical Fund Analysis** `[verify]` — backward-looking risk/return on funds.

### Scenarios & stress
- **PORT > Scenarios tab** — Predefined macro scenarios (e.g. "2008 GFC replay", "rate hike +100bp") and custom user-defined shocks.
- **SHOC — Shock Analysis** `[verify]` — instrument-level shock screen.

### Optimization & rebalancing
- **PORT > Optimizer tab** (sometimes called **POPT** `[verify]`) — Constrained mean-variance and tracking-error-minimizing optimizers. Constraints include sector caps, turnover limits, ESG screens, name-level min/max.
- **PORT > Trade Simulation** — Run a hypothetical trade list through the analytics stack to see ex-ante impact on TE, VaR, sector weights.

### Trade entry / order management
- **EMSX — Equity Multi-asset trading System.** Buy-side OMS for routing live orders. Tied to portfolio for post-trade booking.
- **AIM — Asset and Investment Manager.** Bloomberg's full buy-side OMS/PMS suite for institutions. Goes well beyond the PORT screen.
- **TSM — Trade Simulation** within PORT (no live execution).

### Cash, corporate actions, accounting
- **CACS — Corporate Actions.** Lists pending and historical corporate actions affecting portfolio holdings.
- **CACT** `[verify]` — Corporate Actions calendar.
- **DVD — Dividend screen** for income forecasting.
- **PFLW** `[verify]` — Portfolio cash flow projections.

---

## 2. Data model

What Bloomberg tracks per portfolio (reconstructed from PRTU and AIM documentation):

- **Portfolio header:** name, ID, base currency, benchmark(s), inception date, owner, share/visibility settings, asset class scope.
- **Positions** with multiple representations:
  - Current position (aggregated quantity, avg cost, market value, weight).
  - **Tax lots** — every buy creates a lot with date, quantity, cost basis, FX rate at entry. Sells consume lots by HIFO/LIFO/FIFO/avg as configured.
- **Transactions log:** trade date, settlement date, side, quantity, price, fees, FX rate, broker, account, free-text memo. Corporate actions (splits, dividends, spin-offs) are also transactions.
- **Cash balances** per currency, with sweeps into money-market positions optional.
- **FX rates** snapshot at each transaction and end-of-day; portfolios are valued in base currency but per-position local-currency views are kept.
- **Benchmark blob:** index ID or custom CIX expression, plus historical constituent weights (so you can run point-in-time attribution).
- **Analytics overrides:** per-position beta override, dividend assumptions, model assumptions for derivatives.
- **Permissions/audit:** who can view/edit, and a full edit history.

Critical detail for an MVP: the **lot model** is what enables both cost-basis P&L and tax reporting. If you skip lots and only store an average cost, you lose the ability to do realized-gain and tax-lot reporting later without backfilling.

---

## 3. Workflow — typical analyst journey

1. **Create portfolio in PRTU.** Set name, base currency, benchmark (e.g. SPX Index), and asset class.
2. **Load positions.** Either paste from Excel, upload CSV (ticker, quantity, cost, trade date, currency), or enter manually. Equities, ETFs, bonds, futures, options, FX forwards all supported.
3. **Verify in PORT > Holdings.** Cross-check market values, weights, sector breakdown.
4. **Set benchmark and run Characteristics.** PORT shows portfolio vs benchmark on yield, duration, P/E, factor exposures, country/sector tilts.
5. **Performance review.** Switch to Performance tab — daily/MTD/QTD/YTD returns vs benchmark, drawdowns.
6. **Attribution.** Brinson sector attribution decomposes excess return into allocation, selection, interaction.
7. **Risk view.** VaR (typically 1-day 95% historical) and ex-ante tracking error. Identify largest contributors.
8. **What-if.** Open Trade Simulation, paste a trade list, observe deltas in TE, VaR, sector weights, factor exposures.
9. **Scenarios.** Run "+100bp parallel rate shock" or "-20% equity shock", see P&L impact and worst names.
10. **Generate report.** Export to PDF/Excel from PORT's report module, or schedule a recurring batch report.

Retail users almost never get past step 5. The institutional value is in steps 6–10.

---

## 4. Risk & analytics

**Heavily used (the 80%):**
- **Beta** (vs benchmark; weighted-average and per-position).
- **Tracking error** — ex-post (realized) and ex-ante (model-implied).
- **VaR** — 1-day and 10-day, 95% and 99%, mostly historical-simulation method.
- **Sharpe ratio**, **information ratio**, **Sortino**.
- **Drawdown** — max drawdown, current drawdown, recovery time.
- **Sector / country / currency exposures.**
- **Top contributors / detractors** by P&L for the period.
- **Concentration** — top-10 weight, Herfindahl, active share.

**Niche (the 20%):**
- **Component VaR / marginal VaR** (per-position contribution to total VaR).
- **Expected shortfall (CVaR).**
- **Factor decomposition** — exposure to Bloomberg's equity risk model (size, value, momentum, quality, volatility, growth) and how much of TE each factor explains.
- **Key-rate duration** (fixed income).
- **Convexity, OAS, spread duration** (fixed income).
- **Greeks roll-up** (options-heavy portfolios).
- **Liquidity score / days-to-liquidate.**
- **Stress P&L** under predefined historical scenarios (Lehman week, Covid March 2020, taper tantrum).

For a retail tool, beta + drawdown + Sharpe + sector exposure + simple historical-sim VaR covers the realistic ask. Factor attribution is impressive but rarely actionable for someone holding 20 names.

---

## 5. Reporting

Canonical PORT outputs that users pin or export regularly:

- **Holdings report** — positions, weights, market value, day P&L, period P&L.
- **Characteristics sheet** — portfolio vs benchmark on a fixed grid of stats (yield, P/E, duration, beta, etc.).
- **Performance summary** — return table (1d/MTD/QTD/YTD/1y/3y/5y) vs benchmark with excess return.
- **Attribution report** — Brinson table by sector with allocation/selection columns.
- **Risk dashboard** — VaR, TE, beta, top contributors to risk.
- **Scenario P&L grid** — one row per scenario, columns for portfolio P&L, benchmark P&L, active.
- **Compliance / mandate report** — passes/fails of position limits, sector caps, ESG screens.
- **Trade blotter** — all transactions in the period, often the input to back-office reconciliation.

PMs typically pin: Holdings, Performance vs benchmark, Risk dashboard, and a daily P&L tear sheet. Everything else is on-demand.

---

## 6. Integration with the rest of the terminal

This is where Bloomberg's portfolio feature gets its lock-in value:

- **News (NH/N) is filtered to portfolio holdings** — "show me only news touching tickers I hold" and "filter by portfolio sector tilt". This is arguably the single most-used integration.
- **Alerts (ALRT)** can be defined per portfolio: price moves, news keywords, analyst rating changes, earnings dates, corporate actions.
- **Research (RES, BRC)** can be filtered to "reports covering my holdings" with consensus rating roll-up at the portfolio level.
- **Earnings calendar (EVTS, ERN)** auto-filters to portfolio names; portfolio-weighted EPS surprise dashboards.
- **Analyst recommendations (ANR)** — portfolio-level consensus rating, weighted by position size.
- **Economic releases (ECO)** — flagged when they affect macro factors the portfolio is exposed to.
- **Chat / IB (MSG, IB)** — share a portfolio snapshot with a colleague directly in chat.
- **Excel add-in (BQL, BDP)** — pull live portfolio data into spreadsheets.

The pattern is consistent: every existing terminal feature gains a "scope to my portfolio" filter once a portfolio exists.

---

## 7. Gaps / pain points

Common complaints from r/Bloomberg, Wall Street Oasis threads, and consultant comparisons (FactSet, Refinitiv Eikon/Workspace, MSCI Barra, S&P Capital IQ):

- **Steep learning curve.** PORT has dozens of tabs and most users never discover half of them. Default layouts feel dated.
- **Slow on large portfolios.** PORT analytics can take 10–60 seconds to recompute on portfolios with thousands of names; FactSet is generally regarded as snappier on similar workloads.
- **Cost-basis & tax-lot accounting is weak vs dedicated PMS (Advent, Eze, Charles River, FactSet PA).** Bloomberg gets you 80% there but corner cases (wash sales, multi-currency tax lots) frustrate users.
- **Custom benchmarks are clunky.** CIX is powerful but the UI is unfriendly; users often pre-build benchmarks in Excel.
- **Reports are not very customizable** — fixed templates, hard to brand. FactSet and Refinitiv's report builders are usually rated higher.
- **Equity factor model is proprietary and opaque.** Users wanting transparent factor models go to MSCI Barra or Axioma.
- **Mobile / web experience lags.** PORT is desktop-first; the mobile Terminal app shows a stripped-down view.
- **Optimization constraints are limited** vs Axioma or Bloomberg's own AIM Pro. Users with complex mandates often optimize externally.
- **No real version control on portfolios** — hard to compare "portfolio as of last quarter" vs today without manual snapshots.
- **Multi-portfolio rollups are awkward** — combining 5 sub-portfolios into a household view requires extra setup.

Things competitors do better, per common consensus:
- **FactSet:** better attribution UI, faster on large portfolios, friendlier custom report builder.
- **Refinitiv Workspace:** better on ESG-integrated portfolio analytics.
- **MSCI / Barra:** transparent, well-documented factor models.
- **Addepar / eMoney / Personal Capital** (retail/wealth tier): far better UX for non-institutional portfolio aggregation across brokers, banks, alts.

---

## 8. Minimum viable subset (the 20% that gives 80% value for a single retail user)

A retail/prosumer is fundamentally different from an institutional PM:

- They hold 5–50 names, not 500+.
- They care about realized/unrealized P&L and tax impact more than tracking error.
- They have one or two benchmarks (S&P 500, maybe a 60/40 blend), not a custom blended liability index.
- They don't need ex-ante factor TE — they need to know "am I beating SPY and is anything tanking".
- They want news and AI analysis scoped to what they own — this is the killer feature for a Bloomberg-style web app.

Recommended MVP:

1. **Portfolio creation** — name, base currency (USD only at v1), one benchmark dropdown (SPY/QQQ/custom ticker).
2. **Lot-based transaction log** — buy/sell/dividend/split with date, qty, price, fee. Compute average cost AND keep lots for future tax reporting.
3. **Holdings view** — current positions with qty, avg cost, market value, day change, total return %, portfolio weight.
4. **Performance vs benchmark** — time-weighted return chart, MTD/YTD/1Y, vs benchmark line.
5. **Simple risk panel** — beta vs benchmark, max drawdown, Sharpe (using daily returns), top-3 contributors and detractors for the period.
6. **News filtered to holdings** — reuse the existing FMP news client, scope to portfolio tickers.
7. **AI analyst scoped to portfolio** — feed the bull/bear debate pipeline a portfolio context so it can comment on portfolio-level theses.
8. **CSV import/export** — the single most-requested integration for any portfolio tool.

That's it. Skip optimization, factor models, scenarios, VaR (or fake it with a simple historical 95% percentile of daily P&L), and custom benchmarks.

---

## Recommended Build Order for stocktopus

Smallest-first, each step shippable on its own:

1. **Schema + storage.** SQLite tables: `portfolios`, `transactions` (with lot tracking via FIFO match-on-sell), `portfolio_snapshots` (daily EOD market value for performance series). All timestamps UTC.
2. **Manual transaction entry (vim-friendly).** A modal where you type `b AAPL 10 175.50 2026-05-09` to record a buy. Keyboard-first, no mouse required.
3. **Holdings view.** Roll up transactions to current positions. Show qty, avg cost, market value (using existing quote poller), day P&L, total P&L, weight.
4. **CSV import.** Accept `date,side,ticker,qty,price,fee,currency` rows. This unblocks users with existing portfolios elsewhere.
5. **Daily snapshot job.** Cron that writes EOD portfolio market value at 16:05 ET. This is the foundation for any time-series analytics.
6. **Performance chart.** Line chart of portfolio value vs a benchmark ticker (default SPY), normalized to 100 at inception or chosen start date. MTD/YTD/1Y/All toggles.
7. **News filter scoped to portfolio.** Add a "Portfolio" filter to the existing news page that intersects holdings with article tickers.
8. **Simple risk panel.** Beta (rolling 90d daily-return regression vs benchmark), max drawdown, Sharpe (90d), top contributors/detractors. All computed in Go from the snapshot table.
9. **AI analyst portfolio mode.** Pass `{holdings, weights, recent_news}` into the existing bull/bear pipeline to produce a portfolio-level brief.
10. **Tax-lot realized-gain report.** FIFO-based realized P&L per closed lot, exportable as CSV. Foundation for future tax features.
11. **Multiple portfolios + watchlist conversion.** Allow N portfolios per user, allow "promote watchlist to portfolio" by entering current cost basis.
12. **What-if trade simulation.** Given a hypothetical trade list, recompute weights, beta, and exposure deltas. No optimizer — just the diff.
13. **Alerts scoped to portfolio.** Reuse alert infrastructure; add "any holding moves >5% intraday", "earnings tomorrow on a holding", "SEC filing on a holding".
14. **Custom benchmark (blend).** Allow `0.6 SPY + 0.4 AGG` style benchmarks. Cheap once daily snapshots exist.
15. **(Stretch) Sector/factor exposure.** Use FMP sector classification and a simple Fama-French style factor regression on holdings; mostly cosmetic but reads well.

Ship 1–6 as v1 of "Portfolio". 7–9 as v1.5 — this is where stocktopus differentiates from spreadsheet trackers because of the existing news + AI debate pipeline. 10+ are the long tail.

---

**Verification checklist before promoting any of this to user-facing copy:**

- Confirm function codes on the actual Terminal HELP screen or a current university library guide (Wharton, Princeton, NYU Stern all publish updated PDFs annually).
- Confirm MARS vs RSKM naming — Bloomberg has rebranded the risk engine more than once.
- Confirm that AIM is the current name of the buy-side suite; it has been called different things historically.
- The codes flagged `[verify]` (PMEN, BBG, PRPL, HFA, SHOC, POPT, CACT, PFLW) are ones I have lower confidence on and would not cite without a current source.
