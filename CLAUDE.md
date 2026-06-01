# CLAUDE.md — wpr-budget ("Follow the Money")

Context for Claude Code sessions on this repo.

## What this is

A civic-transparency widget for **Wausau Pilot & Review** that visualizes the
**Marathon County** annual budget — where the money comes from, where it goes,
the per-department breakdown, the tax-levy/mill-rate story, other funds, and
outstanding debt. It is the first entity in a planned "Follow the Money" suite;
the **City of Wausau** is the intended second entity (format not yet verified).

This is a grant-anchor project (accountability journalism) that pairs with the
existing Marathon Meetings tracker as a "civic transparency suite," and is also
advertiser-ready via a deferred sponsor slot (see below).

## Architecture

**Multi-entity suite.** The tool now serves more than one government. `App` reads
`public/entities.json` (the manifest), then the active entity's data file, and
routes to that entity's body component. A switcher in the chrome bar (and the URL
hash, e.g. `#wausau-city`) chooses the entity. Each entity has its own extractor,
data file, schema, and body — they deliberately do NOT share a schema, because a
county (per-department tax levy) and a city (fund-based, no per-department levy)
are structurally different governments.

| Entity | kind | extractor | data file | body |
|---|---|---|---|---|
| Marathon County | county | `scripts/extract_budget.py` | `public/marathon-county.json` | `Ledger` |
| City of Wausau | city | `scripts/extract_wausau.py` | `public/wausau-city.json` | `CityLedger` |

`ChromeBar` is shared; `App` gates rendering on `data.id === activeId` so a body
is never handed the previous entity's data mid-switch.

Same pipeline pattern as the other WPR widgets, with one deliberate difference:

```
official budget PDF (downloaded by hand)
  -> scripts/extract_budget.py / extract_wausau.py   (pdfplumber, run locally, yearly)
  -> public/<entity>.json        (committed to the repo)
  -> src/App.jsx                 (React + Vite, fetches entities.json + the entity file)
  -> GitHub Pages                (built + deployed by .github/workflows/deploy.yml)
  -> WordPress iframe embed
```

**The difference: this is NOT a cron scraper.** Budget data changes once a year,
so there is no scheduled GitHub Action fetching anything. The data pipeline is a
**manual annual ingest**: when a new budget is adopted, download the PDF, run the
extractor, commit the new `budget.json`. This also sidesteps the county site's
Akamai datacenter-IP block (the same class of block that broke Whisper on
Marathon Meetings) — downloading the PDF by hand from a browser avoids it
entirely, so **no Webshare proxy is needed**.

## Data pipeline — regenerating budget.json

```bash
# 1. Download the latest "Approved Budget" PDF by hand from:
#    https://www.marathoncounty.gov/about-us/annual-budget
#    (curl/wget from a server IP gets a 403 from Akamai — use a browser.)
# 2. Run the extractor:
pip install -r scripts/requirements.txt
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/marathon-county.json

# Multi-year: pass prior-year "Adopted Budget" PDFs as trailing args. The FIRST
# PDF drives every detailed section; each prior PDF contributes only the slice
# `history` needs (its Appendix E/F tables) via extract_history_slice, keyed by
# year. The committed county file is built from 2026 + 2025:
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/marathon-county.json \
       2025-Annual-Budget.pdf

# City of Wausau (separate extractor, separate schema — see extract_wausau.py):
python scripts/extract_wausau.py "2026-Wausau-Budget.pdf" public/wausau-city.json
```

**Prior-year format limitation.** Only the **2025 and 2026** books use the
Appendix E/F detailed-table layout the extractor needs. The **2021–2024** books
are an older, chart-and-summary format (~141 pp) with **no Appendix E/F tables**,
so per-department/per-fund history cannot be extracted from them; passing one as
a trailing arg fails loud at the `APPENDIX E:` lookup. Each prior year is taken
from its own adopted book (the apples-to-apples basis); the county occasionally
restates a prior year in the newer book for reorganizations (for 2025→2026, 18
of 20 departments matched exactly, County Treasurer and Administration differed),
so a cross-book department line can diverge slightly from the ledger's "vs '25"
column. The "Over Time" department chart omits revenue-returning offices
(negative levy) to avoid reclassification artifacts.

The extractor locates tables by section marker (robust to page-number drift
year to year) and **reconciles** parsed rows against the budget's own printed
totals — it raises on any mismatch rather than emitting silently-wrong numbers.
It targets the **current** budget-book layout. If a future year's PDF changes
the General Fund summary or debt page format, those two parsers are the likely
break points; the failure will be loud (a thrown error or a missing-section
error), not silent.

### budget.json schema

```
meta:            { entity, budget_year, adopted, tax_levy, tax_rate, total_expenditures }
general_fund:    { expenditures[], revenues[] }   # each: category, actual_prior, budget_current, proposed_next, pct_change
departments[]:   department, tax_levy, operating_revenues, operating_expenditures,
                 personnel_expenditures, prior_tax_levy, levy_difference
funds[]:         fund_no, name, tax_levy, operating_revenues, operating_expenditures, personnel_expenditures
levy_history[]:  year, levy, rate
homeowner_impact[]: year, avg_value, tax_rate, tax_amount, pct_change_bill
debt[]:          series, outstanding
history:         { years[], totals{}, departments[], general_fund:{expenditures[],revenues[]} }
                 # multi-year ADOPTED figures merged across the PDFs passed to the
                 # extractor. totals: {<year>:{total_expenditures,tax_levy,tax_rate}};
                 # departments[]: {department, adopted:{<year>:tax_levy}};
                 # general_fund blocks: {category, adopted:{<year>:proposed_next}}.
                 # With one PDF, each series holds a single year; prior-year PDFs
                 # fill earlier years losslessly. The "Over Time" department chart
                 # and the masthead Total-budget delta render only once there are
                 # >= 2 years (history.years / history.totals respectively).
```

Identity worth knowing for the UI: per department,
`operating_expenditures + personnel_expenditures == tax_levy + operating_revenues`
(total spending = levy support + revenue raised). Some departments (County
Treasurer, Register of Deeds) have a **negative** tax_levy because they return
more revenue than they cost; the UI handles negatives.

> The committed `public/budget.json` is the **real, reconciled FY2026
> extraction** — a clean single-year file produced by running the extractor on
> `2026-Annual-Budget.pdf`. (It is no longer the mixed-year dev fixture; there is
> no `_dev_note`.) Re-running the extractor on the same PDF reproduces it
> byte-for-byte.

### wausau-city.json schema (City of Wausau — separate from the County)

```
meta:           { entity, kind:"city", budget_year, total_expenditures, tax_levy,
                  gf_expenditures, gf_revenues }
expenditure_categories[]: { category, current, prior }      # all funds, by category
general_fund:   { expenditures[], revenues[] }              # each: category, prior, proposed, pct_change
levy_history[]: { year, levy, allowable, exception }        # levy-limit table; exception = amount over basic limit
tax_by_jurisdiction: { rate_years[], rows[], total }        # rows: {jurisdiction, rates:{<year>:rate}}; rates per $1,000
debt:           { outstanding, total_interest_remaining, pct_of_limit, retirement[] }  # retirement: {year,principal,interest,total}
personnel:      { years[], total[], rows[] }                # rows: {department, fte[]} — ALL arrays newest-first
tif:            { valuation_growth[], developer_payments[], levy_decrease }
```

The City has NO per-department tax levy (it levies city-wide and funds
departments from the General Fund), so its schema and body deliberately differ
from the County's.

## Frontend

- `src/App.jsx` — the ENTIRE UI in one file (~1,500 lines), one injected CSS
  string (no Tailwind / CSS files). `App` loads `entities.json` + the active
  entity's data (see Architecture) and routes to a body by kind: `Ledger`
  (County) or `CityLedger` (City). `ChromeBar` (brand + logo-button entity
  switcher) is shared. Hooks are top-level in each body (no conditional hooks).
  Charts use `recharts`; icons `lucide-react`; sparklines, the Sankey nodes, and
  the tax-bill stacked bar are hand-rolled SVG/CSS.
- Aesthetic: editorial / public-ledger. Fraunces (display) + Public Sans (data),
  warm newsprint, hairline rules, tabular numerals. Keep this direction.
- **County (`Ledger`) sections:** Where It Goes (GF spending/revenue toggle +
  3-yr sparklines, sorted largest-first) · Departments (sortable levy ledger,
  expandable) · Over Time (10-yr levy-vs-mill-rate ComposedChart + a department
  Amounts/Change comparison once `history` has ≥2 years) · Your Tax Bill
  (home-value calculator + dual-axis mill-rate-vs-bill chart) · Funds · Debt ·
  Methodology.
- **City (`CityLedger`) sections:** Where It Goes (GF dept/revenue toggle) ·
  Money Flow (recharts `Sankey`: revenue → GF → departments) · All Funds (by
  category) · Over Time (10-yr levy bars) · Workforce (11-yr FTE, one department
  at a time via a chip picker) · Your Tax Bill (calculator + property-tax-by-
  jurisdiction split with hover tooltip) · Development (TIF) · Debt · Methodology.
- **Shared features:** the "Your Tax Bill" calculator (`homeValue` state →
  estimated bill); the `Methodology` component (JSON via link + CSV via
  `downloadCSV`); accessibility (`:focus-visible`, `prefers-reduced-motion`,
  `aria-pressed` on toggles/chips, `role="img"` on the Sankey). Tax-levy values
  render in full dollars everywhere EXCEPT the levy chart y-axes ($M); the County
  dept-ledger levy uses compact on mobile via `.lg-only`/`.sm-only`.

### Sponsor surface (deferred — not yet built)

Intended slot is the masthead kicker row (search `sponsor slot` in App.jsx).
Plan: a "Presented by" title-sponsor logo/line there, optionally a per-section
sponsor. Keep it tasteful and clearly labeled; do not interleave with data.

## Dev / deploy

```bash
npm install
npm run dev      # local dev (BASE_URL = /)
npm run build    # production build to dist/ (BASE_URL = /wpr-budget/)
```

- `vite.config.js` `base` must equal the Pages repo path (`/wpr-budget/`). It is
  the only place the repo name appears; the data fetch uses `import.meta.env.BASE_URL`.
- Pushing to `main` triggers `.github/workflows/deploy.yml` (build + deploy to
  Pages). Enable Pages → "GitHub Actions" in repo settings once.
- Embed on WordPress via iframe pointing at the Pages URL.

## Design principles (house style)

Surgical changes; no fallbacks / one correct path; fail fast (throw on bad
preconditions) rather than defensive runtime checks; one source of truth for
data; separation of concerns. Match the existing editorial aesthetic.

## Current state (as of last session — read this first)

Both entities are LIVE and deployed. `main` is the source of truth; pushing to
it auto-deploys. Local PDFs (`*.pdf`, gitignored) needed to re-run extractors:
`2026-Annual-Budget.pdf` + `2025-…` (County) and `2026-Wausau-Budget.pdf` (City).

Done and shipped:
- ✅ County entity (FY2026) + 2025 history (department trend + total-budget delta).
- ✅ City of Wausau entity — full build (extractor `extract_wausau.py`, schema,
  `CityLedger` with all sections above).
- ✅ WPR brand chrome bar + logo-button entity switcher + per-entity masthead logos.
- ✅ Grant-pitch features: interactive tax-bill calculator (both), money-flow
  Sankey (City), Methodology + open-data (JSON/CSV) + accessibility pass (both).
- ✅ CI bumped off Node 20 (deploy uses Node-24 actions, build on Node 22).

## Next steps / backlog

- Build the **sponsor surface** (still unbuilt — search `sponsor slot` in App.jsx;
  masthead kicker row; "Presented by" title + optional per-section sponsor).
- **County prior-year history:** only 2025 is ingested. 2021–2024 use an OLDER
  county book format with NO Appendix E/F tables, so they are NOT extractable
  (loud failure). Don't retry unless newer-format PDFs surface. (City is single-
  year; its multi-year data — levy 10-yr, personnel 11-yr — comes from within the
  2026 book.)
- Possible enhancements floated but not built: per-capita / per-household toggle;
  auto "what changed this year"; County money-flow Sankey; City personnel beyond
  the chart; chart annotations; treemap. (Recharts 2.x→3.x migration is optional,
  nothing broken.)

## Gotchas for the next session

- **Extractors are SLOW** (60–120s+; they re-scan the whole PDF). When iterating,
  cache page text to a temp JSON and develop parsers against that.
- **City book quirks:** mixed-case decorative headers (`find_page` is
  case-insensitive); long names shortened for the Sankey (`SANKEY_SHORT`); some
  pages reverse-render decorative text — target the clean data lines.
- **Switching entities** must gate on `data.id === activeId` (App) or a body
  briefly gets the other entity's schema and crashes — already handled, keep it.
- **recharts Sankey** link tooltip data is nested at `payload[0].payload.payload`
  (source/target are resolved node objects there).
- One CSS file, injected as a string — search the `CSS` template literal.
