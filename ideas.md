### 1. Vim Navigation on Financial Statements

**User Story:** As a keyboard-centric user, I want to use Vim navigation keys (`j` and `k`) on the Financials view, so that I can quickly scroll through balance sheets, income statements, and cash flow panels without using a mouse.
**Acceptance Criteria:**

* [ ] Pressing `j` moves the active row highlight down.
* [ ] Pressing `k` moves the active row highlight up.
* [ ] The highlighted state is visually distinct.
* [ ] This behavior works consistently across the Balance Sheet, Income Statement, and Cash Flow panels.
* [ ] Navigation respects panel boundaries (does not scroll off the data table).

### 2. Multi-Metric Comparative Graphing (Epic)

**User Story:** As a financial analyst, I want a dedicated comparative graphing tool with a "sketch pad" and save functionality, so that I can visually compare vastly different security metrics, indices, and commodities in a single, legible view.
**Acceptance Criteria:**

* [ ] Users can add a selected security property (e.g., Total Assets) to a "sketch pad" comparative graph.
* [ ] Users can add multiple distinct value types to the same chart (balance sheet items, other security prices, indices, forex, commodities).
* [ ] The chart automatically scales or uses multiple/normalized Y-axes so vastly different metrics (e.g., billions vs. hundreds) remain visible and legible on the same graph.
* [ ] Users can save the default sketch pad as a named comparison chart.
* [ ] Saved charts can be pinned to a specific security/company for future access.
* [ ] **All** functions (adding metrics, saving, pinning) are fully accessible via keyboard/terminal commands.

#### Notes 

1. The path should be /ideas  <- which will be the default sketchpad, we will eventually build this out to include other data and notes, but that's not for now.  ideas/<some id or title> will take me to a specific idea comparison graph.   Comparison graphs are a function of the ideas page.    
2. At the moment these are global, but let's scope them to a 'global' user concept so that we can refactor later towards user specific ideas.   Don't tie them to the symbol .
3. This is broader work, I want to be able to see such throught experiments sucha s 'how has the price of oil affected the stock price of x, or the debt of x or any other financial data of x'
4. data sources 

FMP again

Commodities
https://financialmodelingprep.com/stable/commodities-list?apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe 
https://financialmodelingprep.com/stable/quote?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/quote-short?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/1min?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/5min?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/1hour?symbol=GCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe

Forex

https://financialmodelingprep.com/stable/forex-list?apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/quote?symbol=EURUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://site.financialmodelingprep.com/playground
https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=EURUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=EURUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/1min?symbol=EURUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/5min?symbol=EURUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/1hour?symbol=EURUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe

Crypto
https://financialmodelingprep.com/stable/cryptocurrency-list?apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/quote?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/quote-short?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/1min?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/5min?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe
https://financialmodelingprep.com/stable/historical-chart/1hour?symbol=BTCUSD&apikey=b5PjWSJfLjZhOvnRLFJoWD3MekJoE2xe

5. Time range, it would be good if we could select, but I dont see how that would work against yearly financial data, maybe stick to 5 years for now. Unless you ahve a better idea. 


### 3. Financials Preview Chart Slide-in

**User Story:** As an analyst, I want to press `p` to preview a selected financial line item as a chart, so that I can visualize historical trends without leaving the main Financials page.
**Acceptance Criteria:**

* [ ] When a row on the Financials page is highlighted, pressing `p` triggers a slide-in window.
* [ ] The slide-in window displays a line chart of the historical data for the selected metric.
* [ ] The UX and animation of the slide-in window exactly match the existing "news reader" panel.
* [ ] Pressing `p` (or `Esc`) toggles/closes the slide-in window.

### 4. Global History Navigation via `-` Key

**User Story:** As a user, I want to press the `-` key to return to my previous page and tab state, so that I can rapidly navigate my recent history without losing context.
**Acceptance Criteria:**

* [ ] Pressing `-` universally triggers a "go back" action to the previous view.
* [ ] Returning to a previous page successfully restores the exact tab that was active at the time.
**Technical Notes:**
* Implement this utilizing the browser's native History API.
* Ensure tab states are managed via HATEOAS/URL parameters so the history stack inherently knows which tab was open.

#### Notes 

1. no, the vim navigation is used between tabs, - is only used if I jump to a new page via navigation or the command bar, I want to be able to get 'back' to where I was.   Say I jump to news <symbol> but I'm on the /ideas sketchpad, I want to read the news, then quickly jump back to to the sketchpad.  
2. I dont' udnerstand the question, did the above example help ? 
3. hash-bashed I think, as long as it works with sub-tabs as well.


### 5. Streamlined Watchlist Addition

**User Story:** As a user, I want a highly visible command menu option to add a security to a watchlist, so that I don't have to remember complex steps to track a company.
**Acceptance Criteria:**

* [ ] The main command menu includes a clear "Add to Watchlist" command.
* [ ] Selecting this command prompts for (or automatically adds) the currently viewed security to the user's active watchlist.

#### Watchlists already exists 
http://localhost:8080/watchlist

I'd like to be able to add a currently selected symbol to the watchlist, I think we added this already but i can't remmber how to do it, and speed and efficiency is the goal here,  

If I have a selected security in the symbol picker, I ant to press Escape, then see the command bar and type watch then it auto completes with Watch <name of watchlist> so that I can select which watchlist to add it to

### 6. Vim Navigation for Deep Analysis Execution

**User Story:** As a keyboard-centric user, I want to be able to focus and trigger the "Run Deep Analysis" button using normal mode Vim bindings, so that I can initiate analysis seamlessly.
**Acceptance Criteria:**

* [ ] The "Run Deep Analysis" button is focusable via `j`/`k` navigation in normal mode.
* [ ] When the button is focused/highlighted, pressing `Return` (`Enter`) executes the analysis.

### 7. Remove Execution Time Noise

**User Story:** As a user reviewing AI analysis, I want the "time the analysis took" metric removed from the UI, so that my view is less cluttered with irrelevant system noise.
**Acceptance Criteria:**

* [ ] Remove the execution/processing time text from the AI Analysis page DOM.

### 8. Trading Phase 3 — Trader Agent Proposal Generation

**User Story:** As the system orchestrator, I want a Trader Agent to convert an Investment Plan verdict into a concrete Trading Proposal, so that subjective analyses are turned into actionable market orders.
**Acceptance Criteria:**

* [ ] The Trader Agent successfully ingests the `InvestmentPlan` (bull/bear verdict).
* [ ] The Agent generates a standardized `TraderProposal` data object.
* [ ] The `TraderProposal` must include: `action`, `reasoning`, `entry_price`, `stop_loss`, and `position_size`.

#### Notes 
1. let's do this work as a separate piece after we finish this, I haven't thought about this deeply enough. 

### 9. Trading Phase 4 — 3-Way Risk Debate & PM Approval

**User Story:** As the system orchestrator, I want a generated trading proposal to be debated by three distinct risk personas and finalized by a Portfolio Manager agent, so that automated trades undergo rigorous risk assessment before execution.
**Acceptance Criteria:**

* [ ] A workflow is triggered where three AI personas (Aggressive, Conservative, Neutral) independently analyze and argue the `TraderProposal`.
* [ ] The output of this debate is ingested by a final "Portfolio Manager" agent.
* [ ] The Portfolio Manager agent issues a final Go/No-Go decision based on the debate logic

##### Notes

Let's think about portfolio  management as a separate piece, i want to study what the current bloombergterminal does, please start a research agent to find out.  

### 10. SEC Key People Timeline UI

**User Story:** As a fundamental analyst, I want to view a chronological timeline of executive changes on the SEC page, so that I can easily track leadership turnover and stability.
**Acceptance Criteria:**

* [ ] A new "Key People" sub-tab is added to the SEC page.
* [ ] The tab queries the existing `key_people` background table.
* [ ] Data is rendered in the UI as a clear, readable chronological timeline of executive changes.

### 11. Insider-derived Key People (Form 4 XML)

**User Story:** As a fundamental analyst, I want the Key People list to populate within seconds of opening the SEC tab on a security I haven't viewed before, so that I'm not waiting on minute-long LLM extractions to see who runs the company.
**Acceptance Criteria:**

* [ ] Recent Form 3/4/5 XML filings are downloaded and parsed (no LLM) to seed `key_people` with directors and officers.
* [ ] Each row records: name, title, role (director / officer / both), filing date, source URL.
* [ ] Existing DEF 14A and 10-K LLM extraction runs in the background after the Form 4 seed and enriches the list (e.g. "Lead Independent Director" titles, non-insider directors).
* [ ] No regression in current data quality — Form 4 entries dedup against LLM-derived entries by name+title.

**Technical Notes:**

* Forms 3/4/5 are schema'd XML — no scraping. Each filing has `<reportingOwner>` with `<reportingOwnerRelationship>` containing `isDirector`, `isOfficer`, `officerTitle`, `isTenPercentOwner` fields.
* New fetch path: list Form 4s from FMP (or SEC submissions API), grab the `.xml` not the `.htm`, unmarshal into a Go struct, write straight to `key_people`.
* Most current directors and officers will appear because they're required to file Form 4 on every transaction (and Form 3 on appointment).
* `edgartools` (Python) does this already if we want a reference implementation — but a small Go XML unmarshaller is probably <100 lines.

### 12. Vim row operations on the watchlist page (`d` / `y` / `p`)

**User Story:** As a keyboard-centric user managing my watchlists, I want to select a row on the watchlist page and use vim-style operations to remove, copy, or move that security between watchlists, so that I can curate lists without ever touching the mouse.
**Acceptance Criteria:**

* [ ] A row on the watchlist page is selectable via existing `j`/`k` navigation (highlight visually distinct).
* [ ] Pressing `d` on a selected row removes that security from the *current* watchlist (the one being viewed). Confirmation flash on success; idempotent if the symbol isn't there.
* [ ] Pressing `y` on a selected row opens the existing `:watch <name>` autocomplete dropdown pre-populated for "copy mode" — selecting a target watchlist adds the symbol to that list while *leaving it in the source list*.
* [ ] Pressing `p` on a selected row opens the same autocomplete in "move mode" — selecting a target adds it to the destination *and* removes it from the source as a single action.
* [ ] All three operations work on the keyboard alone — no mouse required (per the vim-first-class-citizen rule).
* [ ] Selection is preserved across the source list re-render after `d` or `p` (highlight the row that took the deleted row's slot, or the new last row if the deleted row was last).

**Technical Notes:**

* Reuse `renderCmdWatchlistDropdown(query)` from PR #46 with a mode flag (`copy` / `move`) so the description text and the executed action differ. Mode is held in a closure variable scoped to the cmd-bar invocation.
* `d` already maps to nothing on the watchlist view in the keydown switch — easy to wire.
* For `y` / `p`: focus the cmd input pre-filled with `:watch ` and stash the source row + mode for the eventual selection.
* Backend already exposes `DELETE /api/watchlists/{id}/symbols/{symbol}` from earlier work — no new endpoints needed.

### 13. Attach panels to a sketch (notes linking)

**User Story:** As an analyst building an investment thesis, I want to attach analyst result panels, news article links, and free text from anywhere in the app to the notes panel of a specific idea/sketch, so that all the evidence supporting one thought experiment lives in one place.
**Acceptance Criteria:**

* [ ] On any AI analyst result panel (Technical, Fundamentals, News, Sentiment, Research Verdict), an "attach to idea" affordance — keyboard-first, e.g. `A` while focused on the panel — opens an autocomplete picker of saved sketches.
* [ ] On any news card / article reader / SEC filing row, the same `A` keybinding works.
* [ ] Selecting a sketch appends a structured reference to that sketch's notes panel: `[2026-05-10] {kind}: {title} — {url-or-snippet}`.
* [ ] References in the notes panel become clickable — clicking opens the original (article reader, AI panel, etc.) without leaving `/ideas`.
* [ ] Free text typed directly in the notes textarea continues to be persisted as-is (existing behavior).

**Technical Notes:**

* The notes column is plain TEXT today. Could stay as Markdown-ish text with a renderer pass, or move to a structured `sketch_attachments` table for clickability. Markdown-with-links is faster to ship; structured table is cleaner long-term.
* The `_ideasGetSketches()` window helper from PR #48 already exposes the sketch list — reuse for the picker dropdown.
* Reuse the article-reader slide-in panel for opening attached articles, same as elsewhere.

### 15. Economics page (v1 — US via FRED)

**User Story:** As an investor reasoning about how macro shaped a security's path, I want a dedicated `/economics` page modelled on Bloomberg's ECO / ECST / ECWB triad, plus the ability to chart any economic indicator alongside prices and financial metrics on the sketchpad, so I can visually correlate macro shocks with company performance.
**Acceptance Criteria:**

* [ ] `/economics` page with two tabs — `Calendar` (ECO-style upcoming releases + recent actuals, columns: Date · Time · Country · Event · Importance · Prior · Survey · Actual · Surprise) and `Catalog` (ECST-style browser of curated indicators by category with sparkline preview).
* [ ] Both tabs are vim-navigable: `h/l` between tabs, `j/k` between rows, `Enter` opens chart preview (Catalog) or release detail (Calendar).
* [ ] `:add unrate`, `:add cpi`, `:add fedfunds`, `:add dgs10`, etc. autocomplete from the curated FRED catalog.
* [ ] Selected indicators plot on the same rebased % change chart as prices and financial fields.
* [ ] Series labels in the legend read humanly (e.g. "U.S. Unemployment Rate", "10Y Treasury Yield") not the raw FRED code.

**Technical Notes:**

* Data sources: FRED API for historical indicator time series (US-only, ~30 curated FRED IDs: UNRATE, CPIAUCSL, GDPC1, DGS10, FEDFUNDS, etc.). FMP `/stable/economic-calendar` for the release calendar (date, prior, estimate, actual, country, importance).
* New `internal/fred/` client. New `economic_series` SQLite table with frequency-aware TTLs (daily series refresh every 6h, monthly every 3 days, quarterly every week). Background prefetcher primes the curated set at boot.
* New `kind: 'economic'` on sketch metrics, routed through the historical handler.
* Catalog organised by category bucket: Rates · Inflation · Growth · Labor · Housing · Consumer · Trade.

### 16. Economics page (v2 — international via DBnomics)

**User Story:** As a global macro investor, I want the same economics page to surface ECB, Bank of England, Bundesbank, Banque de France, OECD, IMF, and World Bank indicators alongside the US series, so I can think about non-US monetary policy and cross-country comparisons.
**Acceptance Criteria:**

* [ ] Catalog gains a country pivot (US default, switch to EU / UK / DE / FR / JP / G7).
* [ ] Curated set extends to: ECB main refi rate, Eurozone HICP, BoE bank rate, UK CPI, Bundesbank yields, IFO sentiment, INSEE business confidence, OECD CLI, IMF WEO indicators.
* [ ] Calendar tab adds non-US release events (FMP economic calendar already covers most majors — verify coverage gap first).

**Technical Notes:**

* New `internal/dbnomics/` client wrapping `https://api.db.nomics.world/v22/series/{provider}/{dataset}/{code}?observations=1`. Covers FED, BEA, BLS, ECB, BOE, BUBA, BDF, INSEE, DESTATIS, OECD, IMF, WB, EUROSTAT.
* Note: FRED itself is no longer hosted on DBnomics (provider removed) — that's why v1 uses FRED direct. DBnomics is purely for international expansion.
* Each provider has its own series ID convention — catalog needs a `(provider, dataset, series_code)` tuple per entry. Hand-curate the international additions; don't try to expose the full 1.7B-series DBnomics universe.
* Stretch: ECWB-style transforms (YoY, MoM, MA, lead/lag, log) as keystrokes on a charted economic series.

### 14. Non-statement fields in `:add` (marketcap, beta, etc.)

**User Story:** As a sketchpad user, I want to plot company metadata fields like `marketcap`, `beta`, `peRatio`, and `dividendYield` over time on the comparison chart, so that I can compare these alongside prices and statement fields.
**Acceptance Criteria:**

* [ ] `:add AAPL.marketcap` autocompletes alongside the income/balance/cashflow fields.
* [ ] The historical endpoint accepts a "metadata" kind (or extends `financial`) to project these fields per period.
* [ ] Extracted values are charted on the existing rebased-to-100 line.

**Technical Notes:**

* FMP exposes these via separate endpoints: `/stable/key-metrics` (historical key metrics: peRatio, marketCap, etc.), `/stable/ratios` (priceToBookRatio, dividendYield, …), `/stable/profile` (single-snapshot beta, sector, mktCap).
* For point-in-time fields (beta from /profile), only one data point is available — show as a horizontal price line rather than a series, OR fall back to the most recent value across the chart range.
* Field-list autocomplete in `terminal.js` (`FIN_FIELDS`) needs a second tier: "key-metric fields" + "ratio fields" alongside statement fields. Could hit a discovery endpoint at startup that returns the canonical field list per kind, so we don't hardcode.

### 17. Migrate the ideas backlog to GitHub Issues

**User Story:** As the project maintainer, I want this markdown backlog tracked as GitHub Issues with labels and milestones, so that work-in-flight is visible from the PR side, ranking is mutable without diff churn, and assistants can link PRs to closing issues.
**Acceptance Criteria:**

* [ ] One GitHub Issue per current `ideas.md` entry (titles match the section heading, body = the section content).
* [ ] A `backlog` label applied to all migrated issues plus one of `feature` / `chore` / `bug` based on the entry's nature.
* [ ] Issues that map to deferred phases (Trading #8/#9, Economics v2 #16) get a milestone (`Phase 3`, `Phase 4`, `Economics v2`).
* [ ] Already-shipped entries (Vim navigation #1, sketchpad #2, Financials slide-in #3, Watchlist `:watch` add #5, etc.) are closed immediately with a comment linking the PR that delivered them.
* [ ] `ideas.md` is removed from the repo once migration is verified — single source of truth.

**Technical Notes:**

* `gh issue create --title ... --body-file <(awk ...) --label backlog,feature` from a small migration script. Don't paste by hand.
* For the shipped entries, `gh issue close <N> --comment "Shipped in #54"` after creation.
* Worth a dry run into a fork or a `backlog/*` label-prefixed batch before mass-creating in the real repo.

### 18. Delete an idea with `d` from the sidebar

**User Story:** As a sketchpad user pruning experiments, I want to press `d` on the highlighted idea in the `/ideas` sidebar to delete it, so I can clear out stale comparisons without reaching for the mouse.
**Acceptance Criteria:**

* [ ] On `/ideas`, with the sidebar pane focused and an idea highlighted via `j`/`k`, pressing `d` deletes that sketch.
* [ ] The deleted row is removed from the sidebar; the cursor stays on the same index (now pointing at what was the row below), or moves up if it was the last row.
* [ ] If the deleted sketch is the currently-loaded one, the chart pane clears and the next sketch in the list loads — or the empty state if no sketches remain.
* [ ] No mouse-only confirm dialog. A flash like "Deleted <name>" in the cmd-bar status is enough; the action is reversible only by re-creating, so don't paper over the destructive shape with friction.

**Technical Notes:**

* `DELETE /api/sketches/{id}` already exists from earlier work — no new endpoint.
* Extend `vimHandlers.ideas.deleteSelected` (it currently returns false on the sidebar pane and only handles the metric-row delete). Add a branch: if the focused pane is the sidebar, call the sketch-delete path; if it's the chart, keep the existing metric-delete behaviour.
* Mirror the watchlist `d` pattern (idea #12) — same look + flash message style.


