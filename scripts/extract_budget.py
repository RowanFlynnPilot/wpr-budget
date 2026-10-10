"""
extract_budget.py - Marathon County "Follow the Money" data extractor.

Turns the county's annual budget PDF into a single budget.json matching the
agreed schema (meta, general_fund, funds, departments, levy_history,
homeowner_impact, debt).

Budget data changes once a year, so this is a one-shot annual ingest, NOT a
scheduled scraper. Run it on the official PDF you've downloaded by hand -- that
sidesteps the county site's Akamai datacenter-IP block entirely, so no proxy is
needed. It reads both editions of the book: the Administrator's Proposed budget
(late September) and the board-Approved one (November); meta.status says which.

    python scripts/extract_budget.py 2026-Annual-Budget.pdf public/marathon-county.json [2025-Annual-Budget.pdf ...] [--cache]

Design notes:
- One parser serves both the by-fund and the General-Fund-by-department appendix
  tables; they share an identical six-column layout. They are located by TITLE:
  the appendix letters shift whenever the county adds or drops an appendix (2027
  dropped one, moving by-fund from E to D).
- extract_text() + line parsing is used instead of extract_tables(): the tables
  are whitespace-aligned (no rules), so cell detection is unreliable, while the
  text layer is clean.
- Reconciliation asserts that parsed rows sum to the printed total. A mismatch
  raises immediately rather than emitting silently-wrong data.
"""
import re
import argparse
from itertools import combinations, product

from lib import money, load_pages, find_page, find_first, reconcile, write_json

MONEY = r"\$\s?\(?[\d,]+\)?"

# The by-fund table wraps some fund names across their number line, so canonical
# names are keyed off the stable leading fund number instead of reconstructed text.
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
# By-fund rows the book prints with no fund number (fund_no null). 2027 added a
# State Special Charges levy line; any other unnumbered row is an error.
UNNUMBERED_FUND_ROWS = ("State Special Charges",)

SIX_COLS = [
    "tax_levy",
    "operating_revenues",
    "operating_expenditures",
    "personnel_expenditures",
    "prior_tax_levy",
    "levy_difference",
]
HEADER_TOKENS = ("Tax Levy", "Revenues", "Expenditures", "Difference", "Department", "Fund")


def clean(text):
    """Repair pdfplumber's number spacing in this budget's tables.

    Every value in the county's tables is '$'-prefixed, and pdfplumber sometimes
    injects spaces after the '$' and inside the digits ('$ 3 7,304,640'). Collapse
    whitespace within each '$' + numeric run (the run stops at the first
    non-numeric character, so space-separated prose and columns are untouched),
    then turn the '$-' zero marker into '$0'.
    """
    text = re.sub(r"\$[ \t\d,()\-−]+", lambda m: re.sub(r"[ \t]+", "", m.group(0)), text)
    return text.replace("$-", "$0").replace("$−", "$0")


def split_label_and_numbers(line):
    """('Clerk of Courts', ['$1,674,440', ...]) for a data row, else (None, [])."""
    nums = re.findall(MONEY, line)
    if len(nums) < 3:  # a row prints at least half its six cells; headers print none
        return None, []
    label = line[: line.find(nums[0])].strip()
    return label, nums


def placements(values):
    """Every way to lay a row's printed values onto SIX_COLS — in printed order,
    each unprinted cell zero — that satisfies the table's own row identities:
    spending == levy + revenue, and levy - prior levy == difference.

    The book leaves some cells blank instead of printing '$ -' (Capital Projects'
    personnel in 2026, UW-Extension's in 2027, Contingency's difference in 2025),
    so a short row can't be padded at the end: that shifts every later column one
    place left, and the levy-only check never noticed.
    """
    out = set()
    for blanks in combinations(range(len(SIX_COLS)), len(SIX_COLS) - len(values)):
        cells = iter(values)
        levy, rev, opex, pers, prior, diff = (0 if i in blanks else next(cells) for i in range(len(SIX_COLS)))
        if opex + pers == levy + rev and levy - prior == diff:
            out.add((levy, rev, opex, pers, prior, diff))
    return out


def resolve(names, candidates, total, label):
    """Choose each row's reading so all six columns sum exactly to the printed
    Total. Rows the identities pin down contribute their single reading; the rare
    ambiguous ones (e.g. a blank that fits either spending column) are settled
    jointly by the column totals. Exactly one consistent assignment must exist —
    the table's arithmetic, not cell position, places every value."""
    for name, cands in zip(names, candidates):
        if not cands:
            raise ValueError(f"{label}: row '{name}' fits no layout with spending = levy + revenue "
                             f"and levy - prior levy = difference")
    target = tuple(total[k] for k in SIX_COLS)
    open_rows = [i for i, cands in enumerate(candidates) if len(cands) > 1]
    fits = []
    for combo in product(*(sorted(candidates[i]) for i in open_rows)):
        chosen = [min(cands) for cands in candidates]
        for i, reading in zip(open_rows, combo):
            chosen[i] = reading
        if tuple(sum(col) for col in zip(*chosen)) == target:
            fits.append(chosen)
    if len(fits) != 1:
        first = tuple(sum(col) for col in zip(*(min(c) for c in candidates)))
        off = {k: f"parsed {p:,} vs printed {t:,}" for k, p, t in zip(SIX_COLS, first, target) if p != t}
        raise ValueError(f"{label}: {len(fits)} layouts reconcile all six columns to the printed Total "
                         f"(expected exactly 1){'; ' + str(off) if off else ''}")
    return fits[0]


def parse_six_col_table(text, is_fund, label):
    """Parse the shared by-fund / by-department layout into rows + the total row.

    Returns (rows, total) where each row is {...SIX_COLS, fund_no+name | department}
    and total is the SIX_COLS dict from the printed 'Total' line. Every column of
    every row is reconciled (see resolve); the caller needs no further checks.
    """
    names, candidates = [], []
    total = None
    pending = ""  # accumulates a label that wrapped onto its own line

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue

        row_label, nums = split_label_and_numbers(line)
        if row_label is None:
            # Not a data row. Keep it as a wrapped-name fragment only if it looks
            # like a name (has lowercase letters) and isn't a column header.
            if re.search(r"[a-z]", line) and not any(t in line for t in HEADER_TOKENS):
                pending = (pending + " " + line).strip()
            else:
                pending = ""
            continue

        full_label = (pending + " " + row_label).strip()
        pending = ""
        values = [money(n) for n in nums]

        if "total" in full_label.lower():
            if len(values) != len(SIX_COLS):
                raise ValueError(f"{label}: Total row prints {len(values)} values; expected {len(SIX_COLS)}")
            total = dict(zip(SIX_COLS, values))
            break  # table ends at its total; ignore any per-line detail that follows
        names.append(full_label)
        candidates.append(placements(values))

    if total is None:
        raise ValueError(f"{label}: no Total row found")

    rows = []
    for full_label, reading in zip(names, resolve(names, candidates, total, label)):
        record = dict(zip(SIX_COLS, reading))
        if is_fund:
            fund_no = re.match(r"(\d{3})", full_label)
            if fund_no:
                no = fund_no.group(1)
                if no not in FUND_NAMES:
                    raise ValueError(f"{label}: unknown fund number {no} — add its canonical name to FUND_NAMES")
                record["fund_no"] = no
                record["name"] = FUND_NAMES[no]
            elif full_label in UNNUMBERED_FUND_ROWS:
                record["fund_no"] = None
                record["name"] = full_label
            else:
                raise ValueError(f"{label}: row '{full_label}' has no fund number and isn't in UNNUMBERED_FUND_ROWS")
        else:
            record["department"] = re.sub(r"\s+", " ", full_label)
        rows.append(record)
    return rows, total


def parse_levy_history(text):
    """Rows like '2017 $48,180,111 5.0398' -> {year, levy, rate}.

    The levy chart bleeds axis numbers onto these lines ('... 5.0398 60,000,000 5'),
    so the rate is read as the first decimal after the levy and the rest ignored.
    Homeowner-table rows start the same way but always carry a '%', so they're skipped.
    The budget prints two overlapping levy/rate tables, so years are de-duplicated.
    """
    by_year = {}
    for line in text.split("\n"):
        if "%" in line:
            continue
        m = re.match(r"^(20\d{2})\s+\$([\d,]+)\s+(\d+\.\d+)", line.strip())
        if m:
            year = int(m.group(1))
            by_year.setdefault(year, {"year": year, "levy": int(m.group(2).replace(",", "")), "rate": float(m.group(3))})
    return [by_year[y] for y in sorted(by_year)]


def parse_homeowner_impact(text):
    """Average-homeowner table -> {year, avg_value, tax_rate, tax_amount, pct_change_bill}.

    Anchored on the full column pattern (year, $value, $inc, %inc, $rate, %chg,
    $amount, ...) so debt-schedule rows that also start with a year never match.
    The tax amount carries cents, so it is parsed as a float rather than money().
    Each row must satisfy tax_amount ≈ avg_value/1000 × tax_rate (the table's own
    arithmetic, within a few dollars of print rounding) — that catches chart-axis
    bleed corrupting a column without any visible parse failure.
    """
    row = re.compile(
        r"^(20\d{2})\s+\$([\d,]+)\s+\(?\$?[\d,]+\)?\s+-?[\d.]+%\s+\$([\d.]+)\s+-?[\d.]+%\s+\$([\d.]+)\s"
    )
    by_year = {}
    for line in text.split("\n"):
        m = row.match(line.strip())
        if not m:
            continue
        year = int(m.group(1))
        rec = {
            "year": year,
            "avg_value": int(m.group(2).replace(",", "")),
            "tax_rate": float(m.group(3)),
            "tax_amount": float(m.group(4)),
            "pct_change_bill": float(re.findall(r"-?[\d.]+%", line)[-1].rstrip("%")),
        }
        if abs(rec["avg_value"] / 1000 * rec["tax_rate"] - rec["tax_amount"]) > 5:
            raise ValueError(f"homeowner row {year}: amount {rec['tax_amount']} inconsistent with "
                             f"value {rec['avg_value']:,} × rate {rec['tax_rate']} — column bleed?")
        by_year.setdefault(year, rec)
    return [by_year[y] for y in sorted(by_year)]


SCHEDULES = "Debt Service Schedules as of"
SERIES_ID = r"(?:19|20)\d{2}[A-Z]?"


def schedule_tokens(line):
    """A schedule row's cells. pdfplumber splits the leading digit off many figures
    ('1 ,025,000', '9 40,000'); no schedule cell is a single digit, so a lone digit
    always belongs to the figure after it. Every cell must then be a whole
    comma-grouped figure or the '-' a retired series prints."""
    raw = line.replace("$", " ").split()
    cells = []
    i = 0
    while i < len(raw):
        tok = raw[i]
        if re.fullmatch(r"\d", tok) and i + 1 < len(raw) and re.match(r"[\d,]", raw[i + 1]):
            tok += raw[i + 1]
            i += 1
        if tok != "-" and not re.fullmatch(r"\d{1,3}(?:,\d{3})*", tok):
            raise ValueError(f"debt schedule cell {tok!r} is not a figure in: {line!r}")
        cells.append(tok)
        i += 1
    return cells


def schedule_slots(cells, line):
    """Group a row's cells into per-series slots: a (principal, interest, total)
    triple that must add up, or None for a retired series' single '-'."""
    slots = []
    i = 0
    while i < len(cells):
        if cells[i] == "-":
            slots.append(None)
            i += 1
            continue
        triple = cells[i:i + 3]
        if len(triple) != 3 or "-" in triple:
            raise ValueError(f"debt schedule row has a broken principal/interest/total triple: {line!r}")
        p, n, t = (money(c) for c in triple)
        if p + n != t:
            raise ValueError(f"debt schedule: principal {p:,} + interest {n:,} != total {t:,} in: {line!r}")
        slots.append((p, n, t))
        i += 3
    return slots


def parse_debt(texts, budget_year):
    """Outstanding principal per bond/note series, from the per-series 'Debt
    Service Schedules as of 12/31/<prior year>' tables — present in both the
    proposed and the approved book, and current as of the start of the budget
    year. (The approved book's public-hearing notice also lists 'TOTAL DEBT', but
    a year staler: the 2026 book's notice was as of January 1, 2025.)

    Each table is printed in bands of series columns; a band row holds one
    (principal, interest, total) triple per series, or a single '-' once a series
    is retired, and the table's last band ends with a Total column. Reconciled
    three ways: every triple adds up; every series' years sum to its printed Total
    row; and the grand principal equals the book's own narrative figure
    ('outstanding general debt obligation as of December 31, YYYY, will be $X').
    """
    page = texts[find_page(texts, SCHEDULES)]
    parts = re.split(SCHEDULES + r"\s+(\d{1,2}/\d{1,2}/20\d{2})", page)
    as_of = set(parts[1::2])
    if as_of != {f"12/31/{budget_year - 1}"}:
        raise ValueError(f"debt schedules dated {as_of}; expected 12/31/{budget_year - 1}")

    out = []
    for table in parts[2::2]:
        lines = [l.strip() for l in table.split("\n")]
        sums, printed = {}, {}
        band = None  # this band's column names, '' standing for the Total column
        for line, nxt in zip(lines, lines[1:] + [""]):
            if nxt.startswith("Year"):
                head = line.removesuffix(" Total")
                names = [n.strip() for n in re.findall(r".*?\b" + SERIES_ID + r"\b", head)]
                if not names or "".join(re.findall(r".*?\b" + SERIES_ID + r"\b", head)) != head:
                    raise ValueError(f"debt schedule band header not split into series cleanly: {line!r}")
                band = names + ([""] if head != line else [])
                for name in names:
                    sums[name], printed[name] = [0, 0, 0], None
                continue
            key, _, rest = line.partition(" ")
            if band is None or not (key == "Total" or re.fullmatch(r"20\d{2}", key)):
                continue  # titles, the Year label line, page furniture
            cells = schedule_tokens(rest)
            if all(c == "-" for c in cells):
                continue  # every series in this band is retired by this year
            slots = schedule_slots(cells, line)
            if len(slots) != len(band):
                raise ValueError(f"debt schedule row has {len(slots)} slots for {len(band)} columns: {line!r}")
            for name, slot in zip(band, slots):
                if name == "":
                    continue  # the Total column; implied by the per-series checks below
                if key == "Total":
                    if slot is None:
                        raise ValueError(f"debt schedule Total row has no figures for {name!r}")
                    printed[name] = slot
                elif slot:
                    sums[name] = [a + b for a, b in zip(sums[name], slot)]
            if key == "Total":
                band = None  # a band ends at its Total row
        for name, total in printed.items():
            # Principal is the integrity anchor and must sum exactly; the interest
            # (and so total) columns carry the book's own $1 rounding (2026's
            # Series 2020B interest years sum $1 over its printed Total).
            if total is None or sums[name][0] != total[0] or any(
                    abs(a - b) > 1 for a, b in zip(sums[name][1:], total[1:])):
                raise ValueError(f"debt schedule {name!r}: years sum to {sums[name]} vs printed Total {total}")
            out.append({"series": name, "outstanding": total[0]})

    full = "\n".join(texts)
    m = re.search(r"outstanding\s+general\s+debt\s+obligation\s+as\s+of\s+December\s+31,\s+(20\d{2}),?\s+"
                  r"will\s+be\s+\$([\d,]+)\s+\(principal\s+only\)", full)
    if not m or int(m.group(1)) != budget_year - 1:
        raise ValueError(f"narrative outstanding-debt figure as of December 31, {budget_year - 1} not found")
    reconcile(out, money(m.group(2)), "outstanding", "debt schedules vs narrative outstanding principal")
    return sorted(out, key=lambda d: re.search(SERIES_ID + r"$", d["series"]).group(0))


def parse_gf_summary(text):
    """General Fund expenditures-by-function and revenues-by-source.

    Each row: label + actual / budget / actual-through / estimate / proposed + pct.
    We keep actual (prior yr), budget (current yr), proposed (next yr), and pct.

    The printed Total row of each block is parsed and reconciled against the sum
    of its rows for all three kept dollar columns. That guards the two silent
    failure modes of this positional parser: a wrapped row label dropping a row,
    and an added/reordered column shifting `proposed_next` onto a different figure.
    """
    def block(start, stop):
        rows = []
        totals = None
        capture = False
        for line in text.split("\n"):
            s = line.strip()
            if not capture:
                if start in s:
                    capture = True
                continue
            nums = [n for n in re.findall(r"-?[\d,]+\.?\d*", s) if re.search(r"\d", n)]
            if stop in s:
                totals = nums
                break
            label = re.sub(r"\s*-?[\d,].*$", "", s).strip()
            if label and len(nums) >= 6:
                rows.append({
                    "category": label,
                    "actual_prior": int(nums[0].replace(",", "")),
                    "budget_current": int(nums[1].replace(",", "")),
                    "proposed_next": int(nums[4].replace(",", "")),
                    "pct_change": float(nums[5].replace(",", "")),
                })
        if totals is None:
            raise ValueError(f"GF summary block '{start}'..'{stop}' not found")
        if len(totals) < 6:
            raise ValueError(f"GF summary '{stop}' row carries {len(totals)} numbers; expected the full 6-column layout")
        for key, idx in (("actual_prior", 0), ("budget_current", 1), ("proposed_next", 4)):
            reconcile(rows, int(totals[idx].replace(",", "")), key, f"GF summary {start}")
        return rows

    return {
        "expenditures": block("EXPENDITURES", "Total Expenditures"),
        "revenues": block("REVENUES", "Total Revenues"),
    }


MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]


DATE = r"(" + "|".join(MONTHS) + r")\s+(\d{1,2}),\s+(20\d{2})"


def iso(m):
    """'November 11, 2025' match groups -> '2025-11-11'."""
    return f"{m.group(3)}-{MONTHS.index(m.group(1)) + 1:02d}-{int(m.group(2)):02d}"


def edition(full_text, budget_year):
    """('adopted', date, None) when the book carries THIS budget's adoption
    sentence — the board votes in November of the prior year, so a passing mention
    of an earlier budget's adoption never counts — else ('proposed', None, date)
    from the Administrator's 'Presented to the ... Committee on <date>' cover line.
    A book with neither is an edition this extractor doesn't know: fail loud."""
    adopted = {iso(m) for m in re.finditer(DATE + r",?\s+the\s+Marathon\s+County\s+Board", full_text)
               if int(m.group(3)) == budget_year - 1}
    if len(adopted) > 1:
        raise ValueError(f"conflicting adoption dates for the {budget_year} budget: {sorted(adopted)}")
    if adopted:
        return "adopted", adopted.pop(), None
    m = re.search(r"Presented\s+to\s+the\s+[^.]*?\s+on\s+" + DATE, full_text)
    if not m or int(m.group(3)) != budget_year - 1:
        raise ValueError(f"neither an adoption sentence nor a {budget_year - 1} 'Presented to the ... on <date>' "
                         f"line found — unknown edition of the {budget_year} book")
    return "proposed", None, iso(m)


def build_meta(fund_total, levy_history, full_text):
    """Top-level facts for the masthead, derived from the parsed tables + text.

    Budget year and rate come from the (latest) levy-history row; the levy and
    all-funds spending come from the by-fund total; status and its date come from
    the book itself (see edition) — the masthead renders them, so their absence is
    an error, not a None.
    """
    year = max(l["year"] for l in levy_history)
    rate = next(l["rate"] for l in levy_history if l["year"] == year)
    status, adopted, presented = edition(full_text, year)
    return {
        "entity": "Marathon County",
        "budget_year": year,
        "status": status,
        "adopted": adopted,
        "presented": presented,
        "tax_levy": fund_total["tax_levy"],
        "tax_rate": rate,
        "total_expenditures": fund_total["operating_expenditures"] + fund_total["personnel_expenditures"],
    }


def build_history(extractions):
    """Assemble per-year adopted figures from one or more single-year extractions.

    Each extraction is a full extract_one() dict; we key its adopted department
    levies and General Fund category figures by that book's budget year. With a
    single PDF this yields one year per series; dropping in prior-year PDFs fills
    the earlier years in losslessly, with no change to the schema or the UI.

    'Adopted' is the apples-to-apples basis: a department's tax_levy and a GF
    category's proposed_next are, in each book, that year's adopted figure.
    """
    extractions = sorted(extractions, key=lambda e: e["meta"]["budget_year"], reverse=True)
    years = sorted(e["meta"]["budget_year"] for e in extractions)

    # Prior-year slices don't parse the levy-history table, so their meta carries
    # no mill rate. The latest book's levy_history covers every year, so fill any
    # missing rate from there.
    rate_by_year = {lh["year"]: lh["rate"] for e in extractions for lh in e.get("levy_history", [])}

    def merge(rows_of, name_key, value_key):
        # Union of names in latest-first order, each mapped to {year: value}.
        names, seen = [], set()
        for e in extractions:
            for r in rows_of(e):
                if r[name_key] not in seen:
                    seen.add(r[name_key])
                    names.append(r[name_key])
        out = []
        for name in names:
            series = {}
            for e in extractions:
                for r in rows_of(e):
                    if r[name_key] == name:
                        series[str(e["meta"]["budget_year"])] = r[value_key]
            out.append({name_key: name, "adopted": series})
        return out

    return {
        "years": years,
        "totals": {
            str(e["meta"]["budget_year"]): {
                "total_expenditures": e["meta"]["total_expenditures"],
                "tax_levy": e["meta"]["tax_levy"],
                "tax_rate": e["meta"].get("tax_rate") or rate_by_year.get(e["meta"]["budget_year"]),
            } for e in extractions
        },
        "departments": merge(lambda e: e["departments"], "department", "tax_levy"),
        # A proposed edition carries no GF summary (general_fund is null), so it
        # contributes no GF year.
        "general_fund": {
            flow: merge(lambda e: e["general_fund"][flow] if e["general_fund"] else [], "category", "proposed_next")
            for flow in ("expenditures", "revenues")
        },
    }


def extract(latest_pdf, prior_pdfs=(), cache=False):
    """Full extraction for the latest budget, plus a multi-year `history` block.

    The latest PDF drives every detailed single-year section. Each prior PDF
    contributes only the slice `history` needs — its by-fund and by-department
    appendix tables — via extract_history_slice. That avoids the General Fund
    summary / debt / levy / homeowner parsers, whose formats drift in older books
    and which `history` does not use.
    """
    latest = extract_one(latest_pdf, cache=cache)
    priors = [extract_history_slice(p, cache=cache) for p in prior_pdfs]
    latest["history"] = build_history([latest, *priors])
    return latest


# The by-fund and by-department summary tables share this column header. Pairing
# it with the table's title isolates the summary-table page even when the
# appendix spans several pages of per-line account detail.
TABLE = "Expenditures Expenditures Tax Levy Difference"
FUND_TITLE = "Budget by Fund"
DEPT_TITLE = "General Fund Budget by Department"


def appendix_tables(texts):
    """(funds, fund_total, departments, budget year printed in the by-department
    title) — the two summary tables every book since 2025 carries, found by title."""
    funds, fund_total = parse_six_col_table(
        clean(texts[find_page(texts, FUND_TITLE, TABLE)]), is_fund=True, label="by-fund table")
    dept_raw = texts[find_page(texts, DEPT_TITLE, TABLE)]
    departments, _ = parse_six_col_table(clean(dept_raw), is_fund=False, label="by-department table")
    m = re.search(r"APPENDIX [A-Z]:\s*(20\d{2})\s+" + DEPT_TITLE, dept_raw, re.IGNORECASE)
    if not m:
        raise ValueError(f"could not read the budget year from the '{DEPT_TITLE}' appendix title")
    return funds, fund_total, departments, int(m.group(1))


def extract_history_slice(pdf_path, cache=False):
    """Minimal prior-year parse for the `history` block: the by-fund and
    by-department summary tables plus the budget year, with the same loud
    reconciliation as the full extractor. Books that lack these appendices (the
    pre-2025 format) fail here with a clear missing-section error rather than
    emitting partial data.
    """
    texts = load_pages(pdf_path, cache=cache)
    funds, fund_total, departments, year = appendix_tables(texts)
    return {
        "meta": {
            "budget_year": year,
            "total_expenditures": fund_total["operating_expenditures"] + fund_total["personnel_expenditures"],
            "tax_levy": fund_total["tax_levy"],
            "tax_rate": None,
        },
        "departments": departments,
        "funds": funds,
        "general_fund": {"expenditures": [], "revenues": []},
    }


# The consolidated General Fund summary's function-row labels. It is printed in
# the public-hearing notice, which the approved book reprints but the proposed
# book predates (the notice is published ~2 weeks before the hearing).
GF_SUMMARY = ("General Government", "Capital Outlay", "Other Financing Uses")


def extract_one(pdf_path, cache=False):
    texts = load_pages(pdf_path, cache=cache)

    # Only the appendix tables suffer pdfplumber's in-number spacing, so clean()
    # is applied there alone. The early-page tables are already clean, and cleaning
    # them would merge a levy with the first digit of its rate.
    funds, fund_total, departments, table_year = appendix_tables(texts)

    full_text = "\n".join(texts)
    levy_history = parse_levy_history(full_text)
    # The homeowner row pattern is distinctive enough to find anywhere in the
    # document; the parser de-duplicates the table's reprinted copies by year.
    homeowner = parse_homeowner_impact(full_text)
    meta = build_meta(fund_total, levy_history, full_text)
    # Two independent spots in the book must agree on the budget year.
    if table_year != meta["budget_year"]:
        raise ValueError(f"budget-year cross-check: appendix title says {table_year}, "
                         f"levy history says {meta['budget_year']}")

    if any(all(n.lower() in t.lower() for n in GF_SUMMARY) for t in texts):
        general_fund = parse_gf_summary(texts[find_first(texts, *GF_SUMMARY)])
    elif meta["status"] == "proposed":
        general_fund = None
    else:
        raise ValueError(f"approved book has no General Fund summary (needles {GF_SUMMARY})")

    return {
        "meta": meta,
        "funds": funds,
        "departments": departments,
        "general_fund": general_fund,
        "levy_history": levy_history,
        "homeowner_impact": homeowner,
        "debt": parse_debt(texts, meta["budget_year"]),
    }


def main():
    ap = argparse.ArgumentParser(description="Extract the Marathon County annual-budget book to JSON.")
    ap.add_argument("pdf", help="the latest budget book PDF, Proposed or Approved edition (downloaded by hand)")
    ap.add_argument("out", help="output JSON path (public/marathon-county.json)")
    ap.add_argument("priors", nargs="*",
                    help="prior-year Approved Budget PDFs; each contributes only its by-fund/by-department "
                         "tables to `history`")
    ap.add_argument("--cache", action="store_true",
                    help="cache page texts in sources/ keyed on the PDF's size+mtime (fast re-runs)")
    args = ap.parse_args()
    data = extract(args.pdf, args.priors, cache=args.cache)
    write_json(args.out, data)
    m = data["meta"]
    print(f"wrote {args.out}: {m['entity']} {m['budget_year']} {m['status']} | "
          f"{len(data['departments'])} departments, {len(data['funds'])} funds, "
          f"GF summary {'yes' if data['general_fund'] else 'none (proposed edition)'}, "
          f"{len(data['levy_history'])} levy yrs, {len(data['homeowner_impact'])} homeowner yrs, "
          f"{len(data['debt'])} debt series | history years {data['history']['years']}")


if __name__ == "__main__":
    main()
