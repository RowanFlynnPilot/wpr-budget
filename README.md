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

wausaupilotandreview.com sits behind a Cloudflare firewall that rejects any post
containing a `<script` tag (the editor reports "Updating failed. The response is
not a valid JSON response."; found by the sibling `wpr-city-budget`, Sept. 2026).
So both snippets are bare iframes. Paste one into a **Custom HTML** block; saving
needs an Editor or Administrator account (WordPress strips iframes from Author
and Contributor posts).

### In a story: the tax-bill card

"What does your home pay?" — municipality, school district and home value, the
year's bill and its split, and a link to the full tool. It fits its frame at
every width, so readers scroll past it like an image:

```html
<div><div style="position:relative;padding-top:max(425px, min(calc(820px - 52.9%), calc(2569px - 335%)));"><iframe src="https://rowanflynnpilot.github.io/wpr-budget/#card" title="Follow the Money: what does your home pay?" loading="lazy" allow="web-share; clipboard-write" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"></iframe></div></div>
```

Without a script the frame can't measure the card, so its height is a formula of
the column's width (`padding-top` percentages are shares of the outer `<div>`'s
width; keep that `<div>`, block themes need it). Refitted on Oct. 10, 2026, after
the card started showing the state's credits, to its measured height in English
and Spanish (the taller): 637px at a 288px column (WPR's on a 320px phone),
577px at 320, 534px at 375, 491px at 480, 462px just under 620px, where the
controls go three across and the card drops to ~395px. The frame has at least
24px to spare at every width from 288px up, and the card centers itself in it.
**If the card's content changes, re-measure** `.card-inner`'s height at frame
widths 288–1100 in both languages and refit.

### On its own page: the full tool

```html
<iframe src="https://rowanflynnpilot.github.io/wpr-budget/" title="Follow the Money" allow="web-share; clipboard-write; geolocation" style="display:block;width:100%;height:90vh;min-height:560px;border:0;"></iframe>
```

`geolocation` lets the Tax Bill view's "Use my location" ask for the reader's position
(matched on their device, never sent); without it the button says location is off.
The bare URL opens the suite landing page; point it at a hash for one view
(`…/wpr-budget/#marathon-county`, `#marathon-county~2027-proposed`,
`#your-tax-bill`). The tool scrolls inside its frame, so give it a page of its
own or put it last in a story. The `allow` attribute lets the Share buttons open
the phone's share sheet or copy the link from inside the frame.

The app still posts `{type: "wpr-budget:height", height}` to its parent on every
layout change. Where a host page CAN run a script (not a WPR post), a listener
can size the frame to the content exactly:

```html
<script>
addEventListener("message", (e) => {
  if (e.origin === "https://rowanflynnpilot.github.io" && e.data && e.data.type === "wpr-budget:height")
    document.getElementById("ftm").style.height = e.data.height + "px";
});
</script>
```

### Share links

For social cards that name the view, share the static pages: `…/wpr-budget/<entity-id>/`
(e.g. `/marathon-county-2027-proposed/`), `…/wpr-budget/tax/<municipality>/`
(e.g. `/tax/town-of-ringle/`: "Town of Ringle: $1,905 a year on a $200,000 home"),
and `…/wpr-budget/about/` (the About page: the link for grant applications and
sponsors).

## Log a change to a proposed budget

When a committee or the County Board amends the proposal (no new PDF), add an
entry to the edition's updates file — `public/marathon-county-2027-updates.json`
— and push. The "Changes since the proposal" box appears under the Proposed
banner once the file has an entry:

```json
[
  {
    "date": "2026-11-09",
    "body": "HR, Finance & Property Committee",
    "summary": "One or two plain sentences on what changed.",
    "url": "https://wausaupilotandreview.com/..."
  }
]
```

`date` is `YYYY-MM-DD`; use `"url": null` until there is a story to link. The
deploy's data check rejects a malformed entry and names it.

## Updating the data (once a year)

Download each government's adopted-budget PDF by hand (the official sites block
datacenter IPs), then:

```bash
pip install -r scripts/requirements.txt
python scripts/extract_budget.py 2026-Annual-Budget.pdf public/marathon-county.json 2025-Annual-Budget.pdf --cache
python scripts/extract_wausau.py 2026-Wausau-Budget.pdf public/wausau-city.json --cache
python scripts/extract_school.py sources/2026-Wausau-School-Budget.pdf public/wausau-school.json sources/enrollment_certified_*.zip --cache
python scripts/extract_dor.py sources/dor-tvc25.xlsx sources/dor-2025lotcr.pdf sources/dor-2025fdcred.pdf public/marathon-tax-districts.json --cache
python scripts/extract_map.py sources/census-cousub-2025/cb_2025_55_cousub_500k.zip public/marathon-tax-districts.json public/marathon-map.json
python scripts/og_cards.py # the share cards carry figures; CI fails while they're stale

python scripts/verify.py   # proves every data file reproduces the committed JSON byte-for-byte
```

Every extractor reconciles every table against the budget's own printed totals
and fails loudly on any mismatch. The map's boundaries are the Census Bureau's
cartographic boundary file of Wisconsin county subdivisions (the cities, villages
and towns), as of the same January 1 as DOR's assessments: <https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_55_cousub_500k.zip>. `--cache` stores page texts under `sources/`
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
