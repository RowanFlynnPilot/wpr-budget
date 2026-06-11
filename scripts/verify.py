"""Regression harness: re-extract every entity from its canonical sources and
verify the output is byte-identical to the committed public/<entity>.json.

The committed files are documented as exactly reproducible from their PDFs, so
ANY refactor of the extractors (or of scripts/lib.py) can be proven safe by one
run of this script. With the page-text cache warm it completes in seconds; the
first run pays each PDF's one-time text extraction.

    python scripts/verify.py        # from the repo root

Exit status is non-zero on any drift, so it can gate commits or CI."""
import json
import sys

import extract_budget
import extract_wausau
import extract_school

# Each entity's committed file and the exact inputs it was built from.
ENROLLMENT_ZIPS = [f"sources/enrollment_certified_{y}.zip"
                   for y in ("2021-22", "2022-23", "2023-24", "2024-25", "2025-26")]
SCHOOL_PRIOR_BOOKS = ["sources/2025-Wausau-School-Budget.pdf", "sources/2024-Wausau-School-Budget.pdf"]
BUILDS = [
    ("public/marathon-county.json",
     lambda: extract_budget.extract("2026-Annual-Budget.pdf", ["2025-Annual-Budget.pdf"], cache=True)),
    ("public/wausau-city.json",
     lambda: extract_wausau.extract("2026-Wausau-Budget.pdf", cache=True)),
    ("public/wausau-school.json",
     lambda: extract_school.extract("sources/2026-Wausau-School-Budget.pdf", ENROLLMENT_ZIPS,
                                    SCHOOL_PRIOR_BOOKS, cache=True)),
]


def main():
    failed = []
    for path, build in BUILDS:
        fresh = json.dumps(build(), indent=2)
        with open(path, encoding="utf-8") as f:
            committed = f.read()
        if fresh == committed:
            print(f"OK    {path}")
        else:
            failed.append(path)
            # Point at the first divergence to make the drift easy to chase.
            i = next((k for k, (a, b) in enumerate(zip(fresh, committed)) if a != b),
                     min(len(fresh), len(committed)))
            print(f"DRIFT {path} at char {i}: fresh ...{fresh[max(0, i-60):i+60]!r}...")
    if failed:
        sys.exit(f"verify FAILED for: {', '.join(failed)}")
    print("all entities reproduce the committed JSON exactly")


if __name__ == "__main__":
    main()
