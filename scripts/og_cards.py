"""Social share cards (1200x630 og:image) that carry the numbers.

    python scripts/og_cards.py

Writes public/og-image.png (the suite), public/og-your-tax-bill.png (the Tax Bill
view and every /tax/<town>/ page - with the county map, every municipality
shaded by its bill as on the page) and public/og-<entity>-<edition>.png for each
budget-season edition, plus public/og-cards.json with every figure drawn (the
map's: each municipality's bill and the boundaries' date).
scripts/check-data.mjs recomputes those figures from the data with the app's own
formula (src/taxmath.js) and fails the deploy when a card is stale, so: rerun this
after any data change that moves them, and commit the PNGs with the JSON.

Fonts: Georgia Bold + Arial, from the Windows font folder (the same faces as the
original suite card); Pillow ships with pdfplumber (scripts/requirements.txt).
"""
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
FONTS = Path("C:/Windows/Fonts")

W, H = 1200, 630
PAPER = (243, 234, 216)
TEAL = (13, 115, 119)
RULE = (210, 198, 176)
GOLD = (154, 123, 46)
GOLD_INK = (122, 95, 31)
RUST = (168, 73, 47)
ACCENT = (22, 88, 74)
INK = (28, 26, 22)
SOFT = (90, 84, 70)
PAPER_MAP = (245, 241, 232)  # --paper: the map's borders
PILLS = [("Marathon County", ACCENT), ("City of Wausau", GOLD), ("Wausau Schools", RUST), ("Your Tax Bill", TEAL)]


def font(name, size):
    path = FONTS / name
    if not path.exists():
        raise SystemExit(f"missing font {path} (this script runs on Windows)")
    return ImageFont.truetype(str(path), size)


SERIF = lambda s: font("georgiab.ttf", s)  # noqa: E731
SANS = lambda s: font("arial.ttf", s)  # noqa: E731
SANS_B = lambda s: font("arialbd.ttf", s)  # noqa: E731


def tracked(d, x, y, text, f, fill, tracking=2.5):
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + tracking
    return x


def fit(d, text, make, size, width=W - 144):
    """The largest size (from `size` down) at which `text` fits the width."""
    while d.textlength(text, font=make(size)) > width:
        size -= 2
    return make(size)


def wrap(d, text, f, width):
    lines, line = [], ""
    for word in text.split():
        trial = (line + " " + word).strip()
        if d.textlength(trial, font=f) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def frame(kicker, kicker_fill=GOLD_INK):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    tracked(d, 72, 56, "WAUSAU PILOT & REVIEW", SANS_B(26), TEAL, 1.5)
    d.rectangle([72, 102, W - 72, 103], fill=RULE)
    tracked(d, 72, 146, kicker, SANS_B(22), kicker_fill, 2)
    return im, d


def pills(d, y=500):
    x = 72
    for label, color in PILLS:
        f = SANS_B(26)
        w = d.textlength(label, font=f) + 38
        d.rounded_rectangle([x, y, x + w, y + 52], radius=26, fill=color)
        d.text((x + 19, y + 11), label, font=f, fill=(255, 255, 255))
        x += w + 16


def usd(n):
    return "$" + f"{round(n):,}"


# ---- the figures, from the committed data (check-data recomputes each one) ----
def bill_total(m, sd):
    # the formula in src/taxmath.js (billParts), per $1,000 of fair market value
    per1k = lambda levy, value: levy / value * 1000  # noqa: E731
    return (per1k(m["taxes"]["county"], m["full_value_ex_tif"]) + per1k(m["taxes"]["local"], m["full_value_ex_tif"])
            + per1k(m["taxes"]["technical_college"], m["full_value_ex_tif"])
            + per1k(sd["levy"], sd["full_value"]) - per1k(m["school_levy_credit"], m["full_value"]))


def net_bill(m, sd, credits, value=200000):
    # netBill in src/taxmath.js: the levies at the bill rate, less the state's
    # lottery & gaming and first-dollar credits for a primary home
    credit = sd["credit_rate"] * (min(credits["lottery_max_value"], value) + min(credits["first_dollar_max_value"], value))
    return max(0, value / 1000 * bill_total(m, sd) - credit)


def extremes(dor):
    credits = dor["meta"]["credits"]
    pairs = sorted(((net_bill(m, sd, credits), m, sd) for m in dor["municipalities"] for sd in m["school_districts"]),
                   key=lambda p: p[0])
    (lo, mlo, _), (hi, mhi, _) = pairs[0], pairs[-1]
    return {"lo": round(lo), "lo_place": f"{mlo['type']} of {mlo['name']}",
            "hi": round(hi), "hi_place": f"{mhi['type']} of {mhi['name']}",
            "municipalities": len(dor["municipalities"])}


def map_bills(dor):
    # muniBills in src/taxmath.js: each municipality's bill on a $200,000 primary
    # home, in its largest school district (DOR lists districts largest first)
    credits = dor["meta"]["credits"]
    return {m["code"]: net_bill(m, m["school_districts"][0], credits) for m in dor["municipalities"]}


def js_round(x):
    # Math.round, as check-data recomputes these (Python's round() is banker's)
    return math.floor(x + 0.5)


# ---- the county map (public/marathon-map.json), shaded as rampColor in ui.jsx ----
RAMP = [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
        for h in json.loads((ROOT / "src" / "map-ramp.json").read_text(encoding="utf-8"))]


def ramp_color(f):
    x = min(1, max(0, f)) * (len(RAMP) - 1)
    i = min(len(RAMP) - 2, math.floor(x))
    a, b = RAMP[i], RAMP[i + 1]
    return tuple(js_round(v + (b[k] - v) * (x - i)) for k, v in enumerate(a))


def rings(d):
    """An SVG path of 'M x y l dx dy ... z' rings (extract_map.py) -> point lists."""
    out, ring, mode = [], None, None
    tokens = re.findall(r"[Mlz]|-?\d+", d)
    i = 0
    while i < len(tokens):
        if tokens[i] in ("M", "l", "z"):
            mode = tokens[i]
            if mode == "z":
                out.append(ring)
            i += 1
            continue
        x, y = int(tokens[i]), int(tokens[i + 1])
        i += 2
        if mode == "M":
            ring = [(x, y)]
        else:
            ring.append((ring[-1][0] + x, ring[-1][1] + y))
    return out


def county_map(geo, fill_of, width, pins=()):
    """The map, `width` px wide (drawn at 3x and scaled down for smooth edges):
    each municipality filled even-odd (an enclave is its neighbor's own shape),
    paper borders, the county outline; pins = [(code, label, solid)] on top."""
    k = 3
    W, H = geo["meta"]["width"], geo["meta"]["height"]
    s = width * k / W
    size = (width * k, round(H * s))
    art = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(art)
    pt = lambda p: (p[0] * s, p[1] * s)  # noqa: E731
    for shape in geo["shapes"]:
        mask = Image.new("1", size, 0)
        for r in rings(shape["d"]):
            one = Image.new("1", size, 0)
            ImageDraw.Draw(one).polygon([pt(p) for p in r], fill=1)
            mask = ImageChops.logical_xor(mask, one)
        art.paste(fill_of(shape["code"]) + (255,), (0, 0), mask)
    for shape in geo["shapes"]:
        for r in rings(shape["d"]):
            draw.line([pt(p) for p in r + r[:1]], fill=PAPER_MAP, width=2, joint="curve")
    for r in rings(geo["outline"]):
        draw.line([pt(p) for p in r + r[:1]], fill=SOFT, width=4, joint="curve")
    art = art.resize((width, round(H * width / W)), Image.LANCZOS)
    d = ImageDraw.Draw(art)
    for code, label, solid in pins:
        x, y = next(sh["label"] for sh in geo["shapes"] if sh["code"] == code)
        x, y = x * width / W, y * width / W
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=INK if solid else PAPER_MAP, outline=INK, width=3)
        f = SANS_B(20)
        tw = d.textlength(label, font=f)
        lx = x + 12 if x + 12 + tw + 12 <= art.width else x - 12 - tw - 12
        d.rectangle([lx, y - 15, lx + tw + 12, y + 15], fill=PAPER_MAP, outline=INK, width=2)
        d.text((lx + 6, y - 12), label, font=f, fill=INK)
    return art


def edition_figures(b, ed):
    lh = b["levy_history"]
    rises = [(lh[i]["year"], lh[i]["levy"] / lh[i - 1]["levy"]) for i in range(1, len(lh))]
    last = rises[-1][1]
    beaten = [y for y, r in rises[:-1] if r >= last]
    if last <= 1:
        rank = None
    elif not beaten:
        rank = f"the largest rise in records back to {lh[0]['year']}"
    elif beaten[-1] != rises[-2][0]:
        rank = f"the largest rise since {beaten[-1]}"
    else:
        rank = None
    home = b["homeowner_impact"][-1]
    return {"levy_pct": round((last - 1) * 100, 1), "levy_rank": rank,
            "typical_bill": round(home["tax_amount"]), "typical_pct": round(home["pct_change_bill"], 1),
            "hearing": ed["hearing"], "vote": ed["vote"], "year": ed["year"]}


def day(iso):
    from datetime import date
    dt = date.fromisoformat(iso)
    return dt.strftime("%B ") + str(dt.day)


def suite_card(x):
    im, d = frame("THE PUBLIC LEDGER")
    d.text((70, 186), "Follow the Money", font=SERIF(104), fill=INK)
    line = (f"The same $200,000 home pays {usd(x['lo'])} a year in the {x['lo_place']} and {usd(x['hi'])} "
            f"in the {x['hi_place']}, after state credits.")
    y = 330
    for ln in wrap(d, line, SERIF(36), W - 144):
        d.text((72, y), ln, font=SERIF(36), fill=INK)
        y += 48
    pills(d, 512)
    return im


def taxbill_card(x, geo, bills):
    im, d = frame("FOLLOW THE MONEY  ·  YOUR TAX BILL")
    d.text((70, 182), "What does your home pay?", font=fit(d, "What does your home pay?", SERIF, 76), fill=INK)
    # left: the range and what it means; right: where - the county, shaded
    col = 520
    rng = f"{usd(x['lo'])} – {usd(x['hi'])}"
    d.text((72, 296), rng, font=fit(d, rng, SERIF, 80, col), fill=ACCENT)
    line = (f"a year on the same $200,000 home, after state credits, depending on which of "
            f"Marathon County's {x['municipalities']} cities, villages and towns it sits in.")
    y = 398
    for ln in wrap(d, line, SANS(27), col):
        d.text((72, y), ln, font=SANS(27), fill=SOFT)
        y += 36
    lo, hi = min(bills.values()), max(bills.values())
    lo_code = next(c for c, b in bills.items() if b == lo)
    hi_code = next(c for c, b in bills.items() if b == hi)
    mx, my = 648, 280
    mw = W - 72 - mx
    art = county_map(geo, lambda c: ramp_color((bills[c] - lo) / (hi - lo)), mw,
                     pins=[(lo_code, usd(lo), False), (hi_code, usd(hi), True)])
    im.paste(art, (mx, my), art)
    # the legend: the ramp, light (lowest bill) to dark (highest)
    by = my + art.height + 12
    for i in range(mw):
        d.line([(mx + i, by), (mx + i, by + 12)], fill=ramp_color(i / (mw - 1)))
    d.text((mx, by + 20), "lower bill", font=SANS(19), fill=SOFT)
    tw = d.textlength("higher bill", font=SANS(19))
    d.text((W - 72 - tw, by + 20), "higher bill", font=SANS(19), fill=SOFT)
    return im


def edition_card(name, f):
    im, d = frame(f"FOLLOW THE MONEY  ·  PROPOSED, NOT YET ADOPTED", RUST)
    title = f"{name}’s {f['year']} budget"
    d.text((70, 186), title, font=fit(d, title, SERIF, 70), fill=INK)
    sign = "+" if f["levy_pct"] >= 0 else "−"
    d.text((72, 292), f"{sign}{abs(f['levy_pct']):.1f}%", font=SERIF(96), fill=RUST)
    col = 72 + d.textlength(f"{sign}{abs(f['levy_pct']):.1f}%", font=SERIF(96)) + 28
    y = 304
    for ln in wrap(d, "county tax levy" + (f", {f['levy_rank']}" if f["levy_rank"] else ""), SANS(30), W - 72 - col):
        d.text((col, y), ln, font=SANS(30), fill=INK)
        y += 38
    tsign = "+" if f["typical_pct"] >= 0 else "−"
    d.text((72, 420), f"{usd(f['typical_bill'])} county tax on a typical home ({tsign}{abs(f['typical_pct']):.1f}%)",
           font=SANS_B(32), fill=INK)
    d.rectangle([72, 492, W - 72, 493], fill=RULE)
    d.text((72, 516), f"Public hearing {day(f['hearing'])}  ·  County Board vote {day(f['vote'])}", font=SANS_B(30), fill=TEAL)
    return im


def main():
    entities = json.loads((ROOT / "src" / "entities.json").read_text(encoding="utf-8"))
    taxbill = next(e for e in entities if e["kind"] == "taxbill")
    dor = json.loads((PUBLIC / taxbill["data"]).read_text(encoding="utf-8"))
    x = extremes(dor)
    geo = json.loads((PUBLIC / taxbill["with"]["map"]).read_text(encoding="utf-8"))
    bills = map_bills(dor)
    figures = {"suite": x, taxbill["id"]: x,
               "map": {"boundaries_as_of": geo["meta"]["boundaries_as_of"],
                       "bills": {c: js_round(b) for c, b in bills.items()}}}
    suite_card(x).save(PUBLIC / "og-image.png", optimize=True)
    taxbill_card(x, geo, bills).save(PUBLIC / f"og-{taxbill['id']}.png", optimize=True)
    for e in entities:
        for ed in e.get("editions", []):
            b = json.loads((PUBLIC / ed["data"]).read_text(encoding="utf-8"))
            f = edition_figures(b, ed)
            slug = f"{e['id']}-{ed['id']}"
            figures[slug] = f
            edition_card(e["name"], f).save(PUBLIC / f"og-{slug}.png", optimize=True)
    (PUBLIC / "og-cards.json").write_text(json.dumps(figures, indent=2) + "\n", encoding="utf-8")
    print("wrote", ", ".join(["og-image.png", f"og-{taxbill['id']}.png"]
                             + [f"og-{k}.png" for k in figures if k not in ("suite", taxbill["id"], "map")]))


if __name__ == "__main__":
    main()
