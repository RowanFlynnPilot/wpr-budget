# Follow the Money — Wausau-area budgets

A civic-transparency suite for [Wausau Pilot & Review](https://wausaupilotandreview.com).
Visualizes the adopted budgets of **Marathon County**, the **City of Wausau**, and
the **Wausau School District** — plus a combined **Your Tax Bill** view that splits
one homeowner's property-tax bill across all four taxing jurisdictions. Three
languages (English / Español / Hmoob), open data downloads, and a tax-bill
calculator on every view.

## Quick start

```bash
npm install
npm run dev
```

## Build & deploy

```bash
npm run build      # vite build + per-entity share pages, outputs to dist/
```

Pushing to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml`. In repo **Settings → Pages**, set the source to
**GitHub Actions** once.

If you rename the repo, update `base` in `vite.config.js` to match
(`/<repo-name>/`) — that's the only place the name appears.

## Embedding on WordPress

The app reports its content height to the parent page, so the iframe can match
it exactly (no inner scrollbar):

```html
<iframe id="ftm" src="https://rowanflynnpilot.github.io/wpr-budget/"
        style="width:100%;border:0" scrolling="no" title="Follow the Money"></iframe>
<script>
addEventListener("message", (e) => {
  if (e.origin === "https://rowanflynnpilot.github.io" && e.data && e.data.type === "wpr-budget:height")
    document.getElementById("ftm").style.height = e.data.height + "px";
});
</script>
```

The bare URL opens the suite landing page. To embed one government directly,
point the iframe at its hash (e.g. `…/wpr-budget/#marathon-county`). For share
links with entity-specific social cards, use the static stub pages
(`…/wpr-budget/marathon-county/` etc.).

## Updating the data (once a year)

Download each government's adopted-budget PDF by hand (the official sites block
datacenter IPs), then:

```bash
pip install -r scripts/requirements.txt
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/marathon-county.json 2025-Annual-Budget.pdf --cache
python scripts/extract_wausau.py 2026-Wausau-Budget.pdf public/wausau-city.json --cache
python scripts/extract_school.py sources/2026-Wausau-School-Budget.pdf public/wausau-school.json sources/enrollment_certified_*.zip --cache

python scripts/verify.py   # proves all three reproduce the committed JSON byte-for-byte
```

Every extractor reconciles every table against the budget's own printed totals
and fails loudly on any mismatch. `--cache` stores page texts under `sources/`
so re-runs take seconds instead of minutes.

## Layout

```
public/*.json                  reconciled data the UI reads (one file per entity)
scripts/extract_*.py           PDF -> JSON extractors (run locally, annually)
scripts/lib.py                 shared extractor helpers + page-text cache
scripts/verify.py              byte-for-byte regression harness
scripts/entity-pages.mjs       per-entity share pages (runs in npm run build)
src/App.jsx                    hash router (#<entity>[/<section>])
src/bodies/                    the four lazy-loaded entity views
src/ui.jsx, src/charts.jsx     shared components (charts split out so the
                               landing page never loads recharts)
src/i18n.jsx                   EN / ES / HMN string tables
src/entities.json              entity manifest (bundled)
src/annotations.json           curated editorial chart markers
src/demographics.json          curated census denominators (per-capita toggle)
.github/workflows/deploy.yml   build + deploy to GitHub Pages
CLAUDE.md                      context for Claude Code
```
