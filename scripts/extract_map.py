"""
extract_map.py - Marathon County's 61 cities, villages and towns as SVG paths,
for the Tax Bill view's map of what the same home pays in each.

Source: the U.S. Census Bureau's cartographic boundary file of Wisconsin's
county subdivisions (1:500,000), which in Wisconsin ARE the cities, villages and
towns DOR reports taxes for. The 2025 file's boundaries are as of January 1,
2025 — the same date as DOR's 2025 assessments (marathon-tax-districts.json):

    https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_55_cousub_500k.zip

    python scripts/extract_map.py sources/census-cousub-2025/cb_2025_55_cousub_500k.zip \
           public/marathon-tax-districts.json public/marathon-map.json

Each shape is matched to its DOR municipality by type and name, one to one, or
this fails. The file is already generalized for maps (~2,700 vertices for the
county), so nothing is simplified: coordinates are projected (equirectangular at
the county's central latitude — under 1% scale error across one county) and
rounded to an integer grid WIDTH units wide, so neighbors share their borders
exactly. Checked: the shapes neither overlap nor leave gaps (their areas sum to
the area of their union). The county outline is the edges only one shape uses;
each municipality's label point is the interior point farthest from its edges.
"""
import argparse
import json
import math
from collections import Counter, defaultdict

import shapefile  # pyshp
from shapely.geometry import Polygon
from shapely.ops import polylabel, unary_union

from lib import write_json

COUNTY_FP = "073"  # Marathon County
LSAD_TYPE = {"25": "City", "47": "Village", "43": "Town"}
WIDTH = 2000
SOURCE_URL = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_55_cousub_500k.zip"


def rings_of(shape):
    bounds = list(shape.parts) + [len(shape.points)]
    return [shape.points[a:b] for a, b in zip(bounds, bounds[1:])]


def quantize(ring, project):
    """A ring on the integer grid, not closed (paths close with z): no repeated
    points, and no spikes (A, B, A — where rounding folds a wiggle back on itself;
    a neighbor's copy of the same border folds the same way)."""
    out = []
    for lon, lat in ring[:-1] if ring[0] == ring[-1] else ring:
        out.append(project(lon, lat))
    changed = True
    while changed and len(out) >= 3:
        changed = False
        for i in range(len(out)):
            n = len(out)
            if out[i] == out[(i + 1) % n]:
                del out[(i + 1) % n]
                changed = True
                break
            if out[i] == out[(i + 2) % n]:
                for j in sorted({(i + 1) % n, (i + 2) % n}, reverse=True):
                    del out[j]
                changed = True
                break
    return out


def path(rings):
    parts = []
    for r in rings:
        steps = [f"{b[0] - a[0]} {b[1] - a[1]}" for a, b in zip(r, r[1:])]
        parts.append(f"M{r[0][0]} {r[0][1]}l{' '.join(steps)}z")
    return "".join(parts)


def outline(all_rings):
    """The county's edge: every grid segment exactly one shape uses, chained into loops."""
    uses = Counter()
    for r in all_rings:
        for a, b in zip(r, r[1:] + r[:1]):
            uses[frozenset((a, b))] += 1
    if any(n > 2 for n in uses.values()):
        raise SystemExit("a border segment is shared by more than two shapes: overlapping boundaries")
    nbrs = defaultdict(list)
    for seg, n in uses.items():
        if n == 1:
            a, b = tuple(seg)
            nbrs[a].append(b)
            nbrs[b].append(a)
    loops, used = [], set()
    for start in list(nbrs):
        for nxt in nbrs[start]:
            if frozenset((start, nxt)) in used:
                continue
            loop, prev, cur = [start], start, nxt
            used.add(frozenset((start, nxt)))
            while cur != start:
                loop.append(cur)
                step = next(p for p in nbrs[cur] if frozenset((cur, p)) not in used)
                used.add(frozenset((cur, step)))
                prev, cur = cur, step
            loops.append(loop)
    return loops


def extract(shp_zip, dor_json):
    with open(dor_json, encoding="utf-8") as f:
        dor = json.load(f)
    feats = [sr for sr in shapefile.Reader(shp_zip).iterShapeRecords() if sr.record["COUNTYFP"] == COUNTY_FP]

    # one to one with DOR's municipalities, by type and name
    by_key = {(LSAD_TYPE[sr.record["LSAD"]], sr.record["NAME"]): sr for sr in feats}
    if len(by_key) != len(feats):
        raise SystemExit("two Census shapes share a type and name")
    want = {(m["type"], m["name"]) for m in dor["municipalities"]}
    if want != set(by_key):
        raise SystemExit(f"Census and DOR disagree. Only in DOR: {sorted(want - set(by_key))}; "
                         f"only in Census: {sorted(set(by_key) - want)}")

    # equirectangular projection at the county's central latitude, scaled to WIDTH
    lons = [x for sr in feats for x, _ in sr.shape.points]
    lats = [y for sr in feats for _, y in sr.shape.points]
    lat0 = (min(lats) + max(lats)) / 2
    k = math.cos(math.radians(lat0))
    scale = WIDTH / ((max(lons) - min(lons)) * k)
    height = round((max(lats) - min(lats)) * scale)
    project_f = lambda lon, lat: ((lon - min(lons)) * k * scale, (max(lats) - lat) * scale)  # noqa: E731
    project = lambda lon, lat: tuple(round(v) for v in project_f(lon, lat))  # noqa: E731
    # miles per degree of latitude at lat0 (WGS84 meridian arc)
    phi = math.radians(lat0)
    mi_per_deg = (111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)) / 1609.344

    shapes, all_rings, polys = [], [], []
    for m in dor["municipalities"]:
        sr = by_key[(m["type"], m["name"])]
        source = rings_of(sr.shape)
        # The checks and the label point use the source geometry, projected but
        # not rounded. A ring inside an odd number of the shape's other rings is
        # a hole (an enclave of a neighbor); winding isn't trusted after the y flip.
        fl = [Polygon([project_f(*pt) for pt in r]) for r in source]
        depth = [sum(j != i and b.contains(a.representative_point()) for j, b in enumerate(fl)) for i, a in enumerate(fl)]
        holes = [fl[i] for i, d in enumerate(depth) if d % 2]
        parts = [Polygon(a.exterior.coords, [h.exterior.coords for h in holes if a.contains(h.representative_point())])
                 for i, a in enumerate(fl) if depth[i] % 2 == 0]
        if not all(p.is_valid for p in parts):
            raise SystemExit(f"{m['type']} of {m['name']}: invalid source polygon")
        polys += parts
        lp = polylabel(max(parts, key=lambda p: p.area), tolerance=0.5)
        # what's drawn: the same rings on the integer grid
        rings = [q for q in (quantize(r, project) for r in source) if len(q) >= 3]
        all_rings += rings
        shapes.append({
            "code": m["code"], "type": m["type"], "name": m["name"], "geoid": sr.record["GEOID"],
            "label": [round(lp.x), round(lp.y)],
            "d": path(rings),
        })

    # No overlaps (the parts' areas sum to their union's), no gaps (the union
    # has no holes) — and the outline built from the grid's once-used edges
    # encloses the same area, so neighbors share their borders exactly.
    union = unary_union(polys)
    total = sum(p.area for p in polys)
    if abs(total - union.area) > 0.001 * union.area:
        raise SystemExit(f"shapes overlap: parts {total:.0f} vs union {union.area:.0f} square units")
    gaps = [g for piece in getattr(union, "geoms", [union]) for g in piece.interiors]
    if gaps:
        raise SystemExit(f"{len(gaps)} gap(s) inside the county that no municipality covers")
    loops = outline(all_rings)
    enclosed = sum(abs(Polygon(lp).area) for lp in loops)
    if abs(enclosed - union.area) > 0.005 * union.area:
        raise SystemExit(f"the outline encloses {enclosed:.0f} square units, the county {union.area:.0f}: "
                         "neighbors don't share their borders on the grid")

    return {
        "meta": {
            "source": "U.S. Census Bureau, 2025 cartographic boundary file: Wisconsin county subdivisions, 1:500,000",
            "source_url": SOURCE_URL,
            "boundaries_as_of": "2025-01-01",
            "projection": f"equirectangular, true scale at {lat0:.3f}° N; north up",
            "width": WIDTH,
            "height": height,
            "units_per_mile": round(scale / mi_per_deg, 3),
        },
        "outline": path(loops),
        "shapes": shapes,
    }


def main():
    ap = argparse.ArgumentParser(description="Marathon County's municipalities as SVG paths (Census boundaries).")
    ap.add_argument("shp_zip", help="the Census cartographic boundary file (cb_YYYY_55_cousub_500k.zip)")
    ap.add_argument("dor", help="public/marathon-tax-districts.json (the municipalities to match)")
    ap.add_argument("out", help="output JSON path (public/marathon-map.json)")
    args = ap.parse_args()
    data = extract(args.shp_zip, args.dor)
    write_json(args.out, data)
    m = data["meta"]
    print(f"wrote {args.out}: {len(data['shapes'])} municipalities, {m['width']}x{m['height']} units, "
          f"{m['units_per_mile']} units per mile")


if __name__ == "__main__":
    main()
