"""Social share cards (1200x630 og:image) that carry the numbers.

    python scripts/og_cards.py

Writes public/og-image.png (the suite), public/og-your-tax-bill.png (the Tax Bill
view and every /tax/<town>/ page) and public/og-<entity>-<edition>.png for each
budget-season edition, plus public/og-cards.json with every figure drawn.
scripts/check-data.mjs recomputes those figures from the data with the app's own
formula (src/taxmath.js) and fails the deploy when a card is stale, so: rerun this
after any data change that moves them, and commit the PNGs with the JSON.

Fonts: Georgia Bold + Arial, from the Windows font folder (the same faces as the
original suite card); Pillow ships with pdfplumber (scripts/requirements.txt).
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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


def taxbill_card(x):
    im, d = frame("FOLLOW THE MONEY  ·  YOUR TAX BILL")
    d.text((70, 186), "What does your home pay?", font=fit(d, "What does your home pay?", SERIF, 80), fill=INK)
    d.text((72, 300), f"{usd(x['lo'])} – {usd(x['hi'])}", font=SERIF(92), fill=ACCENT)
    line = (f"a year on the same $200,000 home, depending on which of Marathon County's "
            f"{x['municipalities']} cities, villages and towns it sits in. See your whole bill.")
    y = 418
    for ln in wrap(d, line, SANS(30), W - 144):
        d.text((72, y), ln, font=SANS(30), fill=SOFT)
        y += 40
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
    figures = {"suite": x, taxbill["id"]: x}
    suite_card(x).save(PUBLIC / "og-image.png", optimize=True)
    taxbill_card(x).save(PUBLIC / f"og-{taxbill['id']}.png", optimize=True)
    for e in entities:
        for ed in e.get("editions", []):
            b = json.loads((PUBLIC / ed["data"]).read_text(encoding="utf-8"))
            f = edition_figures(b, ed)
            slug = f"{e['id']}-{ed['id']}"
            figures[slug] = f
            edition_card(e["name"], f).save(PUBLIC / f"og-{slug}.png", optimize=True)
    (PUBLIC / "og-cards.json").write_text(json.dumps(figures, indent=2) + "\n", encoding="utf-8")
    print("wrote", ", ".join(["og-image.png", f"og-{taxbill['id']}.png"] + [f"og-{k}.png" for k in figures if k not in ("suite", taxbill["id"])]))


if __name__ == "__main__":
    main()
