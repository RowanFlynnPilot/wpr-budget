"""End-to-end checks in a real (headless) browser — the step after the data
checks: the site, driven the way a reader drives it.

    python scripts/e2e.py                       # against `npm run dev` (port 5180)
    npm run build && npx vite preview --port 4173 --strictPort &
    python scripts/e2e.py --base http://localhost:4173/wpr-budget/   # what CI runs

Needs Playwright (pip install playwright; python -m playwright install chromium).
Every expectation comes from the committed data (public/*.json) or the page
itself, so next year's numbers and the calendar don't break it. Exits 1 on any
failure; --shots DIR saves phone screenshots of the Tax Bill view's sections.
"""
import argparse
import json
import pathlib
import re
import sys
from datetime import datetime

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ROUTES = ["home", "marathon-county", "marathon-county~2027-proposed", "wausau-city", "wausau-school",
          "your-tax-bill", "about", "card"]
results = []
# Visible text under 12 px, chart labels included (screen-reader-only text aside).
TINY_TEXT = """() => [...document.querySelectorAll("body *")].filter((el) => {
  if (el.closest(".sr-only, .chrome-bar__wordmark") || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return false;
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && parseFloat(s.fontSize) < 12;
}).map((el) => `${el.className || el.tagName} ${getComputedStyle(el).fontSize} "${el.textContent.trim().slice(0, 24)}"`)"""
# Buttons, inputs and block links under 24 x 24 px (WCAG 2.2 target size; links
# inside running text are exempt, and a checkbox inside its label is the label).
SMALL_TARGETS = """() => [...document.querySelectorAll("a, button, input, select")].filter((el) => {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
  if (!(r.width > 0 && r.height > 0) || s.visibility === "hidden") return false;
  if (el.tagName === "A" && s.display === "inline") return false;
  if (el.tagName === "INPUT" && el.closest("label")) return false;
  return r.width < 24 || r.height < 24;
}).map((el) => `${el.tagName.toLowerCase()}.${el.className} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)"""


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail and not ok else ""))


def usd(n):
    return "$" + f"{round(n):,}"


def rings(d):
    """public/marathon-map.json paths ("M x y l dx dy ... z") -> point lists (as src/mapgeo.js)."""
    out = []
    for part in filter(None, d.split("z")):
        n = [int(v) for v in re.findall(r"-?\d+", part)]
        ring = [(n[0], n[1])]
        for i in range(2, len(n), 2):
            ring.append((ring[-1][0] + n[i], ring[-1][1] + n[i + 1]))
        out.append(ring)
    return out


def near_border(geo, inside, beside):
    """A longitude/latitude just inside `inside` (~130 m in from a border it shares
    with `beside`), so "Use my location" should pick it and offer the neighbor."""
    a, b = (next(s for s in geo["shapes"] if s["name"] == n) for n in (inside, beside))
    shared = sorted(set(p for r in rings(a["d"]) for p in r) & set(p for r in rings(b["d"]) for p in r))
    bx, by = shared[len(shared) // 2]
    lx, ly = a["label"]
    dist = ((lx - bx) ** 2 + (ly - by) ** 2) ** 0.5
    x, y = bx + (lx - bx) / dist * 3, by + (ly - by) / dist * 3
    g = geo["meta"]["geo"]
    return g["lon0"] + x / g["x_per_deg"], g["lat0"] - y / g["y_per_deg"]


def watch(page):
    """Console errors, except the analytics beacon (blocked off its own domain)."""
    errors, failed = [], []
    page.on("requestfailed", lambda r: failed.append(r.url))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "cloudflareinsights" not in m.text
            and not (m.text.startswith("Failed to load resource") and failed and "cloudflareinsights" in failed[-1])
            and errors.append(m.text))
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default="http://localhost:5180/wpr-budget/")
    ap.add_argument("--shots", help="save phone screenshots of the Tax Bill sections here")
    args = ap.parse_args()
    base = args.base
    dor = json.loads((PUBLIC / "marathon-tax-districts.json").read_text(encoding="utf-8"))
    geo = json.loads((PUBLIC / "marathon-map.json").read_text(encoding="utf-8"))
    wausau = next(m for m in dor["municipalities"] if m["type"] == "City" and m["name"] == "Wausau")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ---- the Tax Bill view, as a desktop reader in the City of Wausau ----
        ctx = browser.new_context(viewport={"width": 1100, "height": 900}, accept_downloads=True)
        page = ctx.new_page()
        errors = watch(page)
        page.goto(base + "#your-tax-bill")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("#neighbors .nb-row")

        # the bill adds up
        n = lambda s: int(re.sub(r"\D", "", s) or 0)  # noqa: E731
        lines = [n(t) for t in page.locator("#bill .jrow:not(.total):not(.credit) .jrow-amt").all_inner_texts()]
        totals = [n(t) for t in page.locator("#bill .jrow.total .jrow-amt").all_inner_texts()]
        check("bill: the lines add up to the taxes levied", sum(lines) == totals[0], f"{lines} vs {totals}")
        receipt = [n(t) for t in page.evaluate("[...document.querySelectorAll('#receipt .rc-gov td')].map((td) => td.firstChild.textContent)")]
        check("receipt: the governments add up to the bill", sum(receipt) == totals[0], f"{receipt} vs {totals[0]}")
        check("menu: the Tax Bill view's six sections", page.locator(".subnav a").count() == 6)

        # the year before, on the same value: the bill's line and the receipt agree
        sub = page.locator(".calc-out-sub").inner_text()
        check("bill: the change from last year, on the same value", re.search(r"\d{4}", sub) is not None, sub)
        pay = page.locator("#receipt .rc-total .rc-chg").inner_text()
        check("receipt: 'You pay' changes by the bill's change", n(pay) == n(sub.split("(")[0]), f"{pay} vs {sub}")

        # next door
        rows = page.locator("#neighbors .nb-row")
        counties = [t.split("\n")[0] for t in page.locator("#neighbors .nb-head b").all_inner_texts()]
        check("neighbors: Marathon and its eight neighbors", rows.count() == 9 and "Marathon County" in counties, str(counties))
        lede = page.locator("#neighbors .rank-lede").inner_text()
        check("neighbors: the lede names both ends' counties", sum(c in lede for c in counties) == 2 or lede.count("County") == 2, lede)
        typical = [n(t.split("·")[0]) for t in page.locator("#neighbors .nb-head span").all_inner_texts()]
        check("neighbors: sorted by typical bill, dearest first", typical == sorted(typical, reverse=True), str(typical))

        # is your assessment fair? (the reader's value, Wausau's own level, from the data)
        value = n(page.locator("#homeval-all").input_value())
        level = wausau["assessment_level"]
        field = page.locator("#assessment .card-field input")
        for want, f in (("fair", 1.0), ("high", 1.25), ("low", 0.7)):
            field.click()
            field.press("Control+a")
            field.type(str(round(level * value * f)))
            page.wait_for_timeout(120)
            cls = page.locator("#assessment .as-verdict").get_attribute("class") or ""
            check(f"assessment: {f:.2f} x the average reads as {want}", want in cls, cls)
        assessed = round(level * value * 0.7)
        page.locator("#assessment .as-ratio").fill("0.5")
        page.wait_for_timeout(120)
        implied = page.locator("#assessment .as-out p").first.inner_text()
        check("assessment: the bill's own ratio sets the implied value", usd(assessed / 0.5) in implied, implied)

        # key dates
        items = [t.splitlines() for t in page.locator("#dates .kd-list li").all_inner_texts()]
        check("dates: the City of Wausau's three installments, to its own treasurer",
              sum("City of Wausau Treasurer" in " ".join(i) for i in items) == 3, str(items))
        dated = [datetime.strptime(i[0], "%B %d, %Y") for i in items if re.search(r"\d{4}$", i[0])]
        check("dates: in date order", dated == sorted(dated), str(dated))
        check("dates: the bills and Open Book are on the timeline", sum(not re.search(r"\d{4}$", i[0]) for i in items) == 2)
        with page.expect_download() as dl:
            page.locator("#dates .kd-ics").click()
        ics = pathlib.Path(dl.value.path()).read_text(encoding="utf-8")
        check("dates: the calendar file holds every dated item",
              ics.startswith("BEGIN:VCALENDAR") and ics.rstrip().endswith("END:VCALENDAR") and ics.count("BEGIN:VEVENT") == len(dated))

        # the map's other view: the change since last year
        page.locator(".cmap-mode button").nth(1).click()
        page.wait_for_timeout(150)
        legend = page.locator(".cmap-legend").inner_text()
        shades = page.evaluate("new Set([...document.querySelectorAll('.cmap .cmap-shape')].map((p) => p.getAttribute('fill'))).size")
        check("map: the change view shades every place by its change", shades > 10 and "0" in legend, legend)
        page.locator(".cmap-mode button").nth(0).click()

        # the map zooms to the Wausau area and back
        page.locator(".cmap-zoom").click()
        page.wait_for_timeout(700)
        vb = page.locator(".cmap-wrap svg").get_attribute("viewBox")
        check("map: zooms to the Wausau area", not vb.startswith("0 0 "), vb)
        page.locator(".cmap-zoom").click()
        page.wait_for_timeout(700)
        vb = page.locator(".cmap-wrap svg").get_attribute("viewBox")
        check("map: and back out", vb == f"0 0 {geo['meta']['width']} {geo['meta']['height']}", vb)
        # "Print my bill": on paper, the reader's bill and none of the county-wide sections
        page.emulate_media(media="print")
        shown = {sel: page.locator(sel).first.is_visible() for sel in ("#receipt", "#dates", ".print-summary", ".print-foot")}
        hidden = {sel: page.locator(sel).first.is_visible() for sel in ("#compare", "#neighbors", ".tb-actions", ".loc")}
        check("print: the bill prints, the county-wide sections and controls don't",
              all(shown.values()) and not any(hidden.values()), f"shown {shown} hidden {hidden}")
        page.emulate_media(media="screen")
        check("Tax Bill view: no console errors", not errors, "; ".join(errors[:3]))
        ctx.close()

        # ---- the charts arrive on their own: every chart box filled, none left waiting ----
        ctx = browser.new_context(viewport={"width": 1100, "height": 900})
        page = ctx.new_page()
        for v in ("#marathon-county", "#wausau-city", "#wausau-school"):
            page.goto(base + v)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(500)
            charts, waiting = page.locator(".recharts-surface").count(), page.locator(".chart-wait").count()
            check(f"charts {v}: drawn once the library lands", charts >= 3 and waiting == 0, f"{charts} drawn, {waiting} waiting")
        ctx.close()

        # ---- "Use my location" on a phone, with real (granted) geolocation ----
        lon, lat = near_border(geo, "Schofield", "Rothschild")
        ctx = browser.new_context(geolocation={"latitude": lat, "longitude": lon, "accuracy": 40},
                                  permissions=["geolocation"], viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(base + "#your-tax-bill")
        page.wait_for_load_state("networkidle")
        page.locator(".loc-btn").click()
        page.wait_for_selector(".loc-alt")
        picked = page.locator("#muni-pick option:checked").inner_text()
        check("location: picks the municipality it's in", picked == "City of Schofield", picked)
        check("location: offers the neighbor across the line",
              "Village of Rothschild" in page.locator(".loc-alt").all_inner_texts(), page.locator(".loc-status").inner_text())
        check("phone: no sideways scroll", not page.evaluate("document.documentElement.scrollWidth > innerWidth"))
        if args.shots:
            out = pathlib.Path(args.shots)
            out.mkdir(parents=True, exist_ok=True)
            for sec in ("bill", "receipt", "compare", "neighbors", "assessment", "dates"):
                page.locator("#" + sec).screenshot(path=str(out / f"phone-{sec}.png"))
        ctx.close()

        # ---- type and targets on a phone: nothing under 12 px, no tap target under 24 px ----
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        for v in ("", "#your-tax-bill", "#marathon-county", "#wausau-city", "#wausau-school", "#card"):
            page.goto(base + v)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(300)
            tiny = page.evaluate(TINY_TEXT)
            check(f"type {v or '#home'}: no visible text under 12 px", not tiny, " | ".join(tiny[:3]))
            small = page.evaluate(SMALL_TARGETS)
            check(f"targets {v or '#home'}: none under 24 px", not small, " | ".join(small[:3]))
        fonts = page.evaluate("performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.woff2'))")
        check("fonts: the trimmed Fraunces, no Playfair", any("fraunces-opsz" in f for f in fonts)
              and not any("playfair" in f.lower() for f in fonts), str(fonts))
        ctx.close()

        # ---- every view, in every language ----
        ctx = browser.new_context(viewport={"width": 1100, "height": 900})
        page = ctx.new_page()
        errors = watch(page)
        page.goto(base)
        bad = []
        for lang in ("en", "es", "hmn"):
            page.evaluate(f"localStorage.setItem('wpr-budget-lang', '{lang}')")
            for r in ROUTES:
                before = len(errors)
                page.goto(base + "#" + r)
                page.reload()
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(300)
                if page.evaluate("document.documentElement.lang") != lang:
                    bad.append(f"{lang} {r}: <html lang> is {page.evaluate('document.documentElement.lang')}")
                if re.search(r"went wrong|couldn.t load", page.inner_text("body"), re.I) or len(errors) > before:
                    bad.append(f"{lang} {r}: {errors[before:][:1]}")
        check(f"every view in every language ({len(ROUTES) * 3})", not bad, "; ".join(bad[:4]))
        ctx.close()
        browser.close()

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
