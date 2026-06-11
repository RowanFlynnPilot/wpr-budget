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
    python scripts/extract_wausau.py "2026 Adopted Budget - Wausau.pdf" public/wausau-city.json [--cache]
"""
import re
import argparse

from lib import money, load_pages, find_page, reconcile, write_json


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
    reconcile(rows, total["current"], "current", "expenditure categories")
    return rows, total


def parse_levy_limit(text):
    """The levy-limit history table: '<levy yr> for <budget yr> <allowable>
    <actual> <exception> <under>'. We keep the actual levy plus the allowable
    (basic limit) and the exception — how far the city went over the basic state
    levy limit, via the debt-service exemption."""
    out = []
    for line in text.split("\n"):
        m = re.match(r"\d{4}\s+for\s+(\d{4})\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+|-)", line.strip())
        if m:
            out.append({
                "year": int(m.group(1)),
                "levy": money(m.group(3)),
                "allowable": money(m.group(2)),
                "exception": money(m.group(4)),
            })
    out.sort(key=lambda r: r["year"])
    if len(out) < 2:
        raise ValueError(f"levy-limit table parsed only {len(out)} rows")
    return out


def parse_personnel(text):
    """Personnel summary: FTE by department across ~11 years, reconciled to the
    printed Grand Total. Wrapped department names (e.g. 'Community\\nDevelopment')
    are stitched back together. The UI contract is newest-first arrays, so the
    year header must read newest-first — assert it rather than trust it."""
    lines = text.split("\n")
    years = None
    for ln in lines:
        ys = re.findall(r"20\d{2}", ln)
        if len(ys) >= 6 and "FTE" not in ln:
            years = [int(y) for y in ys]
            break
    if years is None:
        raise ValueError("personnel year header not found")
    if years[0] != max(years):
        raise ValueError(f"personnel years not newest-first ({years[:3]}…) — the schema/UI contract is newest-first")
    rows, total, pending = [], None, ""
    for ln in lines:
        s = ln.strip()
        m = re.match(r"^(.+?)\s+((?:\d+\.\d{2}\s*)+)$", s)
        if not m:
            if re.search(r"[A-Za-z]", s) and not re.search(r"\d", s) and len(s) < 40:
                pending = (pending + " " + s).strip()
            else:
                pending = ""
            continue
        label = re.sub(r"\s+", " ", (pending + " " + m.group(1)).strip())
        pending = ""
        fte = [float(x) for x in re.findall(r"\d+\.\d{2}", m.group(2))]
        if label.lower().startswith("grand total"):
            total = fte
        elif label.lower().startswith("city council"):
            continue  # the 11 elected alderpersons are listed but not staff FTE
        else:
            rows.append({"department": label, "fte": fte})
    if total is None:
        raise ValueError("personnel Grand Total row not found")
    calc = round(sum(r["fte"][0] for r in rows if r["fte"]), 2)
    if calc != total[0]:
        raise ValueError(f"personnel reconcile (latest year): parsed {calc} vs printed {total[0]}")
    return {"years": years, "rows": rows, "total": total}


def parse_tif(text):
    """Tax Increment Districts, from the budget message: per-district valuation
    growth, developer payments, and the net TID levy change. (Prose-embedded —
    no single table, so no reconcile; we capture the figures the city calls out.)"""
    growth, payments = [], []
    for line in text.split("\n"):
        s = line.strip()
        mp = re.search(r"TID\s+(\d+)\s*\D{0,3}\s*\$\s*([\d,]+)\s+(.+)", s)
        mg = re.search(r"TID\s+(\d+)\s*\D{0,3}\s*([\d.]+)%", s)
        if mp:
            payments.append({"tid": int(mp.group(1)), "amount": money(mp.group(2)), "note": mp.group(3).strip()})
        elif mg:
            growth.append({"tid": int(mg.group(1)), "growth": float(mg.group(2))})
    md = re.search(r"levy decrease of\s*\$\s*([\d,]+)", text)
    if not growth:
        raise ValueError("TIF valuation-growth list not found")
    if md is None:
        # No silent None: the UI renders this figure in prose. If the TID levy
        # rose this year, the wording changed — update schema/UI consciously.
        raise ValueError("TIF 'levy decrease of $X' phrase not found in the budget message")
    growth.sort(key=lambda r: r["tid"])
    return {
        "valuation_growth": growth,
        "developer_payments": payments,
        "levy_decrease": money(md.group(1)),
    }


# Each General Fund row: label + 2025 adopted/modified/estimated + 2026 adopted +
# increase + percent. We keep 2025 adopted (prior), 2026 adopted (proposed), pct.
GF_ROW = re.compile(
    r"^(.+?)\s+([\d,]+)\s+[\d,]+\s+[\d,]+\s+([\d,]+)\s+\(?[\d,]+\)?\s+(\(?-?[\d.]+%\)?)$")


def parse_general_fund(text):
    """General Fund 'Combined Statement of Expenditures' — department spending
    then revenue sources, each ending in a reconciling Total row.

    Column meaning is anchored on the page's own printed headers rather than
    assumed: the year line ('2025 2026 BUDGET') fixes which years the columns
    carry, and the ADOPTED/MODIFIED/ESTIMATED line fixes that column 1 is the
    prior year's ADOPTED budget. A reordered or added column raises instead of
    silently shifting figures — the Total rows shift identically, so the
    reconcile alone cannot catch that class of drift."""
    my = re.search(r"^(20\d{2})\s+(20\d{2})\s+BUDGET\s*$", text, re.M)
    if not my or int(my.group(2)) != int(my.group(1)) + 1:
        raise ValueError("GF statement year header ('<prior> <budget> BUDGET') not found or years not consecutive")
    if not re.search(r"^ADOPTED\s+MODIFIED\s+ESTIMATED\b", text, re.M):
        raise ValueError("GF statement column order is not ADOPTED/MODIFIED/ESTIMATED — re-anchor the row regex")
    years = (int(my.group(1)), int(my.group(2)))

    exp, rev, mode = [], [], "exp"
    exp_total = rev_total = None
    for line in text.split("\n"):
        m = GF_ROW.match(line.strip())
        if not m:
            continue
        label = m.group(1).strip()
        prior, proposed = money(m.group(2)), money(m.group(3))
        pct = float(m.group(4).strip("()%").replace("%", "")) if m.group(4) else None
        low = label.lower()
        if low == "total expenditures":
            exp_total = proposed
            mode = "rev"
            continue
        if low == "total revenues":
            rev_total = proposed
            break
        (exp if mode == "exp" else rev).append(
            {"category": label, "prior": prior, "proposed": proposed, "pct_change": pct})
    if exp_total is None or rev_total is None:
        raise ValueError("General Fund Total Expenditures/Revenues rows not found")
    reconcile(exp, exp_total, "proposed", "GF expenditures")
    reconcile(rev, rev_total, "proposed", "GF revenues")
    return {"expenditures": exp, "revenues": rev}, exp_total, rev_total, years


def parse_tax_by_jurisdiction(text):
    """'Property Tax Allocation by Taxing Jurisdiction' — the property-tax rate
    split across City / college / county / school, for the three most recent
    years. The per-jurisdiction rates sum to the printed Total Tax Rate.

    The year labels are read from the table's own column-header row (newest
    first), never hardcoded: next year's book shifts every column forward a
    year, and rates silently keyed to the wrong years would corrupt the City
    tax-bill view AND the suite-wide Your-Tax-Bill overview."""
    rows, total, years = [], None, None
    for line in text.split("\n"):
        s = line.strip()
        if years is None:
            # The column-header row carries the three years and no decimal rates.
            my = re.search(r"(20\d{2})\s+(20\d{2})\s+(20\d{2})", s)
            if my and not re.search(r"\d\.\d", s):
                years = [my.group(1), my.group(2), my.group(3)]
            continue  # rate rows before the header would be mislabeled — skip
        m = re.match(r"^(.+?)\s+\$?\s*([\d.]+)\s+\$?\s*([\d.]+)\s+\$?\s*([\d.]+)\b", s)
        if not m:
            continue
        r1, r2, r3 = float(m.group(2)), float(m.group(3)), float(m.group(4))
        if r1 > 100:  # not a per-$1,000 rate (e.g. a stray dollar figure)
            continue
        label = re.sub(r"\*+$", "", m.group(1).strip()).strip()
        if label.lower().startswith("total tax rate"):
            total = {years[0]: r1, years[1]: r2, years[2]: r3}
            break
        rows.append({"jurisdiction": label, "rates": {years[0]: r1, years[1]: r2, years[2]: r3}})
    if years is None:
        raise ValueError("jurisdiction table column-header years (e.g. '2025 2024 2023') not found")
    if total is None:
        raise ValueError("no 'Total Tax Rate' row found")
    calc = round(sum(r["rates"][years[0]] for r in rows), 2)
    if calc != total[years[0]]:
        raise ValueError(f"jurisdiction rate reconcile: {calc} vs printed {total[years[0]]}")
    return rows, total, years


def parse_debt(retire_text, limit_text):
    """General-obligation debt: the annual retirement schedule (principal +
    interest by year, reconciled to the printed totals) and the outstanding
    total from the debt-limit computation. Every figure is parsed or the run
    fails — no soft fallbacks."""
    retire, printed = [], None
    for line in retire_text.split("\n"):
        s = line.strip()
        m = re.match(r"^(20\d{2})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$", s)
        if m:
            retire.append({"year": int(m.group(1)), "principal": money(m.group(2)),
                           "interest": money(m.group(3)), "total": money(m.group(4))})
            continue
        mt = re.match(r"^([\d,]+)\s+([\d,]+)\s+([\d,]+)$", s)
        if mt and retire:
            printed = {"principal": money(mt.group(1)), "interest": money(mt.group(2)),
                       "total": money(mt.group(3))}
            break
    if printed is None:
        raise ValueError("debt retirement totals row not found")
    reconcile(retire, printed["principal"], "principal", "debt retirement")
    reconcile(retire, printed["total"], "total", "debt retirement")
    mo = re.search(r"Outstanding GO Debt\s+\$\s*[\d,]+\s+\$\s*([\d,]+)", limit_text)
    if not mo:
        raise ValueError("debt-limit 'Outstanding GO Debt' line not found")
    mu = re.search(r"% Utilized\s+[\d.]+%\s+([\d.]+)%", limit_text)
    if not mu:
        raise ValueError("debt-limit '% Utilized' line not found")
    return {
        "outstanding": money(mo.group(1)),
        "total_interest_remaining": printed["interest"],
        "pct_of_limit": float(mu.group(1)),
        "retirement": retire,
    }


# ---------- assembly ----------
def extract(pdf_path, cache=False):
    texts = load_pages(pdf_path, cache=cache)

    cat_text = texts[find_page(texts, "Budget By Expenditure Category")]
    categories, cat_total = parse_category(cat_text)

    levy_text = texts[find_page(texts, "for", "Allowable Levy")]
    levy_history = parse_levy_limit(levy_text)

    gf_text = texts[find_page(texts, "COMBINED STATEMENT OF EXPENDITURES - GENERAL FUND")]
    general_fund, gf_exp_total, gf_rev_total, gf_years = parse_general_fund(gf_text)

    juris_text = texts[find_page(texts, "PROPERTY TAX ALLOCATION BY TAXING JURISDICTION")]
    tax_by_jurisdiction, juris_total, rate_years = parse_tax_by_jurisdiction(juris_text)

    # "Existing General Obligation Debt" is unique to the GO retirement page; the
    # sewer/water revenue-bond pages share the "Annual Retirement" header.
    retire_text = texts[find_page(texts, "Existing General Obligation Debt")]
    limit_text = texts[find_page(texts, "COMPUTATION OF DEBT LIMIT")]
    debt = parse_debt(retire_text, limit_text)

    personnel = parse_personnel(texts[find_page(texts, "PERSONNEL SUMMARY", "Grand Total")])
    tif = parse_tif(texts[find_page(texts, "Valuation growth within the tax increment")])

    latest = max(l["year"] for l in levy_history)
    # Two independent spots in the book must agree on the budget year.
    if gf_years[1] != latest:
        raise ValueError(f"budget-year cross-check: GF statement says {gf_years[1]}, levy-limit table says {latest}")

    meta = {
        "entity": "City of Wausau",
        "kind": "city",
        "budget_year": latest,
        "total_expenditures": cat_total["current"],
        "tax_levy": next(l["levy"] for l in levy_history if l["year"] == latest),
        "gf_expenditures": gf_exp_total,
        "gf_revenues": gf_rev_total,
    }

    return {
        "meta": meta,
        "expenditure_categories": categories,
        "general_fund": general_fund,
        "levy_history": levy_history,
        "tax_by_jurisdiction": {"rate_years": rate_years, "rows": tax_by_jurisdiction, "total": juris_total},
        "debt": debt,
        "personnel": personnel,
        "tif": tif,
    }


def main():
    ap = argparse.ArgumentParser(description="Extract the City of Wausau adopted-budget book to JSON.")
    ap.add_argument("pdf", help="the adopted-budget PDF (downloaded by hand)")
    ap.add_argument("out", help="output JSON path (public/wausau-city.json)")
    ap.add_argument("--cache", action="store_true",
                    help="cache page texts in sources/ keyed on the PDF's size+mtime (fast re-runs)")
    args = ap.parse_args()
    data = extract(args.pdf, cache=args.cache)
    write_json(args.out, data)
    m = data["meta"]
    print(f"wrote {args.out}: {m['entity']} {m['budget_year']} | "
          f"total ${m['total_expenditures']:,} | levy ${m['tax_levy']:,} | "
          f"{len(data['expenditure_categories'])} categories | "
          f"GF {len(data['general_fund']['expenditures'])} depts / {len(data['general_fund']['revenues'])} rev sources | "
          f"{len(data['levy_history'])} levy yrs | "
          f"{len(data['tax_by_jurisdiction']['rows'])} jurisdictions | "
          f"debt ${data['debt']['outstanding']:,}, {len(data['debt']['retirement'])} retirement yrs | "
          f"personnel {len(data['personnel']['rows'])} depts x {len(data['personnel']['years'])} yrs (latest {data['personnel']['total'][0]} FTE) | "
          f"levy exception ${next(l['exception'] for l in data['levy_history'] if l['year']==m['budget_year']):,} | "
          f"TIF {len(data['tif']['valuation_growth'])} districts, {len(data['tif']['developer_payments'])} payments")


if __name__ == "__main__":
    main()
