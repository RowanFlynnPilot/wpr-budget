# CLAUDE.md — wpr-budget ("Follow the Money")

Context for Claude Code sessions on this repo.

## What this is

A civic-transparency widget for **Wausau Pilot & Review** that visualizes the
**Marathon County** annual budget — where the money comes from, where it goes,
the per-department breakdown, the tax-levy/mill-rate story, other funds, and
outstanding debt. It was the first entity in the "Follow the Money" suite, now
joined by the **City of Wausau** and the **Wausau School District** — three
governments, three structurally different budgets, one shared chrome.

This is a grant-anchor project (accountability journalism) that pairs with the
existing Marathon Meetings tracker as a "civic transparency suite," and is also
advertiser-ready via a sponsor slot (built; hidden until enabled — see below).

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
| Wausau School District | school | `scripts/extract_school.py` | `public/wausau-school.json` | `SchoolLedger` |
| Your Tax Bill (overview) | taxbill | — (no extractor) | `public/wausau-city.json` (reuses the City's `tax_by_jurisdiction`) | `TaxBillOverview` |

The last entry is NOT a government — it's a cross-entity **overview**: a City of Wausau
homeowner's complete property-tax bill split across all four taxing jurisdictions
(city/county/school/technical college), each row clicking through to its entity. It
has no data file of its own; it reads the City book's `tax_by_jurisdiction` table
(the one place all four jurisdictions appear at one year, reconciled to the total).

`ChromeBar` is shared; `App` gates rendering on `data.id === activeId` so a body
is never handed the previous entity's data mid-switch.

Same pipeline pattern as the other WPR widgets, with one deliberate difference:

```
official budget PDF (downloaded by hand)
  -> scripts/extract_budget.py / extract_wausau.py / extract_school.py  (pdfplumber, local, yearly)
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

# Wausau School District (separate extractor, separate schema — see extract_school.py).
# Source = the district's "Annual Budget Book" PDF, linked from
# https://www.wausauschools.org/departments/business-services (the view link
# 302-redirects to a public finalsite CDN PDF). NOT BoardDocs — go.boarddocs.com/wa/
# psd401 is *Peninsula SD in Washington*, a search-collision trap. Raw source files
# live in the gitignored sources/ folder:
python scripts/extract_school.py sources/2026-Wausau-School-Budget.pdf public/wausau-school.json
# Optional trailing args = WISEdash `enrollment_certified_<yr>.zip` files (one per
# year); the extractor reads Wausau's districtwide headcount from each and emits the
# `enrollment` block. The committed file is built with five years (2021-22 → 2025-26):
python scripts/extract_school.py sources/2026-Wausau-School-Budget.pdf public/wausau-school.json \
       sources/enrollment_certified_2021-22.zip sources/enrollment_certified_2022-23.zip \
       sources/enrollment_certified_2023-24.zip sources/enrollment_certified_2024-25.zip \
       sources/enrollment_certified_2025-26.zip
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

### wausau-school.json schema (Wausau School District — separate again)

```
meta:           { entity, kind:"school", budget_year, fiscal_label, total_levy, mill_rate,
                  gross_expenditures, net_expenditures, gf_expenditures, gf_revenues }
funds[]:        { fund_no, name, revenues, expenditures, prior_revenues, prior_expenditures }
                # all-funds summary (Fund 10/27/20/38/39/49/50/73/80); reconciled to GROSS totals
gf_revenues[]:  { source, amount, prior }    # General Fund by source; sums to gf_revenues
gf_expenditures:{ total, by_object[], salary_lines[], benefit_lines[] }
                # by_object: {object, amount, prior} = Salaries/Benefits/Non-Salary Operating/
                # Transfers — sums EXACTLY to total. salary_lines/benefit_lines: {label, amount,
                # prior} detail (reconciled to their subtotals with a $1 tolerance for the book's
                # own rounding). This is the honest "where it goes": ~69% is people.
levy_by_fund[]: { fund, levy, prior_levy, mill_rate }   # 4 funds; sums to levy_total
levy_total:     { levy, mill_rate }
mill_bridge:    { base_rate, base_label, result_rate, result_label, factors[] }
                # the year-over-year mill-rate walk; factors: {factor, delta}; base+Σdelta == result
rate_history[]: { year, label, rate }        # equalized mill rate, 1968-69 → present (~58 yrs)
valuation_history[]: { year, value }          # equalized property value, 1975 → present (~51 yrs);
                # latest cross-checked against the levy page's "New Valuation"
debt:           { outstanding_principal, total_interest_remaining, total_principal_interest,
                  retirement[] }              # retirement: {year, principal, interest, total}
enrollment:     { years[], labels[], counts[], source }   # WISEdash districtwide headcount (Phase 2b)
                # present ONLY when enrollment_certified_<yr>.zip files are passed to the extractor;
                # SchoolLedger renders the Students section + per-student figures only if it exists
```

A Wisconsin school district is a THIRD kind of government: fund-accounted, levied
district-wide under a state revenue limit, with NO per-department levy (County) and
NO per-jurisdiction municipal split (City). Its honest "where it goes" is BY OBJECT
because the book budgets salaries centrally, not per school — per-school dollar lines
are tiny non-salary allocations and would mislead. Phase 1 (this) is from the budget
book alone, plus the equalized-valuation history (also in the book, overlaid on the
mill rate). **Phase 2 (not yet built)** layers in DPI per-student-vs-state benchmarks
+ a multi-year enrollment trend — needs DPI/WISEdash CSVs downloaded by hand (DPI 403s
datacenter IPs; the interactive Comparative-per-Member tool only has mill rate + tax
levy populated for Wausau, which the book already gives, so use the WISEdash bulk
Finance + Enrollment files instead). The book states current FTE membership (7,882
for 2025-26) for a per-student denominator.

## Frontend

- `src/App.jsx` — the ENTIRE UI in one file (~1,500 lines), one injected CSS
  string (no Tailwind / CSS files). `App` loads `entities.json` + the active
  entity's data (see Architecture) and routes to a body by kind: `Ledger`
  (County), `CityLedger` (City), `SchoolLedger` (School), or `TaxBillOverview`
  (the cross-entity Your-Tax-Bill view). **When no entity hash is set (bare URL /
  `#home` / unknown), `activeId` is null and App renders `Landing`** — the suite front
  door (hero + a "your whole tax bill ≈ $X" hook + a card per entity with its headline
  figure + the open-data/Meeting-Tracker strip). Landing fetches every entity's data
  file itself (deduped) for the card stats; cards call `onSelect(id)` to drill in, and
  the `ChromeBar` Home button (`onSelect(null)`) returns to it. Direct deep links like
  `#marathon-county` still skip the landing. `ChromeBar` is shared — a **two-tier** bar
  (brand + Share/FY on top, the entity switcher as its own full-width row beneath, so
  it scales past three entities), with a `navigator.share`-or-clipboard **Share**
  button that emits a canonical `#<activeId>` deep link (no personal data in the URL).
  Hooks are top-level in each body (no conditional hooks).
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
- **School (`SchoolLedger`) sections:** Where It Goes (GF spending-by-object /
  revenue-by-source toggle, plus a "show what salaries & benefits buy" reveal of
  the top salary+benefit line items) · Money Flow (recharts `Sankey`: revenue
  sources → GF → spending objects) · All Funds (by fund) · Over Time (dual-axis: the
  equalized mill rate ~58 yrs vs. the rising equalized property value ~51 yrs — the
  "growing base, falling rate" story — + a `.bridge` callout walking this year's
  rate change) · Students (5-yr WISEdash enrollment trend + general-fund spending per
  student; rendered only when the `enrollment` block is present) · Your Tax Bill
  (calculator + the school portion split across funds, same `taxbar` pattern as the
  City) · Debt · Methodology.
- **Shared features:** the "Your Tax Bill" calculator (`homeValue` state →
  estimated bill); the `Highlights` "What changed this year" lead band (rendered
  between masthead and subnav by the three government bodies — each computes its own
  3 items: levy/rate deltas + the biggest mover; the County mover EXCLUDES sign-flip
  revenue-returning offices to avoid the reclassification artifact); the `Methodology`
  component (JSON via link + CSV via `downloadCSV`) which also carries the `.suite-link`
  cross-link to the Central Wisconsin Meeting Tracker (`MEETING_TRACKER_URL`);
  accessibility (`:focus-visible`, `prefers-reduced-motion`, `aria-pressed` on
  toggles/chips, `role="img"` on the Sankey). Tax-levy values render in full dollars
  everywhere EXCEPT the levy chart y-axes ($M); the County dept-ledger levy uses
  compact on mobile via `.lg-only`/`.sm-only`.

### Sponsor surface (BUILT — hidden until enabled)

`SponsorSlot` renders a tasteful right-aligned "Presented by" line (name or logo,
`rel="sponsored"`, translatable via `sponsor.presentedBy`) in every masthead kicker
row + the landing hero. It is driven by `src/sponsors.json` and renders **nothing**
while `"enabled": false` (the current/shipped state). **To go live:** set
`enabled:true` and fill `title` (`name`, optional `url`, optional `logo` — an https
URL or a `public/`-relative path); `byEntity` can override the title sponsor per page.
Verified the enabled path renders + translates; the hidden state leaves the bundle and
UI unchanged. Keep it tasteful and clearly labeled; never interleave with data.

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

Everything below is **built, committed, pushed to `main`, and deployed** (working
tree clean as of hand-off; `npm run build` clean; last Pages deploy green). `main`
is the source of truth; pushing auto-deploys. The site has FOUR switcher views
(Marathon County, City of Wausau, Wausau School District, + the "Your Tax Bill"
overview) behind a suite **landing page** (the default front door), in **three
languages** (EN / ES / Hmoob). Raw source files (gitignored, in `sources/` + repo
root) needed to re-run extractors: `2026-Annual-Budget.pdf` + `2025-…` (County),
`2026-Wausau-Budget.pdf` (City), `sources/2026-Wausau-School-Budget.pdf` +
`sources/enrollment_certified_<yr>.zip` ×5 (School).

> **Next session — start here.** No half-finished code; the open items are
> WPR/editorial actions, not bugs: (1) a **fluent-speaker review of the Hmong** (it's
> AI-drafted, shipped behind a beta banner — corrections go in the `HMN` table of
> `src/i18n.jsx`); (2) **verify the chart-annotation seeds** (`src/annotations.json` —
> the School enrollment "consolidation" marker is DRAFT: confirm the year, add source
> URLs to both seeds); (3) the **sponsor surface** is built but hidden — flip
> `src/sponsors.json` `enabled:true` to go live. The only remaining un-built *idea*
> from the backlog is the **per-capita / per-household toggle**. Live at
> https://rowanflynnpilot.github.io/wpr-budget/ — verify the WordPress iframe embed
> still points where intended (the bare URL now opens the landing, not the County).

Done and shipped:
- ✅ County entity (FY2026) + 2025 history (department trend + total-budget delta).
- ✅ City of Wausau entity — full build (extractor `extract_wausau.py`, schema,
  `CityLedger` with all sections above).
- ✅ Wausau School District entity (Phase 1 + 2a + 2b) — extractor `extract_school.py`,
  schema, `SchoolLedger` (where-it-goes by object, Sankey, all funds, dual-axis
  mill-rate-vs-equalized-valuation over ~half a century + rate-change bridge, 5-yr
  enrollment trend + per-student spending, school-portion tax bill, debt). Logo
  `src/assets/wausau-school.jpg` — the district seal, the same avatar used in the
  Central Wisconsin Meeting Tracker (county/city/school avatars kept consistent).
- ✅ WPR brand chrome bar + logo-button entity switcher + per-entity masthead logos.
- ✅ Grant-pitch features: interactive tax-bill calculator (all), money-flow
  Sankey (City + School), Methodology + open-data (JSON/CSV) + accessibility pass.
- ✅ CI bumped off Node 20 (deploy uses Node-24 actions, build on Node 22).
- ✅ Complete tax-bill unifier (`TaxBillOverview`, a 4th "Your Tax Bill" switcher view):
  one calculator → a City of Wausau homeowner's whole bill split across all four
  jurisdictions, each clicking through to its entity. Two-tier `ChromeBar` + Share
  button + OG/Twitter social meta in `index.html` + a generated `public/og-image.png`
  (1200×630 editorial card). Switcher labels shortened ("…Budget" dropped).
- ✅ "What changed this year" lead band (`Highlights`) on all three governments, and a
  cross-link to the Central Wisconsin Meeting Tracker in each Methodology section.
- ✅ Multilingual (EN / ES / Hmoob) — i18n layer in `src/i18n.jsx` (`LangProvider`,
  `useStrings()` t-function with English fallback, localStorage persistence, sets
  `<html lang>`). Language `<select>` + Hmong **beta banner** in `ChromeBar`. Spanish
  is a real translation; **Hmong is AI-drafted, shipped in beta pending community
  review** (per the user's call). **FULLY TRANSLATED:** all chrome, nav, the
  what-changed band, and every body — County (`Ledger`), City (`CityLedger`), School
  (`SchoolLedger`), and `TaxBillOverview` — including masthead deks, stat labels,
  section kickers/titles/standfirsts, toggles, chart legends/tooltips, calculator,
  notes, and footers. Official department/fund/category names + numbers stay as
  published (not translated). Keys live in `src/i18n.jsx` (grouped: shared, `s.*`
  School, `c.*` City, `co.*` County, `tb.*` tax bill, `bal.*` balance, `wc.*`, etc.);
  each body does `const t = useStrings()` and calls `t("key", ...args)`. NOTES: i18n
  MUST be `.jsx` (contains JSX) — `.js` breaks esbuild; restart the dev server after
  renaming files (a stale vite process on the port serves a blank page). Adding an
  entity/section means adding its keys in all three language tables.
- ✅ Suite landing page (`Landing`) — the default front door (renders when `activeId`
  is null). Hero + combined-tax-bill hook + entity cards (logo, headline figure from
  live data, blurb) + open-data/Meeting-Tracker strip; fully translated (`lp.*` keys).
  Chrome gains a Home button. **Behavior change:** the bare Pages URL now shows the
  landing, not Marathon County — embeds wanting a fixed view should point at a hash
  (e.g. `…/wpr-budget/#marathon-county`).
- ✅ Chart annotations — EDITORIAL markers on time-series charts, curated in
  `src/annotations.json` (NOT extracted; keyed entity→chart/section→[{x, tag, note,
  source}] with `{en,es,hmn}` labels). Imported in App, passed via `chrome.annotations`;
  `resolveNotes()` picks the active language, `ChartNotes` renders the list, and bodies
  drop `<ReferenceLine>` markers into the chart. Charts with no annotations render
  unchanged (graceful absence). SEEDED on the School over-time chart (2022 referendum,
  confident) + enrollment chart (consolidation, **DRAFT — verify year + add source**).
  County/City not seeded: the County story is a trend (no clean point event) and the
  City's ARPA/SAFER cliff is forward-looking (2027, off the historical chart — it stays
  as the levy-section callout). To add one: append to `annotations.json` (and render
  `<ReferenceLine>`/`<ChartNotes>` in that chart, as the School body shows). Hmong
  captions are AI-drafted; sources should be added before relying on them publicly.
- ✅ Cloudflare Web Analytics beacon live in `index.html` (token is the shared
  `rowanflynnpilot.github.io` site, also used by the Meeting Tracker). Privacy-first,
  no cookie banner; CF groups by hostname, so filter the dashboard by page path
  (`/wpr-budget/`) to isolate this tool from the other suite projects.

## Next steps / backlog

- **Sponsor surface** is BUILT but hidden — flip `src/sponsors.json` `enabled:true`
  and fill `title` to go live (see the Sponsor surface section above). No build work
  left unless adding richer per-section placements.
- **County prior-year history:** only 2025 is ingested. 2021–2024 use an OLDER
  county book format with NO Appendix E/F tables, so they are NOT extractable
  (loud failure). Don't retry unless newer-format PDFs surface. (City is single-
  year; its multi-year data — levy 10-yr, personnel 11-yr — comes from within the
  2026 book.)
- **School Phase 2c (only piece left):** the per-student-vs-**state-average** spending
  comparison (the distinctive "is my district efficient?" framing). Needs a statewide
  per-member finance file — NOT in WISEdash's topic downloads (that's enrollment/
  assessment/etc.); it lives in SFS: https://dpi.wi.gov/sfs/statistical/cost-revenue/comparative
  ("Comparative Cost Per Member" spreadsheet). May be limited — the interactive
  Comparative-per-Member tool only had mill rate + tax levy for Wausau (code 6223).
  The Students section already shows Wausau's own per-student figure ($15,463 GF /
  student) with a placeholder line for the state comparison. (Phase 2a valuation
  overlay + Phase 2b enrollment trend are DONE and shipped.)
- **Editorial follow-ups (not code/bugs):** human review of the Hmong (`HMN` table in
  `src/i18n.jsx`); verify chart-annotation seeds + add source URLs (`src/annotations.json`);
  decide whether to enable the sponsor surface (`src/sponsors.json`).
- Enhancements floated but NOT built: **per-capita / per-household toggle** (the main
  remaining one); County money-flow Sankey; City personnel beyond the chart; treemap.
  (Recharts 2.x→3.x migration is optional, nothing broken.) DONE since first floated:
  "what changed this year", chart annotations, multilingual, landing page, sponsor
  surface, tax-bill unifier, share/social, analytics.

## Gotchas for the next session

- **Extractors are SLOW** (60–120s+; they re-scan the whole PDF). When iterating,
  cache page text to a temp JSON and develop parsers against that.
- **City book quirks:** mixed-case decorative headers (`find_page` is
  case-insensitive); long names shortened for the Sankey (`SANKEY_SHORT`); some
  pages reverse-render decorative text — target the clean data lines.
- **School extractor quirks (`extract_school.py`):** fund detail tables (revenue/
  expenditure) span multiple pages AND repeat the same subtotal labels across funds,
  so it uses `find_section` (contiguous run from the first `FUND 10`+title hit), not
  `find_page`. The book has small source-rounding artifacts: salary/benefit line
  items sum $1 off their printed subtotal, and the debt "total" column a few dollars
  off — handled by `reconcile_within(tol)`, while the integrity anchors (by-object →
  GF total; debt principal) reconcile EXACTLY. Salary lines carry a trailing budget
  flag ("Teachers E", "…Teachers R") that gets stripped. The current rate-history
  row has a `***` footnote between year and rate (regex allows it) — miss it and
  `budget_year` comes out a year low. The valuation-history page splits the leading
  digit off every value ("5 24,920,300" = 524,920,300) and lays two columns side by
  side — the token-walking parser rejoins them and the latest year is cross-checked
  against the levy page's "New Valuation". `find_page` needles for the rate-history
  and valuation pages need a second term (e.g. "(DECREASE)") to beat the table-of-
  contents line. The summary `print` avoids non-cp1252 chars (Windows console).
- **Switching entities** must gate on `data.id === activeId` (App) or a body
  briefly gets the other entity's schema and crashes — already handled, keep it.
- **recharts Sankey** link tooltip data is nested at `payload[0].payload.payload`
  (source/target are resolved node objects there).
- One CSS file, injected as a string — search the `CSS` template literal.
- **Social cards / OG:** this is a client-rendered SPA on GitHub Pages, so crawlers
  only read the static `index.html` meta — per-page OG images can't vary without
  prerendering. There's ONE suite card at `public/og-image.png` (a 1200×630 editorial
  card generated locally with PIL — regenerate with the same script if branding
  changes). `og:image`/`twitter:image` use absolute Pages URLs.
- **Tax-bill unifier scope:** `TaxBillOverview` is specifically a *City of Wausau*
  resident's bill (that's whose `tax_by_jurisdiction` the City book carries). Other
  municipalities/towns in the county would need their own jurisdiction splits — a
  clear future extension. Jurisdiction→entity mapping is `billEntityFor()`.
