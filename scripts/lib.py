"""Shared helpers for the "Follow the Money" extractors (County / City / School).

The parsers and schemas stay per-entity on purpose — a county, a city, and a
school district are structurally different governments — but the mechanics of
reading a budget book are identical: pull every page's text once, locate tables
by section marker (robust to page-number drift), parse money tokens, and
reconcile parsed rows against the book's own printed totals, raising loudly on
any mismatch rather than emitting silently-wrong numbers.

`load_pages(cache=True)` is the iteration speedup: the first text pass over a
chart-heavy book costs minutes (pdfminer interpreting every content stream);
everything after that is microseconds. The cache lives in the gitignored
sources/ folder, keyed on the PDF's (size, mtime), so a swapped file is never
served stale.
"""
import os
import re
import json


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


def load_pages(pdf_path, cache=False):
    """Every page's text, extracted once. With cache=True the texts are cached in
    sources/_pages_<stem>.json (gitignored), invalidated on the PDF's (size, mtime).
    Run the extractors from the repo root, as documented — the cache path is
    relative to the working directory."""
    st = os.stat(pdf_path)
    key = {"size": st.st_size, "mtime": int(st.st_mtime)}
    stem = os.path.splitext(os.path.basename(str(pdf_path)))[0]
    cache_file = os.path.join("sources", f"_pages_{stem}.json")
    if cache and os.path.exists(cache_file):
        with open(cache_file, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("size") == key["size"] and data.get("mtime") == key["mtime"]:
            return data["pages"]
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        pages = [p.extract_text() or "" for p in pdf.pages]
    if cache:
        os.makedirs("sources", exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump({**key, "pages": pages}, f)
    return pages


def find_page(texts, *needles):
    """Index of the single page containing all needles (case-insensitive — some
    books style section headers in alternating case). Fail fast otherwise."""
    lowered = [n.lower() for n in needles]
    hits = [i for i, t in enumerate(texts) if all(n in t.lower() for n in lowered)]
    if len(hits) != 1:
        raise ValueError(f"expected exactly one page for {needles}, found {hits}")
    return hits[0]


def find_first(texts, *needles):
    """Index of the first page containing all needles. Some summaries are
    reprinted on several pages; the first copy is authoritative. Fail fast only
    if none is found."""
    lowered = [n.lower() for n in needles]
    for i, t in enumerate(texts):
        low = t.lower()
        if all(n in low for n in lowered):
            return i
    raise ValueError(f"no page found for {needles}")


def find_section(texts, *needles):
    """Combine the contiguous run of pages, starting at the first match, where
    every needle is present. For detail tables that span several pages and repeat
    the same subtotal labels across sections."""
    lowered = [n.lower() for n in needles]
    hits = [i for i, t in enumerate(texts) if all(n in t.lower() for n in lowered)]
    if not hits:
        raise ValueError(f"no page found for {needles}")
    start = end = hits[0]
    for i in hits[1:]:
        if i == end + 1:
            end = i
        else:
            break
    return "\n".join(texts[start:end + 1])


def reconcile(rows, printed, key, label, tol=0):
    """Fail fast unless the rows' `key` values sum to the printed total (None
    values skipped — e.g. a column a row legitimately omits). tol > 0 only for
    descriptive detail whose own printed subtotal carries the source's rounding;
    integrity anchors reconcile exactly."""
    calc = sum(r[key] for r in rows if r[key] is not None)
    if abs(calc - printed) > tol:
        raise ValueError(f"reconciliation failed on {label} ({key}): parsed {calc:,} vs printed {printed:,}"
                         + (f" (tol {tol})" if tol else ""))


def two_nums(rest):
    """First two signed comma-numbers in a string -> (current, prior)."""
    nums = re.findall(r"\(?-?\$?[\d,]+\)?", rest)
    vals = [money(n) for n in nums]
    vals = [v for v in vals if v is not None]
    if len(vals) < 2:
        raise ValueError(f"expected >=2 numbers in: {rest!r}")
    return vals[0], vals[1]


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
