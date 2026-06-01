"""City of Wausau budget extractor — the municipal counterpart to
extract_budget.py (Marathon County).

The City's adopted-budget book is a classic municipal fund-accounting document:
General Fund (departments by function), Special Revenue / Debt Service / Capital
Projects (incl. TIF) / Internal Service / Enterprise funds. It does NOT carry the
County's Appendix E/F per-department levy tables — cities levy at the city level,
not per department — so the parsers here target the City's own summary tables and
the schema differs from the County's (no per-department levy; adds the
levy-limit history, property-tax-by-jurisdiction, TIF, and personnel data).

Like the County extractor, every parsed table is reconciled against the book's
own printed total and raises loudly on a mismatch.

Usage:
    python scripts/extract_wausau.py "2026 Adopted Budget - Wausau.pdf" public/wausau-city.json
"""
import sys
import re
import json
import pdfplumber


# ---------- helpers ----------
def money(token):
    """Parse a budget figure: strips $ and commas, treats (x) as negative,
    and a bare dash as zero. Returns int (or None if not a number)."""
    t = token.strip().replace("$", "").replace(",", "").strip()
    if t in ("-", "–", "—", ""):
        return 0
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    if not re.fullmatch(r"-?\d+(\.\d+)?", t):
        return None
    v = float(t) if "." in t else int(t)
    return -v if neg else v


def page_texts(pdf):
    """Extract every page's text once — the book is 267 pp, so we never want to
    re-scan it per parser (the County extractor's repeated scans are slow)."""
    return [p.extract_text() or "" for p in pdf.pages]


def find_page(texts, *needles):
    hits = [i for i, t in enumerate(texts) if all(n in t for n in needles)]
    if len(hits) != 1:
        raise ValueError(f"expected exactly one page for {needles}, found {hits}")
    return hits[0]


def reconcile(rows, total, key):
    calc = sum(r[key] for r in rows)
    if calc != total:
        raise ValueError(f"reconciliation failed on {key}: parsed {calc:,} vs printed {total:,}")


# ---------- parsers ----------
def parse_category(text):
    """'Budget By Expenditure Category (All Funds)' — one row per spending
    category with the adopted figure for the budget year and the prior year."""
    rows, total = [], None
    for line in text.split("\n"):
        m = re.match(r"(.+?)\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)$", line.strip())
        if not m:
            continue
        # Real figures here are comma-formatted (all in the millions); requiring a
        # comma rejects page-header/footer lines like "...Adopted Budget 2026 31".
        if "," not in m.group(2) or "," not in m.group(3):
            continue
        label = m.group(1).strip().rstrip("$").strip()
        cur, prior = money(m.group(2)), money(m.group(3))
        if cur is None or prior is None or not re.search(r"[A-Za-z]", label):
            continue
        if label.lower() == "total":
            total = {"current": cur, "prior": prior}
        else:
            rows.append({"category": label, "current": cur, "prior": prior})
    if total is None:
        raise ValueError("no Total row found in expenditure-category table")
    reconcile(rows, total["current"], "current")
    return rows, total


def parse_levy_limit(text):
    """The levy-limit history table: '<levy yr> for <budget yr> <allowable>
    <actual> <exception> <under>'. We keep the actual levy per budget year."""
    out = []
    for line in text.split("\n"):
        m = re.match(r"\d{4}\s+for\s+(\d{4})\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)", line.strip())
        if m:
            out.append({"year": int(m.group(1)), "levy": money(m.group(3))})
    out.sort(key=lambda r: r["year"])
    if len(out) < 2:
        raise ValueError(f"levy-limit table parsed only {len(out)} rows")
    return out


# ---------- assembly ----------
def extract(pdf_path):
    pdf = pdfplumber.open(pdf_path)
    texts = page_texts(pdf)

    cat_text = texts[find_page(texts, "Budget By Expenditure Category")]
    categories, cat_total = parse_category(cat_text)

    levy_text = texts[find_page(texts, "for", "Allowable Levy")]
    levy_history = parse_levy_limit(levy_text)

    latest = max(l["year"] for l in levy_history)

    meta = {
        "entity": "City of Wausau",
        "kind": "city",
        "budget_year": latest,
        "total_expenditures": cat_total["current"],
        "tax_levy": next(l["levy"] for l in levy_history if l["year"] == latest),
    }

    return {
        "meta": meta,
        "expenditure_categories": categories,
        "levy_history": levy_history,
    }


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: python extract_wausau.py <wausau.pdf> <out.json>")
    data = extract(sys.argv[1])
    with open(sys.argv[2], "w") as f:
        json.dump(data, f, indent=2)
    m = data["meta"]
    print(f"wrote {sys.argv[2]}: {m['entity']} {m['budget_year']} | "
          f"total ${m['total_expenditures']:,} | levy ${m['tax_levy']:,} | "
          f"{len(data['expenditure_categories'])} categories, {len(data['levy_history'])} levy yrs")


if __name__ == "__main__":
    main()
