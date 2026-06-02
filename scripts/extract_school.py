"""Wausau School District budget extractor — the third "Follow the Money" entity,
after Marathon County (extract_budget.py) and the City of Wausau (extract_wausau.py).

A Wisconsin school district is a *third kind* of government: fund-accounting (Fund
10 General, 27 Special Education, 38/39 Debt Service, 50 Food Service, 80 Community
Service, etc.) levied district-wide under a state revenue limit, with no
per-department tax levy. So its schema and body (SchoolLedger) differ from both the
County's (per-department levy) and the City's (municipal funds + per-jurisdiction
tax split).

Source: the district's "Annual Budget Book" (the annual-meeting budget), a clean
tabular PDF. The honest "where it goes" for a school is BY OBJECT — salaries and
benefits are ~69% of the General Fund — because the book budgets salaries centrally,
not per school, so per-school dollar lines are tiny non-salary allocations and would
mislead. We therefore lead with the object breakdown, which reconciles exactly.

Like the County and City extractors, every parsed table is reconciled against the
book's own printed total and raises loudly on a mismatch.

Phase 2 (not yet ingested — needs DPI data downloaded by hand): per-student spending
vs. the state average, and enrollment/membership history. DPI blocks datacenter IPs
(same Akamai class as the county site), so those are a manual download.

Usage:
    python scripts/extract_school.py sources/2026-Wausau-School-Budget.pdf public/wausau-school.json
"""
import sys
import re
import io
import csv
import json
import zipfile
import pdfplumber


# ---------- helpers ----------
def money(token):
    """Parse a budget figure: strips $ and commas, treats (x) as negative, a bare
    dash as zero. pdfplumber sometimes splits the leading digit off a large number
    ('9 4,388,547'), so internal spaces are stripped too. Returns int/float or None."""
    t = token.strip().replace("$", "").replace(" ", "").replace(",", "").strip()
    if t in ("-", "–", "—", ""):
        return 0
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    if not re.fullmatch(r"-?\d+(\.\d+)?", t):
        return None
    v = float(t) if "." in t else int(t)
    return -v if neg else v


def page_texts(pdf):
    return [p.extract_text() or "" for p in pdf.pages]


def find_page(texts, *needles):
    """Exactly-one page locator (robust to page-number drift year to year)."""
    needles = [n.lower() for n in needles]
    hits = [i for i, t in enumerate(texts) if all(n in t.lower() for n in needles)]
    if len(hits) != 1:
        raise ValueError(f"expected exactly one page for {needles}, found {hits}")
    return hits[0]


def find_section(texts, *needles):
    """Combine the contiguous run of pages, starting at the first match, where every
    needle is present. Fund detail tables (revenue/expenditure) span several pages and
    repeat the same subtotal labels across funds, so we slice to one fund's run."""
    needles = [n.lower() for n in needles]
    hits = [i for i, t in enumerate(texts) if all(n in t.lower() for n in needles)]
    if not hits:
        raise ValueError(f"no page found for {needles}")
    start = end = hits[0]
    for i in hits[1:]:
        if i == end + 1:
            end = i
        else:
            break
    return "\n".join(texts[start:end + 1])


def reconcile(rows, total, key, label):
    calc = sum(r[key] for r in rows)
    if calc != total:
        raise ValueError(f"reconciliation failed on {label} ({key}): parsed {calc:,} vs printed {total:,}")


def reconcile_within(rows, total, key, label, tol):
    """Like reconcile() but tolerates a small rounding gap. Used only for descriptive
    line-item detail whose own printed subtotal in the book rounds (the district
    prints, e.g., a $56,987,028 salaries subtotal whose 22 line items sum to
    $56,987,027). The authoritative figure is the printed subtotal, which itself
    reconciles exactly into the by-object grand total; this guards the detail without
    failing on the source's own $1 rounding."""
    calc = sum(r[key] for r in rows)
    if abs(calc - total) > tol:
        raise ValueError(f"reconciliation failed on {label} ({key}): parsed {calc:,} vs printed {total:,} (tol {tol})")


def two_nums(rest):
    """First two signed comma-numbers in a string -> (current, prior)."""
    nums = re.findall(r"\(?-?\$?[\d,]+\)?", rest)
    vals = [money(n) for n in nums]
    vals = [v for v in vals if v is not None]
    if len(vals) < 2:
        raise ValueError(f"expected >=2 numbers in: {rest!r}")
    return vals[0], vals[1]


# ---------- parsers ----------
# Revenue/expenditure line markers in the all-funds summary, split by side.
FUND_REV = ("REVENUE & OTHER FINANCING SOURCES", "NET REVENUE & OTHER FINANCING SOURCES",
            "OPERATING TRANSFER IN", "REVENUE FROM PRIOR YEARS")
FUND_EXP = ("EXPENDITURES & OTHER FINANCING USES", "NET EXPENDITURES & OTHER FINANCING USES",
            "OPERATING TRANSFER OUT")
FUND_HDR = re.compile(r"^(?:OTHER\s+)?FUND\s+(\d+)\s*[-:]\s*(.+)$")


def parse_funds(text):
    """All-funds summary: per-fund revenue and expenditure (current + prior),
    summing the fund's revenue-side and expenditure-side lines. Reconciles to the
    book's printed GROSS TOTAL REVENUES / GROSS TOTAL EXPENDITURES."""
    funds, cur, gross_rev, gross_exp, net_exp = [], None, None, None, None
    for raw in text.split("\n"):
        s = raw.strip()
        if s.startswith("TOTAL REVENUE & OTHER FINANCING SOURCES ALL FUNDS"):
            cur = None  # stop accumulating into funds; grand-total block begins
        mh = FUND_HDR.match(s)
        if mh and not s.startswith("TOTAL"):
            name = re.split(r"\s{2,}|\s+\$?\d", mh.group(2))[0].strip()
            cur = {"fund_no": int(mh.group(1)), "name": name.title(),
                   "revenues": 0, "expenditures": 0, "prior_revenues": 0, "prior_expenditures": 0}
            funds.append(cur)
            continue
        if cur is not None:
            for lab in FUND_REV:
                if s.startswith(lab):
                    c, p = two_nums(s[len(lab):])
                    cur["revenues"] += c; cur["prior_revenues"] += p
                    break
            for lab in FUND_EXP:
                if s.startswith(lab):
                    c, p = two_nums(s[len(lab):])
                    cur["expenditures"] += c; cur["prior_expenditures"] += p
                    break
        if s.startswith("GROSS TOTAL REVENUES"):
            gross_rev = two_nums(s[len("GROSS TOTAL REVENUES"):])[0]
        elif s.startswith("GROSS TOTAL EXPENDITURES"):
            gross_exp = two_nums(s[len("GROSS TOTAL EXPENDITURES"):])[0]
        elif s.startswith("NET TOTAL EXPENDITURES"):
            net_exp = two_nums(s[len("NET TOTAL EXPENDITURES"):])[0]
    if gross_rev is None or gross_exp is None or net_exp is None:
        raise ValueError("all-funds gross/net total rows not found")
    reconcile(funds, gross_rev, "revenues", "funds")
    reconcile(funds, gross_exp, "expenditures", "funds")
    return funds, {"gross_revenues": gross_rev, "gross_expenditures": gross_exp, "net_expenditures": net_exp}


# General Fund revenue source-category subtotals (each unique in the book).
REV_SOURCES = [
    ("Local Sources", "TOTAL LOCAL SOURCES"),
    ("Other School Districts", "TOTAL OTHER SCHOOL DISTRICT"),
    ("State Grants", "TOTAL STATE GRANTS"),
    ("State Aids", "TOTAL STATE AIDS"),
    ("Federal Grants", "TOTAL FEDERAL GRANTS"),
    ("Federal Aid", "TOTAL FEDERAL AID"),
]


def parse_gf_revenues(text, gf_total):
    """General Fund revenue by source — the six printed category subtotals,
    reconciled to the Fund 10 revenue grand total."""
    rows = []
    for source, marker in REV_SOURCES:
        hits = [ln.strip() for ln in text.split("\n") if ln.strip().startswith(marker)]
        if len(hits) != 1:
            raise ValueError(f"expected one '{marker}' line, found {len(hits)}")
        c, p = two_nums(hits[0][len(marker):])
        rows.append({"source": source, "amount": c, "prior": p})
    reconcile(rows, gf_total, "amount", "gf_revenues")
    return rows


def grab_line(text, marker):
    """Exactly-one line starting with marker -> (current, prior)."""
    hits = [ln.strip() for ln in text.split("\n") if ln.strip().startswith(marker)]
    if len(hits) != 1:
        raise ValueError(f"expected one '{marker}' line, found {len(hits)}")
    return two_nums(hits[0][len(marker):])


def parse_object_lines(text, header_marker, stop_markers):
    """Parse the indented line items under a SALARIES / BENEFITS block. Each line is
    '<3-digit code><label> <current> <prior> ...'; we strip the leading account code."""
    rows, on = [], False
    for raw in text.split("\n"):
        s = raw.strip()
        if s.startswith(header_marker):
            on = True
            continue
        if not on:
            continue
        if any(s.startswith(m) for m in stop_markers):
            break
        m = re.match(r"^(\d{3})\s*([A-Za-z].*?)\s+(\(?-?\$?[\d,]+\)?)\s+\$?\s*(\(?-?[\d,]+\)?)\b", s)
        if not m:
            continue
        # Drop the book's trailing budget-coding flag (a lone "E"/"R" after the name,
        # e.g. "Teachers E", "Other Certified Teachers R").
        label = re.sub(r"\s+[A-Z]$", "", m.group(2).strip())
        cur, prior = money(m.group(3)), money(m.group(4))
        if cur is None or prior is None:
            continue
        rows.append({"label": label, "amount": cur, "prior": prior})
    return rows


def parse_gf_expenditures(text, gf_total):
    """General Fund spending BY OBJECT — Salaries, Benefits, Non-Salary Operating,
    Transfers to Other Funds — reconciled exactly to the Fund 10 budget total. Plus
    salary-line and benefit-line detail (each reconciled to its own subtotal)."""
    sal_c, sal_p = grab_line(text, "K TOTAL SALARIES")
    ben_c, ben_p = grab_line(text, "L TOTAL BENEFITS")
    non_c, non_p = grab_line(text, "TOTAL NON-SALARY/BENEFIT")
    t27_c, t27_p = grab_line(text, "TRANSFER TO FUND 27")
    t38_c, t38_p = grab_line(text, "TRANSFER TO FUND 38")
    transfers_c, transfers_p = t27_c + t38_c, t27_p + t38_p

    by_object = [
        {"object": "Salaries", "amount": sal_c, "prior": sal_p},
        {"object": "Benefits", "amount": ben_c, "prior": ben_p},
        {"object": "Non-Salary Operating", "amount": non_c, "prior": non_p},
        {"object": "Transfers to Other Funds", "amount": transfers_c, "prior": transfers_p},
    ]
    reconcile(by_object, gf_total, "amount", "gf_expenditures by_object")

    salary_lines = parse_object_lines(text, "K1 SALARIES", ["K TOTAL SALARIES"])
    benefit_lines = parse_object_lines(text, "L1 BENEFITS", ["L TOTAL BENEFITS"])
    reconcile_within(salary_lines, sal_c, "amount", "salary lines", 1)
    reconcile_within(benefit_lines, ben_c, "amount", "benefit lines", 1)

    return {
        "total": gf_total,
        "by_object": by_object,
        "salary_lines": sorted(salary_lines, key=lambda r: -r["amount"]),
        "benefit_lines": sorted(benefit_lines, key=lambda r: -r["amount"]),
    }


# Levy-by-fund row: label, current levy $, prior levy $, $ change, % change, mill rate.
LEVY_ROW = re.compile(
    r"^(.+?)\s+\$?\s*([\d,]+)\s+\$?\s*([\d,]+)\s+\(?\$?\s*[\d,]+\)?\s+-?[\d.]+%\s+([\d.]+)$")


def parse_levy_by_fund(text):
    """Per-fund tax levy and equalized mill rate, reconciled to the printed totals."""
    rows, total_levy, total_rate = [], None, None
    for raw in text.split("\n"):
        s = raw.strip()
        m = LEVY_ROW.match(s)
        if not m:
            continue
        label = re.sub(r"\*+", "", m.group(1)).strip()
        levy, prior, rate = money(m.group(2)), money(m.group(3)), float(m.group(4))
        if levy is None:
            continue
        if label.upper().startswith("TOTAL"):
            total_levy, total_rate = levy, rate
            break
        rows.append({"fund": label.title(), "levy": levy, "prior_levy": prior, "mill_rate": rate})
    if total_levy is None:
        raise ValueError("levy TOTAL row not found")
    reconcile(rows, total_levy, "levy", "levy_by_fund")
    calc_rate = round(sum(r["mill_rate"] for r in rows), 2)
    if calc_rate != total_rate:
        raise ValueError(f"mill-rate reconcile: parsed {calc_rate} vs printed {total_rate}")
    return rows, {"levy": total_levy, "mill_rate": total_rate}


def parse_mill_bridge(text):
    """The 'Explanation of Mill Rate Decrease' walk: prior mill rate + signed factor
    deltas = proposed mill rate. Reconciles the deltas to the endpoints."""
    rows = []
    for raw in text.split("\n"):
        s = raw.strip()
        # Bridge rows begin with the dollar-sign rate, then a label that contains
        # letters (endpoints read "<rate> 2024-25 Mill Rate", deltas "<rate> Increase…").
        m = re.match(r"^\$\s*(\(?-?[\d.]+\)?)\s+(.*[A-Za-z].*)$", s)
        if not m:
            continue
        val = money(m.group(1))
        if val is None or abs(val) >= 100:  # a mill rate, not a dollar figure
            continue
        rows.append({"factor": m.group(2).strip(), "delta": val})
    if len(rows) < 3:
        raise ValueError(f"mill-rate bridge parsed only {len(rows)} rows")
    base, result, deltas = rows[0], rows[-1], rows[1:-1]
    if round(base["delta"] + sum(d["delta"] for d in deltas), 2) != result["delta"]:
        raise ValueError("mill-rate bridge deltas do not reconcile to endpoints")
    return {"base_rate": base["delta"], "base_label": base["factor"],
            "result_rate": result["delta"], "result_label": result["factor"],
            "factors": deltas}


def fy_end(label):
    """'2025-26' -> 2026 (the fiscal year's ending calendar year)."""
    start = int(label[:4])
    return start + 1


def parse_rate_history(text):
    """Equalized mill-rate history. The page lays out two columns side by side, so a
    line carries up to two (year, rate) pairs; we collect every one."""
    out = []
    for raw in text.split("\n"):
        # The current year carries a "***" footnote marker between year and rate.
        for ylabel, rate in re.findall(r"(\d{4}-\d{2})\s+(?:\*+\s+)?(\d+\.\d{2})", raw):
            out.append({"year": fy_end(ylabel), "label": ylabel, "rate": float(rate)})
    out.sort(key=lambda r: r["year"])
    if len(out) < 40:
        raise ValueError(f"rate history parsed only {len(out)} years")
    return out


def parse_valuation_history(text):
    """Equalized-valuation history (calendar years). pdfplumber splits the leading
    digit off each value ('5 24,920,300' = 524,920,300; '2 ,594,546,174' =
    2,594,546,174) and lays two columns side by side, so we walk tokens: a 4-digit
    year, then a lone leading digit, then the comma-grouped remainder. Keeps the
    first row per calendar year (a one-off '1977-78' transition row collides with
    1977 and is dropped)."""
    out, seen = [], set()
    for raw in text.split("\n"):
        toks = raw.split()
        i = 0
        while i < len(toks):
            if re.fullmatch(r"\d{4}(-\d{2})?", toks[i]):
                year = int(toks[i][:4])
                nxt = toks[i + 1] if i + 1 < len(toks) else ""
                if re.fullmatch(r"\d", nxt) and i + 2 < len(toks):       # split leading digit
                    value, step = money(nxt + toks[i + 2]), 3
                elif re.fullmatch(r"[\d,]{7,}", nxt):                    # whole comma number
                    value, step = money(nxt), 2
                else:
                    i += 1
                    continue
                if value and year not in seen:
                    seen.add(year)
                    out.append({"year": year, "value": value})
                i += step
            else:
                i += 1
    out.sort(key=lambda r: r["year"])
    if len(out) < 40:
        raise ValueError(f"valuation history parsed only {len(out)} years")
    return out


def parse_debt(text):
    """Total debt-service requirements: principal + interest + total by calendar
    year, reconciled to the printed 'TOTAL' row. Outstanding principal = the sum of
    all future principal still owed."""
    retire, totals = [], None
    for raw in text.split("\n"):
        s = raw.strip()
        mt = re.match(r"^TOTAL\b.*?\$\s*([\d ,]+)\s+\$\s*([\d ,]+)\s+\$\s*([\d ,]+)$", s)
        if mt:
            totals = {"principal": money(mt.group(1)), "interest": money(mt.group(2)),
                      "total": money(mt.group(3))}
            continue
        m = re.match(r"^(20\d{2})\s+\$?\s*([\d ,]+)\s+\$?\s*([\d ,]+)\s+\$?\s*([\d ,]+)$", s)
        if not m:
            continue
        principal, interest, total = money(m.group(2)), money(m.group(3)), money(m.group(4))
        if principal is None or total is None:
            continue
        retire.append({"year": int(m.group(1)), "principal": principal,
                       "interest": interest, "total": total})
    if totals is None:
        raise ValueError("debt 'TOTAL' requirements row not found")
    # Principal is the integrity anchor (reconciles exactly); the per-year total
    # column carries cents-rounding in the source, so it sums a few dollars off.
    reconcile(retire, totals["principal"], "principal", "debt")
    reconcile_within(retire, totals["total"], "total", "debt", 5)
    return {
        "outstanding_principal": totals["principal"],
        "total_interest_remaining": totals["interest"],
        "total_principal_interest": totals["total"],
        "retirement": [r for r in retire if r["total"] > 0],
    }


def parse_enrollment(zip_paths):
    """Districtwide certified enrollment (headcount) per year, from WISEdash
    `enrollment_certified_<yr>.zip` files passed as trailing args. Each zip holds a
    statewide CSV; we take Wausau's one districtwide all-students/all-grades row.
    (This is a third-Friday headcount — distinct from the book's FTE membership,
    which weights summer school and 4K — so the two figures legitimately differ.)"""
    out = []
    for zp in zip_paths:
        with zipfile.ZipFile(zp) as zf:
            name = [n for n in zf.namelist() if n.endswith(".csv") and "layout" not in n]
            if len(name) != 1:
                raise ValueError(f"{zp}: expected one data CSV, found {name}")
            with zf.open(name[0]) as f:
                hits = [r for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                        if r["DISTRICT_NAME"] == "Wausau" and r["SCHOOL_CODE"] == ""
                        and r["GRADE_GROUP"] == "[All]" and r["GROUP_BY"] == "All Students"]
        if len(hits) != 1:
            raise ValueError(f"{zp}: expected one Wausau districtwide row, found {len(hits)}")
        label = hits[0]["SCHOOL_YEAR"]
        out.append({"year": fy_end(label), "label": label, "count": int(hits[0]["STUDENT_COUNT"])})
    out.sort(key=lambda r: r["year"])
    return {
        "years": [r["year"] for r in out],
        "labels": [r["label"] for r in out],
        "counts": [r["count"] for r in out],
        "source": "WISEdash certified enrollment (districtwide headcount)",
    }


# ---------- assembly ----------
def extract(pdf_path, enrollment_zips=()):
    pdf = pdfplumber.open(pdf_path)
    texts = page_texts(pdf)

    funds, fund_totals = parse_funds(
        texts[find_page(texts, "REVENUES AND EXPENDITURES - ALL FUNDS", "GROSS TOTAL EXPENDITURES")])
    gf = next(f for f in funds if f["fund_no"] == 10)
    gf_total = gf["expenditures"]  # Fund 10 budget incl. transfers out

    # Fund 10 detail tables each span a contiguous multi-page run; the subtotal
    # labels repeat across funds, so we scope to Fund 10's run before parsing.
    rev_text = find_section(texts, "FUND 10", "DETAILED REVENUE BUDGET")
    gf_revenues = parse_gf_revenues(rev_text, gf["revenues"])

    exp_text = find_section(texts, "FUND 10", "DETAILED EXPENDITURE BUDGET")
    gf_expenditures = parse_gf_expenditures(exp_text, gf_total)

    levy_text = texts[find_page(texts, "Explanation of Mill Rate Decrease")]
    levy_by_fund, levy_total = parse_levy_by_fund(levy_text)
    mill_bridge = parse_mill_bridge(levy_text)

    # Second needle on each disambiguates the data page from the table-of-contents line.
    rate_history = parse_rate_history(
        texts[find_page(texts, "EQUALIZED TAX RATE HISTORY", "GRAPH OF EQUALIZED MILL RATES")])
    valuation_history = parse_valuation_history(
        texts[find_page(texts, "HISTORY OF EQUALIZED VALUATION", "(DECREASE)")])
    # Cross-check the latest valuation against the "New Valuation" printed on the
    # levy page — two independent spots in the book must agree.
    mnv = re.search(r"New Valuation.*?\$\s*([\d,]+)", levy_text)
    if not mnv:
        raise ValueError("levy-page 'New Valuation' not found for valuation cross-check")
    new_val = money(mnv.group(1))
    if valuation_history[-1]["value"] != new_val:
        raise ValueError(f"valuation cross-check: history latest {valuation_history[-1]['value']:,} "
                         f"vs levy-page New Valuation {new_val:,}")

    debt = parse_debt(texts[find_page(texts, "Total Debt Service Requirements", "TOTAL 2025-2042")])

    budget_year = rate_history[-1]["year"]
    meta = {
        "entity": "Wausau School District",
        "kind": "school",
        "budget_year": budget_year,
        "fiscal_label": rate_history[-1]["label"],
        "total_levy": levy_total["levy"],
        "mill_rate": levy_total["mill_rate"],
        "gross_expenditures": fund_totals["gross_expenditures"],
        "net_expenditures": fund_totals["net_expenditures"],
        "gf_expenditures": gf["expenditures"],
        "gf_revenues": gf["revenues"],
    }

    out = {
        "meta": meta,
        "funds": funds,
        "gf_revenues": gf_revenues,
        "gf_expenditures": gf_expenditures,
        "levy_by_fund": levy_by_fund,
        "levy_total": levy_total,
        "mill_bridge": mill_bridge,
        "rate_history": rate_history,
        "valuation_history": valuation_history,
        "debt": debt,
    }
    if enrollment_zips:
        out["enrollment"] = parse_enrollment(enrollment_zips)
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: python extract_school.py <school-budget.pdf> <out.json> "
                 "[enrollment_certified_<yr>.zip ...]")
    data = extract(sys.argv[1], sys.argv[3:])
    with open(sys.argv[2], "w") as f:
        json.dump(data, f, indent=2)
    m = data["meta"]
    print(f"wrote {sys.argv[2]}: {m['entity']} FY{m['budget_year']} ({m['fiscal_label']}) | "
          f"levy ${m['total_levy']:,} @ {m['mill_rate']} mills | "
          f"all-funds ${m['gross_expenditures']:,} gross / ${m['net_expenditures']:,} net | "
          f"GF rev ${m['gf_revenues']:,} / exp ${m['gf_expenditures']:,} | "
          f"{len(data['funds'])} funds | {len(data['gf_revenues'])} revenue sources | "
          f"{len(data['gf_expenditures']['salary_lines'])} salary + {len(data['gf_expenditures']['benefit_lines'])} benefit lines | "
          f"{len(data['levy_by_fund'])} levy funds | {len(data['mill_bridge']['factors'])} bridge factors | "
          f"{len(data['rate_history'])} rate-history yrs ({data['rate_history'][0]['label']}-{data['rate_history'][-1]['label']}) | "
          f"{len(data['valuation_history'])} valuation yrs (latest ${data['valuation_history'][-1]['value']:,}) | "
          f"debt ${data['debt']['outstanding_principal']:,} principal, {len(data['debt']['retirement'])} retirement yrs"
          + (f" | enrollment {data['enrollment']['counts'][-1]:,} ({data['enrollment']['labels'][0]}-{data['enrollment']['labels'][-1]}, {len(data['enrollment']['years'])} yrs)"
             if "enrollment" in data else ""))


if __name__ == "__main__":
    main()
