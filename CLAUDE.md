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

**Multi-entity suite.** The tool now serves more than one government. The entity
manifest is bundled (`src/entities.json`, imported statically — no runtime
fetch); `App` fetches the active entity's data file (through a session-level
promise cache in `src/data.js`) and routes to that entity's lazy-loaded body.
**The URL hash is the single source of truth for navigation**:
`#<entity-id>[~<edition>][/<section>]` (e.g. `#wausau-city/debt`,
`#marathon-county~2027-proposed/departments`). The chrome-bar switcher,
subnav section links, and browser back/forward all funnel through `hashchange`;
the scroll-spy mirrors the reading position into the hash via `replaceState`,
so the address bar is always a valid deep link.

**Sources (manifest).** Every entity and edition carries `source: {title, url}` — the
official document its numbers come from (verified links from each government's own
budget page; DOR's bulletin page for the tax bill). App passes it as `chrome.source`;
Methodology's "Source." step and every footer link it via `SourceLink`. Update the
URL whenever a new book is ingested. Corrections go to `CORRECTIONS_URL` (WPR's contact
page), linked from Methodology and the Hmong beta banner.

**Editions (budget season).** An entity may list `editions` in the manifest —
the next year's PROPOSED book, served at `#<entity>~<edition-id>` alongside the
adopted book (the bare `#<entity>` stays adopted, so embeds/links never change
underneath anyone). Each edition: `{id, year, data, updates, hearing, vote,
milestones, calendar_source, source}` — the dates and `milestones` (`[{date,
what}]`, what ∈ education/qa/hearing/amendments/committee/vote) are curated from
the book's budget-process timeline (Appendix K in 2027) and drive the edition's
**"Have your say"** section (`#<route>/say`: the calendar to the vote + speak at
the hearing / tell your supervisor / get the result, from the entity's
`participate` links: county agendas, MyVote's "My Elected Officials" — the
county's own "Who is my supervisor?" link — and the members page). `updates` is a
hand-edited change log, `public/<entity>-<year>-updates.json` =
`[{date, body, summary, url|null}]` (the sibling City tool's format): editors add
an entry when a committee or the board amends the proposal and push; the
"Changes since the proposal" box renders under the Proposed banner once it has
one. App fetches it with the edition (`extra.updates`). check-data validates the
calendar, the links and every log entry. `chrome` carries `activeId` (entity), `routeId` (entity+edition, for
deep links/subnav/Share), `edition` (or null) and `dataFile`; App gates on the
ROUTE so an edition switch never shows the other edition's numbers.
`EditionBanner` (ui.jsx) renders the "Proposed — not yet adopted" band on the
edition and a slim pointer to it on the adopted book; Landing shows the same
pointer; `entity-pages.mjs` writes a share stub `/<entity>-<edition>/`. The
edition strings (`ed.*`, `co.dekProposed`, `foot.proposedAmend`) name the
County Administrator/County Board — a City edition needs its own wording
(Mayor/Common Council). **Retiring an edition after adoption:** re-run the
extractor on the APPROVED book into `public/marathon-county.json` (with the
prior adopted books as history), delete the `editions` entry, the proposed
JSON, its updates file, its `scripts/verify.py` BUILDS line and its share card
(`public/og-<entity>-<edition>.png`; rerun `python scripts/og_cards.py` so
og-cards.json drops it). A next-year proposal covered by a SIBLING tool instead
gets a `companion: {year, title, url}` on the entity (the City's 2027 budget →
WPR's page for `wpr-city-budget`): `EditionBanner` and the landing point there.
Remove it once that budget is adopted. Each entity has its own
extractor, data file, schema, and body — they deliberately do NOT share a
schema, because a county (per-department tax levy) and a city (fund-based, no
per-department levy) are structurally different governments.

| Entity | kind | extractor | data file | body |
|---|---|---|---|---|
| Marathon County | county | `scripts/extract_budget.py` | `public/marathon-county.json` | `Ledger` |
| City of Wausau | city | `scripts/extract_wausau.py` | `public/wausau-city.json` | `CityLedger` |
| Wausau School District | school | `scripts/extract_school.py` | `public/wausau-school.json` | `SchoolLedger` |
| Your Tax Bill (overview) | taxbill | `scripts/extract_dor.py` (state data) | `public/marathon-tax-districts.json` | `TaxBillOverview` |

(The City body also loads `marathon-tax-districts.json`, via the manifest's
`with` key, for its own tax-bill section.)

**State taxing-district data (DOR).** `extract_dor.py` reads the Wisconsin DOR
"Town, Village and City Taxes" workbook (`sources/dor-tvc25.xlsx`, from
https://www.revenue.wi.gov/Pages/Report/tvc-bulletin.aspx — posted each June, no
download block) into `public/marathon-tax-districts.json`: all 61 Marathon County
municipalities with levies by government, full/TIF-out values, assessment level,
school-levy credit, each school district's share of value + levy (28
municipalities span more than one district), and its technical college(s).
Header text is checked per column; sums reconcile within $1 per part (DOR rounds
each part to the dollar); and a **method check** requires the tool's bill-rate
formula to reproduce DOR's own published effective rate for every
single-school-district municipality (33 of them; within 1¢ per $1,000). DOR's
rate also spreads SPECIAL-DISTRICT taxes (sanitary/lake districts) over the
whole municipality; the bill leaves them out (only parcels in the district pay)
and they share "other taxes" with TIF increment (which DOR's rate excludes), so
where "other" isn't zero the check is a bracket: bill rate ≤ DOR's ≤ bill rate +
all of "other", ±1¢ (found on the neighbors — Town of Ainsworth, Langlade:
$9.006 + $0.150 = $9.16; statewide every single-district municipality fits but
one cent's rounding in Calumet). Zero-value parts (Milladore's sliver of Portage
County) are skipped on purpose. `extract(..., county=)` builds any county;
`extract_neighbors` the eight around Marathon (Lincoln, Langlade, Shawano,
Waupaca, Portage, Wood, Clark, Taylor) into `public/neighbor-tax-districts.json`
= {meta:{source, source_url, tax_year, credits, counties}, counties:[{county,
municipalities}]} — same municipality schema; TECH_COLLEGES now names every code
those counties use (from DOR's LGSDIST302WI report, Tech section).

**Every tax-bill view uses this one source and ONE basis — per $1,000 of FAIR
MARKET value** (DOR "full" value; on every WI tax bill as "Est. Fair Mkt.";
`calc.fmvHint` says so under every calculator). Assessed values are NOT
comparable across municipalities (ratios here run 0.54 → 1.02), and the County's
and School District's own published rates were always equalized (= fair market)
rates — the County calculator had been asking for "assessed value", which
understated a low-ratio town's county tax by up to ~46%. `billRates(muni,
schoolCode)` in ui.jsx: county/municipal/college levy ÷ TIF-out value; school =
the district's levy ÷ its value, minus the school levy credit ÷ ALL value (TIF
increment included); two-college towns (Day, Green Valley, McMillan) get the
combined college levy, flagged. `TaxBillOverview` = a municipality select (61,
grouped; split-county parts labeled) + a school-district toggle where needed;
both choices persist in localStorage (never URLs). The City body's tax section
and the Landing hook use the same function (City of Wausau, `WAUSAU_CITY_DOR`).
Consequence: "a $200,000 home" now means market value. The City book's
`tax_by_jurisdiction` is still extracted (published open data) but no longer
drives the UI — which also means a City PROPOSED edition no longer needs it.

**Every bill is the bill AFTER the state's credits (since 2026-10-10).** The
school levy credit is in the rate (above); the other two come from DOR's
"Credit Amount" reports for the same bills (`sources/dor-2025lotcr.pdf`,
`sources/dor-2025fdcred.pdf`, from https://www.revenue.wi.gov/Pages/Report/lgc-mcv.aspx
and fdc-mcv.aspx, posted each Nov. 20): each school district carries
`credit_rate` (DOR's equalized school tax rate, levy / TIF-out value, district-
wide) and `meta.credits` the year's maximum credit values ($27,000 lottery &
gaming, $9,000 first-dollar for bills payable 2026). Credit = credit_rate ×
min(max value, home value); the lottery credit only for a primary home
(`usePrimaryHome`, a checkbox on both full tax-bill views; the #card and the
landing assume one), the first-dollar credit for any parcel with a building.
`netBill`/`stateCredits` in src/taxmath.js. The extractor proves every printed
rate is levy/value, every printed credit is rate × max to the cent, both reports
agree, and every municipality / district pair has a line. Wausau's $200,000
home: $3,609 levied − $178 lottery − $59 first-dollar = **$3,372**; with credits
the dearest place for that home is the City of Wausau and the cheapest the Town
of Ringle ($1,693). Still not subtracted (and said so): special-district taxes
(sanitary/lake districts).

**Whole dollars that add up (`billDollars` in src/taxmath.js).** Every bill shown
in dollars — the split, the receipt, the #card — goes through it: lines take
largest-remainder rounding to the rounded levy, credits round so levied −
credits = the rounded net (the headline), and the first-dollar credit doesn't
move with the primary-home box (the lottery credit takes the odd dollar).
Rounding each line alone had left 34 of 100 municipality/district bills $1 off
themselves. check-data proves it for every pair at three values, both states.

**"Your tax receipt" (`#your-tax-bill/receipt`, `src/receipt.js`).** The bill
itemized down to what each government's share pays for, split the way its own
budget spends its property tax: County by fund and, within the General Fund, by
positive department levy; City by GF department (`General Property Taxes` share)
with the rest of the levy as "debt and other funds"; School by levy fund and,
within the GF, by object. Only the suite's three governments are itemized (any
other municipality/district = one line + "isn't in this tool yet"). The Tax Bill
view loads the three budgets via its manifest `with` (county/city/school).
check-data proves each split sums to 1.

**The map (`#your-tax-bill/compare`, above the ranking).** `CountyMap` shades all
61 municipalities by the Ranking's own figures (the reader's value, primary-home
choice and, for their own municipality, school district; others by their largest
district, the range in the tooltip). ONE continuous ramp, min → max — deliberately
unclassed: 40 of 61 bills sit within ~$500, so any break would split near-
identical towns (quantile breaks made $1,918 vs $2,057 look like different worlds).
Mouse/touch pick a place (no scroll); the ranked list is the keyboard/screen-
reader equivalent (the SVG is one labeled image). The caption's "why" (the
municipality's own levy: median $264 town / $749 village / $1,283 city on a
$200,000 home; county share identical, school similar) is computed live.
Geometry: `public/marathon-map.json` from `scripts/extract_map.py` — the Census
cartographic boundary file of WI county subdivisions (= cities/villages/towns),
`sources/census-cousub-2025/cb_2025_55_cousub_500k.zip`, boundaries as of Jan 1
2025 (same date as DOR's assessments). Matched to DOR by type + name one to one;
equirectangular at the county's central latitude; integer grid 2000 wide, no
simplification (2,700 vertices total), spikes from rounding removed. The
extractor proves no overlaps, no gaps, and that the outline built from the
grid's once-used edges encloses the county (neighbors share borders exactly).
A new DOR year that adds/renames a municipality fails check-data until the map
is re-extracted (use the next GENZ vintage).

**Vs. last year** (with.prior = `public/marathon-tax-districts-2024.json`, the
same extractor on DOR's 2024 workbook + credit reports; `priorOf` in taxmath.js
finds the same municipality/district, failing loud). Shown on the SAME VALUE —
in effect the tax rate's change — under the calculator ("−$137 (−3.9%) from 2024
taxes"), per government on the receipt (billDollars of the prior parts + prior
credits), and as the map's "Change since 2024" mode (diverging CHANGE_RAMP in
ui.jsx: teal fell → newsprint → rust rose, symmetric around 0; teal not pure
green so red-green colorblind readers can tell the sides apart). Because values
rose almost everywhere (median +11.4%; Wausau +4.1%), the bill's note gives the
municipality's own value change and what a home that kept pace paid (Wausau:
~$1 different, not −$137) — never drop that context.

**Front-end floor (2026-10-10 polish):** no visible text under 12 px and no
non-inline tap target under 24 px — scripts/e2e.py enforces both on a phone
(home, Tax Bill, County, #card); chart ticks and Sankey labels are 12 too (the
City Sankey's left margin is 186 to fit "General Property Taxes $24M"). Fonts:
`scripts/fonts.py` builds `src/assets/fonts/fraunces-opsz.woff2` (Fraunces
subset to the site's characters, weights 400–700, opsz kept — 67 → 58 kB, an
@font-face at the top of styles.css) and `src/wordmark.json` (the WPR wordmark
as an SVG path, HarfBuzz-shaped; ChromeBar draws it) — Playfair (22 kB) is no
longer loaded; the Fontsource packages are devDependencies (the script's
source). The Tax Bill view has a SubNav like the other bodies (TB_SECTIONS).

**Three reader-service sections after the map** (Tax Bill view):
`Neighbors` (#neighbors, "The same home, across the county line": the nine
counties sorted by typical/median bill, each a strip from cheapest to dearest
municipality on one scale, a dot for its largest place, the reader's pick on
Marathon's row; loaded via the manifest `with.neighbors`); `AssessmentCheck`
(#assessment: assessed value from the bill ÷ the bill's average assessment
ratio — prefilled with DOR's two-decimal level, editable because each year's
bill prints its own — = implied market value, vs the home value above: > 10%
over the municipality's average = "high", the band Wisconsin's assessment
standard uses; Open Book / Board of Review (48-hour notice, PA-115A complete,
evidence) + DOR's PB-060 guide and PA-115A links; the assessed value is never
stored); `KeyDates` (#dates: the County edition's hearing/vote while ahead,
"December" bills and "Spring" Open Book/BOR placed in the timeline by season,
installments to the right treasurer — City of Wausau collects its own Jan 31 /
Apr 30 / Jul 31, elsewhere Jan 31 local and Jul 31 County Treasurer (Marathon
County Treasurer's "Dates to remember") — each its next occurrence from today;
an .ics made on the device for the dated ones; WPR newsletter link tagged
utm_content=key-dates. The tool can't promise WPR emails deadline reminders —
the copy says "votes and tax news"; a real reminder list is WPR's to set up).
MoneyInput shows an EMPTY box for 0 (typing in front of a "0" had turned 150,000
into 1,500,000 — caught by the Playwright run).

**Zoom and location (src/mapgeo.js).** "Zoom to the Wausau area" animates the
map's viewBox (420 ms; instant under reduced motion) to `WAUSAU_AREA` — the
urban core (Wausau, Schofield, Rothschild, Weston), padded and given the map's
proportions so the figure never resizes; zoomed, every city/village in view is
named (towns share names with them — tooltip only), most populous first, and a
layout effect hides any name that would overlap one already placed (the pick's
label always wins); the scale bar picks 10/5/2/1 miles. NOTE the browser pane
throttles requestAnimationFrame (~1–3 fps) when not being painted, so the zoom
can look stuck there — it isn't; a visible browser runs it at full rate.
**"Use my location"** (`UseLocation`, under step 1): `navigator.geolocation` →
`locate(map, lon, lat, max(accuracy, 300 m))` in the browser (meta.geo is the
projection) → sets the municipality, offers the neighbors whose line is within
that distance as one-tap switches, and says when the fix is only approximate
(> 2 km) or outside the county. Nothing is sent or stored; the About privacy
paragraph says so. check-data proves every municipality's own label point
(as lon/lat) locates to it and a point outside the county to none. A WordPress
embed of the full tool needs `geolocation` in its iframe `allow` (README).

The same map appears in two more places, all from ONE set of pieces:
`muniBills` (src/taxmath.js — each municipality's bill, largest district unless
it's the reader's own), `rampColor`/`RAMP` + `CountyShapes` (ui.jsx — chart-free,
eager) and the ramp's stops in `src/map-ramp.json` (read by og_cards.py too).
(1) The **landing**: the statement box's third row (`LandingMap`) — a $200,000
primary home, the two ends of the range pinned, the row linking to the Tax Bill
map; its box holds the map's aspect ratio while data loads (Landing fetches the
map through the cache with the entity files). (2) The **Tax Bill share card**
(og-your-tax-bill.png, also every town page): og_cards.py draws the same
choropleth with Pillow (even-odd masks, 3x supersampled) and records every
municipality's bill + the boundaries' date in og-cards.json `map`; check-data
recomputes them with muniBills (stale card = failed deploy) and FAILS if the
map's extremes stop being the printed range (an extreme in a municipality's
smaller school district — a display decision to make, not to paper over).

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
     (shared helpers + --cache page-text layer in scripts/lib.py;
      scripts/verify.py re-extracts all three and byte-compares vs the committed JSON)
  -> public/<entity>.json        (committed to the repo)
  -> src/App.jsx                 (React + Vite; bundled manifest, fetches the entity file)
  -> GitHub Pages                (built + deployed by .github/workflows/deploy.yml;
                                  npm run build also writes per-entity share-page stubs)
  -> WordPress iframe embed      (auto-height postMessage — see Dev / deploy)
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

# ALL extractors take --cache: page texts are cached in gitignored sources/
# (_pages_<stem>.json, keyed on the PDF's size+mtime), so re-runs take seconds
# instead of minutes. Shared helpers live in scripts/lib.py (money, load_pages,
# find_page/find_first/find_section, reconcile, write_json); parsers + schemas
# stay per-entity by design.
#
# After ANY extractor/lib change, prove it safe with the regression harness —
# it re-extracts all three entities from their canonical sources and
# byte-compares against the committed JSON (non-zero exit on drift):
python scripts/verify.py

# CI gate (runs before every deploy; no PDFs needed): data contracts on the COMMITTED
# JSON + EN/ES/HMN key parity — County row identities, edition/basis labels, City
# personnel shape, School enrollment-year = budget-year, every municipality x school
# district bill finite, manifest files/sources. Proven to catch the June Capital
# Projects column shift. Add a check here whenever the UI starts assuming something.
npm run check
# Then a real browser (CI runs it on the BUILT site, after the build; a failure
# stops the deploy): bills and receipts add up, next-door counties, the
# assessment check, key dates + the .ics, the map zoom, "Use my location" with
# real geolocation, and every view x language with no console errors. Every
# expectation is derived from public/*.json or the page, so a new year's data
# doesn't break it. Needs Playwright (pip install playwright; python -m
# playwright install chromium). The webapp-testing skill's with_server.py runs
# it locally against the production build:
python scripts/e2e.py                        # against npm run dev (:5180)
python ~/.claude/skills/webapp-testing/scripts/with_server.py        --server "npx vite preview --port 4173 --strictPort" --port 4173        -- python scripts/e2e.py --base http://localhost:4173/wpr-budget/

# Multi-year: pass prior-year "Adopted Budget" PDFs as trailing args. The FIRST
# PDF drives every detailed section; each prior PDF contributes only the slice
# `history` needs (its by-fund + by-department appendix tables) via
# extract_history_slice, keyed by year. The committed county file is built from 2026 + 2025:
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/marathon-county.json \
       2025-Annual-Budget.pdf --cache
# The FIRST PDF may also be the Administrator's PROPOSED edition (posted late Sept;
# the board adopts in November). meta.status records which edition it was. The
# 2027 proposed edition is served (see Editions) and is built with:
python scripts/extract_budget.py sources/2027-Annual-Budget-Proposed.pdf public/marathon-county-2027-proposed.json \
       2026-Annual-Budget.pdf 2025-Annual-Budget.pdf --cache

# City of Wausau (separate extractor, separate schema — see extract_wausau.py):
python scripts/extract_wausau.py "2026-Wausau-Budget.pdf" public/wausau-city.json --cache

# Every Marathon County municipality's levies (DOR TVC workbook) + the state's
# per-home credits (DOR's lottery and first-dollar "Credit Amount" reports):
# (--neighbors: the eight counties around Marathon, same basis, one file)
python scripts/extract_dor.py sources/dor-tvc25.xlsx sources/dor-2025lotcr.pdf \
       sources/dor-2025fdcred.pdf public/marathon-tax-districts.json \
       --neighbors public/neighbor-tax-districts.json --cache
# The year before, same extractor, same checks (the Tax Bill view's "vs. last
# year"): DOR's tvc24 workbook + the 2024 credit reports, in sources/dor-2024/.
python scripts/extract_dor.py sources/dor-2024/tvc24.xlsx sources/dor-2024/2024lotcr.pdf \
       sources/dor-2024/2024fdcred.pdf public/marathon-tax-districts-2024.json --cache
# EACH JUNE (new TVC): the current file becomes the prior one — rename/re-extract
# so with.prior in src/entities.json names the year before the current file
# (check-data fails if prior.tax_year != current - 1), and update verify.py.
# then redraw the share cards (CI fails while their figures are stale):
python scripts/og_cards.py
# and the map's boundaries (Census cartographic boundary file, same Jan 1 as DOR):
python scripts/extract_map.py sources/census-cousub-2025/cb_2025_55_cousub_500k.zip        public/marathon-tax-districts.json public/marathon-map.json

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
# --prior-book (repeatable) = a prior year's Annual Budget Book; each extends the
# `gf_history` block (per-student spending line) two more years on the own-book
# ADOPTED basis (newer books restate the prior year — e.g. the 2025-26 book prints
# a revised $119.3M for 2024-25 vs that year's own adopted $118.6M; own-book wins,
# a later book's prior column only fills the earliest year). Prior books found via
# the district site (only current + one prior hosted) and the Wayback Machine's
# snapshot of /about-wsd/annual-budget-book (the 2023-24 edition's finalsite CDN
# URL still serves). The 2022-23 edition was NOT recoverable online — that's why
# gf_history starts at 2022-23 (from the 2023-24 book's prior column) and the
# per-student line has no 2021-22 point. THE COMMITTED FILE is built with:
python scripts/extract_school.py sources/2026-Wausau-School-Budget.pdf public/wausau-school.json \
       sources/enrollment_certified_2021-22.zip sources/enrollment_certified_2022-23.zip \
       sources/enrollment_certified_2023-24.zip sources/enrollment_certified_2024-25.zip \
       sources/enrollment_certified_2025-26.zip \
       --prior-book sources/2025-Wausau-School-Budget.pdf \
       --prior-book sources/2024-Wausau-School-Budget.pdf --cache
```

**Prior-year format limitation.** Only the **2025+** books carry the by-fund /
GF-by-department appendix tables the extractor needs. The **2021–2024** books
are an older, chart-and-summary format (~141 pp) with **no such tables**,
so per-department/per-fund history cannot be extracted from them; passing one as
a trailing arg fails loud at the "Budget by Fund" lookup. Each prior year is taken
from its own adopted book (the apples-to-apples basis); the county occasionally
restates a prior year in the newer book for reorganizations (for 2025→2026, 18
of 20 departments matched exactly, County Treasurer and Administration differed),
so a cross-book department line can diverge slightly from the ledger's "vs '25"
column. The "Over Time" department chart omits revenue-returning offices
(negative levy) to avoid reclassification artifacts.

The extractor locates tables by section marker (robust to page-number drift
year to year) and **reconciles** parsed rows against the budget's own printed
totals — it raises on any mismatch rather than emitting silently-wrong numbers.
Hard-won specifics (2026-10-09 rework, after the 2027 proposed book broke it):
- **Appendix tables are found by TITLE** ("Budget by Fund", "General Fund Budget
  by Department"), never by letter — 2027 dropped an appendix and every letter
  shifted (by-fund E→D, by-department F→E).
- **Blank cells are placed by arithmetic, not position.** The book sometimes
  leaves a cell blank instead of printing `$ -` (2026 Capital Projects personnel,
  2027 UW-Extension personnel, 2025 Contingency difference). The old end-padding
  shifted later columns left and only the levy column was reconciled, so the
  committed 2026 file shipped Capital Projects with $1.18M phantom personnel
  spending until this fix. Now every row must satisfy spending = levy + revenue
  and levy − prior = difference, and ALL SIX columns must sum to the printed
  Total; `resolve()` requires exactly one layout that does.
- **Edition** is read from the book: this budget's adoption sentence (dated the
  prior November) → `adopted`; else the cover's "Presented to the … Committee
  on <date>" → `proposed`; neither → error.
- **GF summary** comes from the public-hearing notice the approved book reprints
  (pp. 7–9 in 2026). The proposed book predates the notice (published ~2 weeks
  before the hearing), so `general_fund` is `null` in a proposed edition —
  required in an approved one.
- **Debt** comes from the per-series "Debt Service Schedules as of 12/31/<prior
  yr>" tables (both editions). Every principal+interest=total triple must add
  up, each series' years must sum to its Total row (principal exactly; interest
  ±$1 — the book's own rounding), and the grand principal must equal the
  narrative "outstanding general debt obligation as of December 31 … will be $X".
  (The hearing notice's "TOTAL DEBT" list was used before; it is a year staler.)

### budget.json schema

```
meta:            { entity, budget_year, status, adopted, presented, tax_levy, tax_rate, total_expenditures }
                 # status "adopted" (adopted = ISO date, presented = null) or
                 # "proposed" (adopted = null, presented = ISO date the Administrator
                 # presented it to the HR/Finance & Property Committee)
general_fund:    { expenditures[], revenues[] } | null   # each: category, actual_prior, budget_current, proposed_next, pct_change
                 # null ONLY in a proposed edition (see the GF-summary note above)
departments[]:   department, tax_levy, operating_revenues, operating_expenditures,
                 personnel_expenditures, prior_tax_levy, levy_difference
funds[]:         fund_no, name, tax_levy, operating_revenues, operating_expenditures, personnel_expenditures,
                 prior_tax_levy, levy_difference
                 # fund_no is null for UNNUMBERED_FUND_ROWS (2027+: "State Special Charges")
levy_history[]:  year, levy, rate
homeowner_impact[]: year, avg_value, tax_rate, tax_amount, pct_change_bill
debt[]:          series, outstanding   # outstanding principal as of Dec 31 of the prior year
history:         { years[], totals{}, departments[], funds[], general_fund:{expenditures[],revenues[]} }
                 # multi-year figures merged across the PDFs passed to the
                 # extractor. totals: {<year>:{total_expenditures,tax_levy,tax_rate,basis}};
                 # basis = "adopted" | "proposed": whether that book's appendix tables
                 # are the adopted budget. The approved books warn their tables
                 # "reflect the Administrator's proposed budget"; they count as adopted
                 # only when their levy equals the levy the book says was approved —
                 # 2026 does ($61,225,481), 2025 does NOT ($59.69M vs $57.95M adopted).
                 # The UI claims no total-budget change against a "proposed"-basis year
                 # and footnotes it on the department chart.
                 # departments[]: {department, adopted:{<year>:tax_levy}};
                 # funds[]: {name, adopted:{<year>:spending}} (operating + personnel) —
                 # drives the "biggest single change" line under the stat tiles;
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

### marathon-tax-districts.json schema (Wisconsin DOR — every municipality)

```
meta:            { source, source_url, tax_year, county,
                   credits: { payable, lottery_max_value, first_dollar_max_value, source_url } }
municipalities[]: { code, type: City|Village|Town, name, split_county, population,
                    full_value, full_value_ex_tif, assessment_level, total_tax,
                    school_levy_credit, gross_rate, effective_rate,
                    taxes: { county, local, school, technical_college, other },   # other = TIF increment + special districts
                    school_districts[]: { code, name, full_value, levy, credit_rate },  # largest first
                    technical_colleges[]: { code, name } }
                 # sorted Cities, Villages, Towns, then by name
```

### wausau-school.json schema (Wausau School District — separate again)

```
meta:           { entity, kind:"school", budget_year, fiscal_label, total_levy, mill_rate,
                  gross_expenditures, net_expenditures, gf_expenditures, gf_revenues }
funds[]:        { fund_no, name, revenues, expenditures, prior_revenues, prior_expenditures }
                # all-funds summary (Fund 10/27/20/38/39/49/50/73/80); reconciled to GROSS totals
gf_revenues[]:  { source, amount, prior }    # General Fund by source; sums to gf_revenues
gf_history:     { "<fy-label>": fund10_budget }  # adopted GF budget per fiscal year, one figure
                # per budget book (own-book adopted basis; earliest year from a prior column).
                # Drives the Students chart's per-student spending line: gf_history[label]/enrollment.
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

- **Module layout** (split from the old single-file App.jsx in the 2026-06
  performance refactor; the four bodies are `React.lazy` chunks so the landing
  page / WP embed ships ~82 kB gzip instead of 211 kB — recharts loads only
  when a body opens):
  - `src/App.jsx` — slim hash router: parses `#<entity>[/<section>]`, listens to
    `hashchange`, fetches data via the cache, renders Landing or a lazy body.
  - `src/bodies/Ledger.jsx` (County) · `CityLedger.jsx` · `SchoolLedger.jsx` ·
    `TaxBillOverview.jsx` — the four views, lazy-loaded.
  - `src/ui.jsx` — chart-FREE shared components: SectionHead, Stat, Delta,
    Balance, Spark, Highlights, SubNav, SponsorSlot, Methodology, ChartNotes/
    resolveNotes, HomeValueCalc, TaxSplit (tax bar + tooltip + rows),
    DivisorToggle, and the hooks `useScrollSpy`, `useAnchorOnMount`,
    `useHomeValue`. **MUST stay free of recharts imports** — it's in the eager
    bundle; anything chart-flavored goes in…
  - `src/charts.jsx` — shared chart pieces (BarTip, SankeyNode,
    MoneyFlowSankey, DebtChart); their recharts parts render through WithCharts.
  - `src/withCharts.jsx` + `src/rechartsParts.js` — CHARTS LOAD ON DEMAND (since
    2026-10-10): `<WithCharts height={H}>{(R) => <R.ResponsiveContainer …>…}</WithCharts>`
    loads recharts (only the components re-exported by rechartsParts.js, so it
    stays tree-shaken, ~113 kB gzip) on first use and holds an empty box of the
    chart's height meanwhile. The County/City/School pages paint their text,
    figures and tables without waiting for it (slow-phone LCP ~2.7 s → ~1.8 s).
    App also starts a body's code download alongside its data (no waterfall),
    and prefetchEntity warms recharts on hover. vite.config.js pins
    rechartsParts.js into the recharts chunk — left alone, Rollup folded it into
    index and EVERY page (landing included) loaded the charts.
  - `src/ChromeBar.jsx`, `src/Landing.jsx`, `src/format.js` (usd/compact/pct/
    downloadCSV), `src/data.js` (fetchData promise cache), `src/nav.js`
    (pending-section handoff between App and body mounts).
  - `src/styles.css` — a real stylesheet now (imported in main.jsx; minified +
    cached separately). Fonts are SELF-HOSTED (since 2026-10-10): Fontsource
    packages imported in main.jsx — `@fontsource-variable/fraunces/opsz.css`
    (family 'Fraunces Variable', optical-size axis), `@fontsource-variable/
    public-sans` ('Public Sans Variable'), `@fontsource/playfair-display/
    latin-900.css` (the WPR wordmark). No Google Fonts request.
  - `src/entities.json` (manifest, bundled), `src/annotations.json`,
    `src/sponsors.json`, `src/demographics.json` (all curated, not extracted).
  - `vite.config.js` pins `react` and `recharts` vendor chunks (manualChunks
    function form — the object form silently hoists React back into index).
- **When no entity hash is set (bare URL / `#home` / unknown), App renders
  `Landing`** — the suite front door (hero + a "your whole tax bill ≈ $X" hook +
  a card per entity with its headline figure + the open-data/Meeting-Tracker
  strip). The landing PAINTS AT ONCE (since 2026-10-10): chrome, hero, cards and
  seasons render immediately; only the figures wait for data (`.skel*`
  placeholders, `aria-busy`; CLS ~0.005 on a phone). Its statement box ends with
  the county map (see "The map"). It pulls every entity's data (and the map's
  boundaries) through the shared cache; cards call
  `onSelect(id)`; the ChromeBar Home button returns. Direct deep links like
  `#marathon-county` still skip the landing. `ChromeBar` is a **two-tier** bar
  (brand + Share/FY on top, the entity switcher as its own full-width `<nav>`
  with `aria-current` beneath), with a `navigator.share`-or-clipboard **Share**
  button that emits a canonical `#<activeId>` deep link (no personal data in the
  URL). Hooks are top-level in each body (no conditional hooks).
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
- **Shared features:** the "Your Tax Bill" calculator (`useHomeValue()` —
  persists across bodies/sessions in localStorage, NEVER in URLs/shares); the
  **per-resident / per-household toggle** (`DivisorToggle`) on the County + City
  Where-It-Goes bars, denominators curated in `src/demographics.json` (2020
  Census counts with source URLs; School keeps per-student from WISEdash); the
  `Highlights` "What changed this year" lead band (rendered between masthead and
  subnav by the three government bodies — each computes its own 3 items:
  levy/rate deltas + the biggest mover; the County mover EXCLUDES sign-flip
  revenue-returning offices to avoid the reclassification artifact); the
  `Methodology` component (JSON via link + CSV via `downloadCSV`) which also
  carries the `.suite-link` cross-link to the Central Wisconsin Meeting Tracker
  (`MEETING_TRACKER_URL`); a print stylesheet (chrome/nav/controls drop out);
  accessibility (`:focus-visible`, `prefers-reduced-motion`, `aria-pressed` on
  toggles/chips, `role="img"` on the Sankey, `aria-current` on the switcher).
  Tax-levy values render in full dollars everywhere EXCEPT the levy chart y-axes
  ($M); the County dept-ledger levy uses compact on mobile via `.lg-only`/`.sm-only`.
  **Change colors (decided 2026-10-10):** red/green ONLY on what taxpayers pay —
  a levy, a mill rate, a bill — where up = red, down = green. Spending and
  revenue changes are `<Delta neutral>` (ink-soft arrows; sparklines ink-soft):
  more spending isn't inherently good or bad, and the old `invertColor` flag
  had left a spending increase green beside a rust sparkline in the same row.

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
npm run dev      # local dev
npm run build    # vite build + scripts/entity-pages.mjs (per-entity share stubs) -> dist/
```

- `vite.config.js` `base` must equal the Pages repo path (`/wpr-budget/`). It is
  the only place the repo name appears in src; the data fetch uses
  `import.meta.env.BASE_URL`. (`scripts/entity-pages.mjs` carries the absolute
  Pages origin for OG tags — update it too if the repo/site ever moves.)
- Pushing to `main` triggers `.github/workflows/deploy.yml` (build + deploy to
  Pages). Enable Pages → "GitHub Actions" in repo settings once.
- **Embedding on WPR (no scripts!):** wausaupilotandreview.com's Cloudflare
  firewall rejects any post containing `<script` (found by the sibling
  `wpr-city-budget`), so the old postMessage auto-height listener can never run
  in a WPR post. Snippets (README "Embedding on WordPress") are bare iframes:
  the **story card** `…/wpr-budget/#card` ("What does your home pay?" —
  `src/Card.jsx`, no chrome, no recharts) sized by a width formula fitted to its
  measured height (EN + ES, 288–1100px; **re-measure `.card-inner` and refit if
  the card's content changes**), and the **full tool** at `height:90vh` scrolling
  inside its frame. Both carry `allow="web-share; clipboard-write"`; the full
  tool also `geolocation` (the Tax Bill view's "Use my location"). The app still
  posts `{type:"wpr-budget:height"}` for hosts that can run a script.
- **Share pages** (`scripts/entity-pages.mjs`, in `npm run build`): `/<entity>/`,
  `/<entity>-<edition>/`, `/about/`, and one per municipality `/tax/<slug>/`
  ("Town of Ringle: $1,693 a year on a $200,000 home", after the state's credits; it writes the Tax Bill
  view's remembered municipality, then redirects — no reader data in the URL).
  Each uses its own card image when `scripts/og_cards.py` made one.
- **Share cards with numbers:** `python scripts/og_cards.py` (Pillow; Georgia +
  Arial from the Windows font folder) draws og-image.png (suite: "the same
  $200,000 home pays $1,693 … $3,372", after credits, beside the county map with
  both ends pinned), og-your-tax-bill.png (the range + the map),
  og-<entity>-<edition>.png, and one card per municipality,
  og-tax-<slug>.png (61, ~26 kB each, quantized): the place, the amount its
  /tax/<slug>/ page states (a range where it spans school districts), its rank
  ("the 26th-highest of … 61"), and the map with the place outlined and its pin
  labeled (kept inside the map for edge places like Abbotsford). The map base
  is drawn once and finished per card (~4 s for all). Every figure goes to
  public/og-cards.json (`towns` too); check-data recomputes them with
  src/taxmath.js and **fails the deploy when a card is stale or missing** —
  rerun after data changes.
- **Analytics (Plausible, off until configured):** `src/analytics.js`, copied
  from prep-sports (WPR's suite-wide account). Set repo variable
  `PLAUSIBLE_SCRIPT_ID` (the `pa-…` id from the site's install snippet — sites
  made under Plausible's newer flow DROP events from the legacy script) or
  `PLAUSIBLE_DOMAIN`, then redeploy; deploy.yml passes them to the build.
  Hash routes count as pageviews (scroll-spy replaceState doesn't). Events (add
  each as a custom-event goal): Municipality {name, via}, Home value {view} (never
  the value), Language, Share {view, method, town?}, Download, Chart table, Link
  {to, view}, Sponsor click {slot}, Embed {host}. Verify from a real phone —
  Plausible drops headless/bot traffic. The About page's privacy paragraph
  mentions counting only when analytics is on.
- **Sales demo:** `?demo` in the URL (e.g. `…/wpr-budget/?demo#marathon-county`)
  fills every unsold sponsor slot with "Your business here" plus a ribbon and
  WPR's sales mailto — for showing a prospect. Readers never see it.

## Design principles (house style)

Surgical changes; no fallbacks / one correct path; fail fast (throw on bad
preconditions) rather than defensive runtime checks; one source of truth for
data; separation of concerns. Match the existing editorial aesthetic.

## Current state (as of last session — read this first)

The 2026-06-10 session ran a full front+back audit and implemented it in six
local commits on `main` (extractor hardening → hash routing → code-split
refactor → extractor lib/verify → reader enhancements → docs). **Committed
locally; push to deploy when ready.** `npm run build` clean;
`python scripts/verify.py` proves all three extractors reproduce the committed
JSON byte-for-byte. The site has FOUR switcher views (Marathon County, City of
Wausau, Wausau School District, + the "Your Tax Bill" overview) behind a suite
**landing page** (the default front door), in **three languages** (EN / ES /
Hmoob). Raw source files (gitignored, in `sources/` + repo root) needed to
re-run extractors: `2026-Annual-Budget.pdf` + `2025-…` (County),
`2026-Wausau-Budget.pdf` (City), `sources/2026-Wausau-School-Budget.pdf` +
prior books `sources/2025-…` and `sources/2024-Wausau-School-Budget.pdf` +
`sources/enrollment_certified_<yr>.zip` ×5 (School); page-text caches live
beside them as `sources/_pages_*.json`.

> **FY2027 budget season (2026-10-09).** The County's 2027 PROPOSED book
> (`sources/2027-Annual-Budget-Proposed.pdf`, county doc 19303) is served as an
> edition: `public/marathon-county-2027-proposed.json` at
> `#marathon-county~2027-proposed` (share stub `/marathon-county-2027-proposed/`),
> labeled "Proposed — not yet adopted" throughout, in all three languages (the
> new Hmong strings are AI-drafted like the rest — include them in the review).
> Its Where-It-Goes section shows a pending note: the GF-by-function summary
> arrives with the public-hearing notice (~Oct 18) — when it's published, it can
> be parsed with the existing `parse_gf_summary` (same notice format as pp. 7–9
> of the 2026 book) once the extractor accepts the notice as an extra input.
> County calendar: board Q&A Oct 15 & 20, **public hearing
> Nov 2**, amendments due Nov 6, **adoption Nov 10**. The City's 2027 proposed
> book (`sources/2027-Wausau-Budget-Proposed.pdf`, wausauwi.gov
> "2027_Proposed_Budget_Updated") now parses everywhere EXCEPT the
> jurisdiction-split table, which the proposed edition doesn't print (only the
> adopted book does) — a City edition needs `tax_by_jurisdiction: null` handling
> in `CityLedger` plus Mayor/Common-Council edition wording, and `c.dev.note`
> ("closure of District 6") is FY2026-specific prose. Fixed 2026-10-09:
> personnel '-' cells (the new City Administrator row) + every row must match the
> Grand Total's year count; debt year rows reconcile within the book's $1 row
> rounding, anchored EXACTLY to the debt-limit page's outstanding figure; TIF
> growth in parentheses is negative (was silently flipped positive). The
> School's 2026-27 book isn't posted yet (final levy Oct 27).
>
> **2026-10-10 funder & sponsor pass (read first).** Shipped locally on top of the
> pushed review work: Plausible analytics (off until the repo variables are set),
> an About page (#about), a support band (donate / newsletter — UTM-tagged —
> / sponsor / about) on the landing, every Methodology and About; "What changed"
> bands with records context; the 15-year County bill chart; "Same home, different
> bill" (all 61 municipalities ranked) + the landing line; /tax/<town>/ share
> pages + a "Share the <town>'s bill" button; the script-free #card embed;
> "Have your say" + the change log on the 2027 County edition; share cards with
> numbers; a business-property note; ?demo sales mode; ES/HMN loaded on demand;
> the City 2027 pointer to wpr-city-budget (no duplicate City edition). WPR
> decisions pending: Plausible site + repo variables; a LICENSE (MIT code +
> CC BY 4.0 data?) before calling it open source; whether to keep serving the
> AI-drafted Hmong (the City tool took its translations down Oct 5 pending
> review); the editorial-independence line on the About page; and adding
> Follow the Money to the Funding Desk's desk/profile.md builds table.
>
> **Next session — start here.** No half-finished code; the open items are
> WPR/editorial actions, not bugs: (1) a **fluent-speaker review of the Hmong** (it's
> AI-drafted, shipped behind a beta banner — corrections go in
> `src/strings/hmn.js`; the new `pc.*` keys are AI-drafted too); (2) the School
> enrollment **consolidation annotation is now VERIFIED + sourced** (board voted
> unanimously Jan 8, 2025 to close Hewitt-Texas/Hawthorn Hills/Grant/Lincoln,
> effective 2025-26 — WPR's own 2025-01-09 article is the source link); the
> **2022-referendum seed still needs its source URL**; (3) the **sponsor
> surface** is built but hidden — flip
> `src/sponsors.json` `enabled:true` to go live; (4) **add the auto-height
> snippet to the WordPress embed** (see Dev / deploy) and decide whether the
> embed should point at the landing or a fixed entity hash. Live at
> https://rowanflynnpilot.github.io/wpr-budget/ once pushed.

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
- ✅ 2026-06-10 audit implementation, part 1 — correctness: City jurisdiction rate
  years parsed from the table's own header (was hardcoded — next year's book would
  have shipped silently mislabeled rates); County debt + GF-summary reconciliations
  added; hash-driven routing (`#entity/section`, back/forward works, section deep
  links, scroll-spy URL mirroring); entity-switch fetch race closed; data-driven
  County chart axis domains (were hardcoded windows next year's rates would clip
  out of); locale-aware adopted-date formatting.
- ✅ 2026-06-10 audit implementation, part 2 — performance: code-split modules
  (see Frontend) — landing first-load 211 kB → ~82 kB gzip, recharts lazy; real
  stylesheet; fonts from index.html; shared TaxSplit/HomeValueCalc/DebtChart/
  Sankey components (was 3-4 pasted copies each); stable `t()`.
- ✅ 2026-06-10 audit implementation, part 3 — pipeline: `scripts/lib.py`,
  `--cache` page-text layer (re-runs in seconds), `scripts/verify.py` byte-diff
  regression harness, annual-trap hardening across all three extractors
  (check.py/dump.py retired).
- ✅ 2026-06-10 audit implementation, part 4 — reader features: per-resident /
  per-household toggle (County+City, trilingual, curated 2020-Census denominators
  in `src/demographics.json`); WordPress-embed auto-height postMessage;
  per-entity share pages with their own OG cards (`scripts/entity-pages.mjs`);
  home value persists across calculators (localStorage); print stylesheet;
  schema.org Dataset markup; favicon.

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
- Enhancements floated but NOT built: County money-flow Sankey; City personnel
  beyond the chart; treemap; self-hosted fonts (woff2 — would cut the one
  remaining third-party request to Google Fonts). (Recharts 2.x→3.x migration is
  optional, nothing broken.) DONE since first floated: "what changed this year",
  chart annotations, multilingual, landing page, sponsor surface, tax-bill
  unifier, share/social, analytics, **per-capita/per-household toggle**, embed
  auto-height, per-entity share cards, print CSS, Dataset markup.

## Gotchas for the next session

- **Extractor speed:** the cost is the FIRST pdfplumber text pass (~0.5 s/page on
  the chart-heavy county book — ~116 s for 2026; repeats are lru-cached and
  free). Always run with `--cache` when iterating: page texts land in
  `sources/_pages_*.json` (keyed on PDF size+mtime) and re-runs take seconds.
  Run `python scripts/verify.py` after ANY extractor/lib change — byte-identical
  output is the regression contract.
- **NOTHING imports recharts statically any more** — not ui.jsx (eager), and
  not the bodies either: a static import in a body makes its whole first paint
  wait for the chart chunk again. New charts go inside `<WithCharts height={H}>`
  with `R.` components; a new recharts component goes in src/rechartsParts.js.
  Check `dist/index.html` has no recharts `modulepreload` and a body chunk has
  no `from"./recharts-…"` import after any chart change (e2e also asserts every
  chart box fills).
- **"Print my bill"** (Tax Bill view, `.tb-view` print rules in styles.css): the
  bill, receipt, assessment check (only when filled in) and key dates print;
  the map, ranking, neighbors and controls don't; a print-only summary line
  stands in for the controls, a dated footer names the source. Each printed
  section is kept whole (Chromium ignores break-after:avoid next to an
  unbreakable block); 3–4 Letter pages. e2e checks what prints.
- **Programmatic scrolls are `behavior:"instant"` on purpose.** Smooth
  programmatic scrolling gets canceled by chart reflows/re-renders (observed
  not moving at all); same-entity section scrolls also deliberately bypass
  React state (`App.jsx` onHash) so no re-render interrupts them. Don't "fix"
  either back to smooth/state-driven.
- **manualChunks must stay the function form** in vite.config.js — the object
  form silently hoists React back into the index chunk via jsx-runtime.
- **City book quirks:** mixed-case decorative headers (`find_page` is
  case-insensitive); long names shortened for the Sankey (`SANKEY_SHORT`); some
  pages reverse-render decorative text — target the clean data lines.
- **School extractor quirks (`extract_school.py`):** fund detail tables (revenue/
  expenditure) span multiple pages AND repeat the same subtotal labels across funds,
  so it uses `find_section` (contiguous run from the first `FUND 10`+title hit), not
  `find_page`. The book has small source-rounding artifacts: salary/benefit line
  items sum $1 off their printed subtotal, and the debt "total" column a few dollars
  off — handled by `reconcile(tol=...)`, while the integrity anchors (by-object →
  GF total; debt principal) reconcile EXACTLY. Salary lines carry a trailing budget
  flag ("Teachers E", "…Teachers R") that gets stripped. The current rate-history
  row has a `***` footnote between year and rate (regex allows it) — miss it and
  `budget_year` comes out a year low (now caught loud: budget_year is
  cross-checked against the levy-page bridge label). The valuation-history page splits the leading
  digit off every value ("5 24,920,300" = 524,920,300) and lays two columns side by
  side — the token-walking parser rejoins them and the latest year is cross-checked
  against the levy page's "New Valuation". `find_page` needles for the rate-history
  and valuation pages need a second term (e.g. "(DECREASE)") to beat the table-of-
  contents line. The summary `print` avoids non-cp1252 chars (Windows console).
- **Switching entities/editions** must gate on `data.route === route` (App) or a
  body briefly gets the other entity's schema (crash) or the other edition's
  numbers (silently wrong) — already handled, keep it.
- **recharts Sankey** link tooltip data is nested at `payload[0].payload.payload`
  (source/target are resolved node objects there).
- Styles live in `src/styles.css` (a real stylesheet since the refactor — no
  more injected template literal). `.toggle` dividers use `button + button`
  border-left (supports the 3-button DivisorToggle).
- **Social cards / OG:** crawlers only read static HTML, so the SPA's
  `index.html` carries the suite card, and `scripts/entity-pages.mjs` (runs in
  `npm run build`) writes per-entity stubs at `/<entity-id>/` with their own
  OG text (shared `public/og-image.png`, a 1200×630 editorial card generated
  locally with PIL — regenerate with the same script if branding changes).
  `og:image`/`twitter:image` use absolute Pages URLs.
- **`src/demographics.json` is curated, not extracted** (like annotations.json):
  2020 decennial Census population/households for the per-capita toggle, source
  URLs inside. Update at the next decennial; don't silently swap in rolling
  estimates (the on-page note names the basis).
- **Tax-bill math lives in `src/taxmath.js`** (plain JS): `billParts`/`billTotal`,
  `stateCredits`/`netBill`, `billDollars` (display dollars), `MUNI_KEY`, `muniSlug`. ui.jsx's `billRates`, the CI check, the share pages and
  og_cards.py's figures (re-checked by CI) all use that one formula — change it
  there only. `TaxBillOverview` covers all 61 municipalities (DOR data); its
  `#compare` section maps and ranks them ("Same home, different bill"). Never
  `Math.round` a bill line on its own — use `billDollars`, or the lines stop
  adding up.
- **i18n files:** English in `src/i18n.jsx` (`const EN`); Spanish and Hmong in
  `src/strings/es.js` / `hmn.js` (`export default {`), dynamic-imported on first
  use so the landing/embeds ship English only (index ~36 kB gzip). A new key goes
  in all three files (check-data enforces parity). Hmong corrections go in
  `src/strings/hmn.js`.
- **New routes:** `#about[/sponsor]` (About.jsx — the page for grant applications
  and sponsors; its stats are computed from the data files) and `#card` (the story
  card). Both bypass the entity fetch in App; Landing/About mount their anchor hook
  only once data is in (so focus + deep links land on content).
- **"What changed" (`Highlights`) never repeats the stat tiles:** each body
  computes new facts, ranked against the entity's own records with
  `rankLast`/`rankNote` ("the largest rise in records back to 2017", "the lowest
  … back to 1968-69"). check-data guards that levy_history/homeowner_impact end
  at budget_year.
