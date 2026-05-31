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

Same pattern as the other WPR widgets, with one deliberate difference:

```
official budget PDF (downloaded by hand)
  -> scripts/extract_budget.py   (pdfplumber, run locally, once a year)
  -> public/budget.json          (committed to the repo)
  -> src/App.jsx                 (React + Vite, fetches budget.json at runtime)
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
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/budget.json

# Multi-year: pass prior-year "Adopted Budget" PDFs as trailing args. The FIRST
# PDF drives every detailed section; each prior PDF contributes only the slice
# `history` needs (its Appendix E/F tables) via extract_history_slice, keyed by
# year. The committed budget.json is built from 2026 + 2025:
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/budget.json \
       2025-Annual-Budget.pdf
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

## Frontend

- `src/App.jsx` — entire UI in one file. `App` fetches `budget.json` and renders
  a loading/error shell; `Ledger` holds all the render logic and hooks (split so
  there are no conditional hooks). Styling is a single CSS string injected via a
  `<style>` tag — no Tailwind, no CSS files.
- Aesthetic: editorial / public-ledger. Fraunces (display) + Public Sans (data),
  warm newsprint, hairline rules, tabular numerals. Keep this direction.
- Sections: Where it goes (GF spending/revenue toggle, with inline 3-year
  sparklines per row) · Departments (sortable ledger, click to expand a
  where-it-goes / where-it-comes-from balance) · Over time (10-yr levy-vs-mill-
  rate ComposedChart, plus a department-levy trend that appears once `history`
  has >= 2 adopted years) · Your tax bill (dual-axis mill-rate vs avg-bill
  chart) · Funds · Debt.
- Charts use `recharts`; icons use `lucide-react`. Sparklines are hand-rolled
  inline SVG (`Spark`), not recharts.

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

## Next steps / backlog

- ~~Replace the dev-fixture `budget.json` with the real 2026 extraction.~~ Done
  — committed `budget.json` is the reconciled FY2026 extraction.
- Build the sponsor surface.
- **Ingest prior-year PDFs (2023–2025) to populate `history`.** The plumbing is
  done (extractor multi-PDF arg + `history` block + the dormant "Over time"
  department chart). Remaining work is purely data: download the 2023/2024/2025
  "Adopted Budget" PDFs by hand and re-run the extractor with them as trailing
  args. Watch for older-layout parser breaks (loud, not silent) per the data-
  pipeline note.
- Add the City of Wausau as a second entity (verify its PDF format first; the
  extractor's section-marker approach may need entity-specific markers).
- Possible later: capital improvement plan (CIP); link relevant Marathon
  Meetings coverage inline.
