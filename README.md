# Follow the Money — Marathon County Budget

A budget-transparency widget for [Wausau Pilot & Review](https://wausaupilotandreview.com).
Visualizes the Marathon County annual budget: where the money comes from, where
it goes, a department-by-department drill-down, the tax-levy and mill-rate trend,
other funds, and outstanding debt.

## Quick start

```bash
npm install
npm run dev
```

## Build & deploy

```bash
npm run build      # outputs to dist/
```

Pushing to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml`. In repo **Settings → Pages**, set the source to
**GitHub Actions** once. The live site is then embedded on WordPress via iframe.

If you rename the repo, update `base` in `vite.config.js` to match
(`/<repo-name>/`) — that's the only place the name appears.

## Updating the data (once a year)

The site reads `public/budget.json`. Regenerate it when a new budget is adopted:

```bash
# Download the latest "Approved Budget" PDF by hand from
# https://www.marathoncounty.gov/about-us/annual-budget
pip install -r scripts/requirements.txt
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/budget.json
```

The extractor reconciles every table against the budget's own printed totals and
fails loudly on any mismatch.

> The committed `budget.json` is a development fixture (mixed real 2025/2026
> figures) until the extractor is run on the official 2026 PDF. See `CLAUDE.md`.

## Layout

```
public/budget.json            data the UI reads
scripts/extract_budget.py     PDF -> budget.json (run locally, annually)
src/App.jsx                   the entire UI (fetches budget.json)
src/main.jsx                  React entry
.github/workflows/deploy.yml  build + deploy to GitHub Pages
CLAUDE.md                     context for Claude Code
```
