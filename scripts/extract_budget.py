"""
extract_budget.py - Marathon County "Follow the Money" data extractor.

Turns the county's annual budget PDF into a single budget.json matching the
agreed schema (meta, general_fund, funds, departments, levy_history,
homeowner_impact, debt).

Budget data changes once a year, so this is a one-shot annual ingest, NOT a
scheduled scraper. Run it on the official PDF you've downloaded by hand -- that
sidesteps the county site's Akamai datacenter-IP block entirely, so no proxy is
needed.

    python extract_budget.py 2026-Annual-Budget.pdf budget.json

Design notes:
- One parser serves both the by-fund (Appendix E) and by-department (Appendix F)
  tables; they share an identical six-column layout.
- extract_text() + line parsing is used instead of extract_tables(): the tables
  are whitespace-aligned (no rules), so cell detection is unreliable, while the
  text layer is clean.
- Reconciliation asserts that parsed rows sum to the printed total. A mismatch
  raises immediately rather than emitting silently-wrong data.
"""
import sys
import re
import json

import pdfplumber

MONEY = r"\$\s?\(?[\d,]+\)?"

# Appendix E wraps some fund names across their number line, so canonical names
# are keyed off the stable leading fund number instead of reconstructed text.
FUND_NAMES = {
    "101": "General Fund",
    "200": "Social Improvement Fund",
    "210": "Parks Fund",
    "291": "Grants Fund",
    "300": "Debt Service Fund",
    "400": "Capital Projects Fund",
    "602": "Landfill Fund",
    "610": "Highway Fund",
    "700": "Employee Benefits Fund",
    "710": "Property and Casualty Insurance Fund",
}

SIX_COLS = [
    "tax_levy",
    "operating_revenues",
    "operating_expenditures",
    "personnel_expenditures",
    "prior_tax_levy",
    "levy_difference",
]
HEADER_TOKENS = ("Tax Levy", "Revenues", "Expenditures", "Difference", "Department", "Fund")


def money(token):
    """'$(203,880)' -> -203880 ; '$ 1,714,258' -> 1714258 ; '' -> None."""
    neg = "(" in token
    digits = re.sub(r"[^\d]", "", token)
    if digits == "":
        return None
    value = int(digits)
    return -value if neg else value


def section_page(pdf, header):
    """Index of the single page whose text contains `header` (case-sensitive).

    Section headers are uppercase on the page itself but title-case in the table
    of contents, so a case-sensitive match isolates the real section page.
    """
    hits = [i for i, pg in enumerate(pdf.pages) if header in (pg.extract_text() or "")]
    if len(hits) != 1:
        raise ValueError(f"expected exactly one page for {header!r}, found pages {hits}")
    return hits[0]


def find_one(pdf, *needles):
    """Index of the single page containing all needles (case-insensitive). Fail fast otherwise."""
    hits = [i for i, pg in enumerate(pdf.pages)
            if all(n.lower() in (pg.extract_text() or "").lower() for n in needles)]
    if len(hits) != 1:
        raise ValueError(f"expected exactly one page for {needles}, found pages {hits}")
    return hits[0]


def split_label_and_numbers(line):
    """('Clerk of Courts', ['$1,674,440', ...]) for a data row, else (None, [])."""
    nums = re.findall(MONEY, line)
    if len(nums) < 5:  # a real row carries 5-6 money values; headers carry none
        return None, []
    label = line[: line.find(nums[0])].strip()
    return label, nums


def parse_six_col_table(text, is_fund):
    """Parse the shared Appendix E / Appendix F layout into rows + the total row.

    Returns (rows, total) where each row is {name/department, ...SIX_COLS} and
    total is the SIX_COLS dict from the printed 'Total' line.
    """
    rows = []
    total = None
    pending = ""  # accumulates a label that wrapped onto its own line

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue

        label, nums = split_label_and_numbers(line)
        if label is None:
            # Not a data row. Keep it as a wrapped-name fragment only if it looks
            # like a name (has lowercase letters) and isn't a column header.
            if re.search(r"[a-z]", line) and not any(t in line for t in HEADER_TOKENS):
                pending = (pending + " " + line).strip()
            else:
                pending = ""
            continue

        full_label = (pending + " " + label).strip()
        pending = ""
        values = [money(n) for n in nums]
        while len(values) < 6:  # e.g. Contingency Fund omits the trailing difference
            values.append(None)
        record = dict(zip(SIX_COLS, values))

        if "total" in full_label.lower():
            total = record
            continue

        if is_fund:
            fund_no = re.match(r"(\d{3})", full_label)
            if not fund_no:
                continue  # stray line, not a fund row
            record["fund_no"] = fund_no.group(1)
            record["name"] = FUND_NAMES[fund_no.group(1)]
        else:
            record["department"] = re.sub(r"\s+", " ", full_label)
        rows.append(record)

    if total is None:
        raise ValueError("no Total row found in six-column table")
    return rows, total


def reconcile(rows, total, key="tax_levy"):
    """Fail fast if parsed rows don't sum to the printed total."""
    calc = sum(r[key] for r in rows if r[key] is not None)
    if calc != total[key]:
        raise ValueError(f"reconciliation failed on {key}: parsed {calc:,} vs printed {total[key]:,}")


def parse_levy_history(text):
    """Rows like '2017 $48,180,111 5.0398' -> {year, levy, rate}."""
    out = []
    for line in text.split("\n"):
        m = re.match(r"^(20\d{2})\s+\$([\d,]+)\s+\$?([\d.]+)\s*$", line.strip())
        if m:
            out.append({"year": int(m.group(1)), "levy": int(m.group(2).replace(",", "")), "rate": float(m.group(3))})
    return out


def parse_homeowner_impact(text):
    """Average-homeowner table -> {year, avg_value, tax_rate, tax_amount, pct_change_bill}.

    Anchored on the full column pattern (year, $value, $inc, %inc, $rate, %chg,
    $amount, ...) so debt-schedule rows that also start with a year never match.
    The tax amount carries cents, so it is parsed as a float rather than money().
    """
    row = re.compile(
        r"^(20\d{2})\s+\$([\d,]+)\s+\$?\(?[\d,]+\)?\s+-?[\d.]+%\s+\$([\d.]+)\s+-?[\d.]+%\s+\$([\d.]+)\s"
    )
    out = []
    for line in text.split("\n"):
        m = row.match(line.strip())
        if not m:
            continue
        out.append({
            "year": int(m.group(1)),
            "avg_value": int(m.group(2).replace(",", "")),
            "tax_rate": float(m.group(3)),
            "tax_amount": float(m.group(4)),
            "pct_change_bill": float(re.findall(r"-?[\d.]+%", line)[-1].rstrip("%")),
        })
    return out


def parse_debt(text):
    """Outstanding-balance list under 'TOTAL DEBT AS OF ...'.

    Targets the series -> balance summary in the current budget format, e.g.
    '2012A GENERAL OBLIGATIONS BONDS-AIRPORT 700,000'. The grand-total line ends
    the list. (Years that publish only a per-year amortization schedule are not
    handled; the current budget uses this summary.)
    """
    out = []
    capture = False
    for line in text.split("\n"):
        s = line.strip()
        if "TOTAL DEBT" in s.upper():
            capture = True
            continue
        if not capture:
            continue
        m = re.match(r"^(\d{4}[A-Z]\s+GENERAL OBLIGATION.*?)\s+([\d,]{5,})$", s)
        if m:
            out.append({"series": m.group(1).strip(), "outstanding": int(m.group(2).replace(",", ""))})
        elif re.match(r"^[\d,]{6,}$", s) and out:
            break  # grand-total line ends the list
    return out


def parse_gf_summary(text):
    """General Fund expenditures-by-function and revenues-by-source.

    Each row: label + actual / budget / actual-through / estimate / proposed + pct.
    We keep actual (prior yr), budget (current yr), proposed (next yr), and pct.
    """
    def block(start, stop):
        rows = []
        capture = False
        for line in text.split("\n"):
            s = line.strip()
            if start in s:
                capture = True
                continue
            if capture and stop in s:
                break
            if not capture:
                continue
            nums = [n for n in re.findall(r"-?[\d,]+\.?\d*", s) if re.search(r"\d", n)]
            label = re.sub(r"\s*-?[\d,].*$", "", s).strip()
            if label and len(nums) >= 6:
                rows.append({
                    "category": label,
                    "actual_prior": int(nums[0].replace(",", "")),
                    "budget_current": int(nums[1].replace(",", "")),
                    "proposed_next": int(nums[4].replace(",", "")),
                    "pct_change": float(nums[5].replace(",", "")),
                })
        return rows

    return {
        "expenditures": block("EXPENDITURES", "Total Expenditures"),
        "revenues": block("REVENUES", "Total Revenues"),
    }


def extract(pdf_path):
    pdf = pdfplumber.open(pdf_path)

    fund_text = pdf.pages[section_page(pdf, "APPENDIX E:")].extract_text()
    funds, fund_total = parse_six_col_table(fund_text, is_fund=True)
    reconcile(funds, fund_total)

    dept_text = pdf.pages[section_page(pdf, "APPENDIX F:")].extract_text()
    departments, dept_total = parse_six_col_table(dept_text, is_fund=False)
    reconcile(departments, dept_total)

    # The consolidated General Fund summary lives on the public-hearing page;
    # locate it by its function-row labels so a stray "EXPENDITURES" heading on a
    # department page can't be picked up instead.
    gf_page = find_one(pdf, "General Government", "Capital Outlay", "Other Financing Uses")
    general_fund = parse_gf_summary(pdf.pages[gf_page].extract_text())

    full_text = "\n".join((pg.extract_text() or "") for pg in pdf.pages)

    return {
        "funds": funds,
        "departments": departments,
        "general_fund": general_fund,
        "levy_history": parse_levy_history(full_text),
        "homeowner_impact": parse_homeowner_impact(full_text),
        "debt": parse_debt(full_text),
    }


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: python extract_budget.py <budget.pdf> <budget.json>")
    data = extract(sys.argv[1])
    with open(sys.argv[2], "w") as f:
        json.dump(data, f, indent=2)
    print(f"wrote {sys.argv[2]}: {len(data['departments'])} departments, {len(data['funds'])} funds")


if __name__ == "__main__":
    main()
