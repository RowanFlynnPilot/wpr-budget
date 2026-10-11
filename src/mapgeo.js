// Which municipality is a longitude/latitude in? Plain JS (no React), so the CI
// data check can prove it against every municipality. The shapes are the county
// map's (public/marathon-map.json, scripts/extract_map.py): SVG paths of
// "M x y l dx dy … z" rings on an integer grid, which meta.geo places a
// longitude/latitude on. Used by the Tax Bill view's "Use my location" — the
// position is matched here, in the browser, and never sent or stored.

// A path's rings, as [[x, y], …] in grid units.
export function ringsOf(d) {
  return d.split("z").filter(Boolean).map((part) => {
    const n = part.match(/-?\d+/g).map(Number);
    const ring = [[n[0], n[1]]];
    for (let i = 2; i < n.length; i += 2) {
      const [x, y] = ring[ring.length - 1];
      ring.push([x + n[i], y + n[i + 1]]);
    }
    return ring;
  });
}

export const toGrid = (map, lon, lat) => {
  const g = map.meta.geo;
  return [(lon - g.lon0) * g.x_per_deg, (g.lat0 - lat) * g.y_per_deg];
};
export const toLonLat = (map, x, y) => {
  const g = map.meta.geo;
  return [g.lon0 + x / g.x_per_deg, g.lat0 - y / g.y_per_deg];
};

// Even-odd: inside a shape's outer ring and not inside one of its holes (an
// enclave of a neighbor, which is that neighbor's own shape).
function inside(rings, x, y) {
  let odd = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

function distance(rings, x, y) {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i];
      const dx = bx - ax, dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
  }
  return best;
}

// { code, near }: the municipality the point is in (null outside the county),
// and the others whose border lies within `meters` of it, nearest first — where
// the position's own uncertainty, or the map's generalized lines, could put the
// home on the other side.
export function locate(map, lon, lat, meters) {
  const [x, y] = toGrid(map, lon, lat);
  const reach = (meters / 1609.344) * map.meta.units_per_mile;
  let code = null;
  const near = [];
  for (const s of map.shapes) {
    const rings = ringsOf(s.d);
    if (inside(rings, x, y)) code = s.code;
    else {
      const dist = distance(rings, x, y);
      if (dist <= reach) near.push([dist, s.code]);
    }
  }
  return { code, near: near.sort((a, c) => a[0] - c[0]).map(([, c]) => c) };
}

// "The Wausau area" the Tax Bill map zooms to: the urban core along the river
// (the City of Wausau, Schofield, Rothschild, Weston), framed with room around
// it — Rib Mountain and parts of Kronenwetter and Maine come into view too. With
// those three, 59% of the county's people live in a few square inches of the
// whole-county map. DOR codes; check-data proves each is still on the map.
export const WAUSAU_AREA = ["37291", "37281", "37176", "37192"];
