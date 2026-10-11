// Data-contract checks on the COMMITTED files — the gate CI runs before every
// deploy (`npm run check`). verify.py proves the JSON reproduces from the source
// PDFs, but those PDFs aren't in the repo; this proves what ships is internally
// consistent and that the UI's assumptions about it hold. Zero dependencies.
//
//   node scripts/check-data.mjs      # exit 1 with every failure listed
import { readFileSync, existsSync } from "node:fs";
import { billDollars, billParts, billTotal, muniBills, muniSlug, netBill, stateCredits } from "../src/taxmath.js";
import { countyShares, cityShares, schoolShares } from "../src/receipt.js";
import { locate, toLonLat, WAUSAU_AREA } from "../src/mapgeo.js";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const entities = read("src/entities.json");

// ---- manifest: every referenced file exists; every source is a real link ----
for (const e of entities) {
  const files = [e.data, ...Object.values(e.with || {}), ...(e.editions || []).map((ed) => ed.data)];
  for (const f of files) if (!existsSync(`public/${f}`)) fail(`entities.json ${e.id}`, `missing public/${f}`);
  for (const s of [e.source, ...(e.editions || []).map((ed) => ed.source)]) {
    if (!s || !/^https:\/\//.test(s.url) || !s.title) fail(`entities.json ${e.id}`, "source needs {title, https url}");
  }
  for (const ed of e.editions || []) {
    for (const k of ["hearing", "vote"]) if (!/^\d{4}-\d{2}-\d{2}$/.test(ed[k] || "")) fail(`edition ${ed.id}`, `${k} must be an ISO date`);
    // "Have your say": the calendar is in order, names the hearing and vote on their dates, and has an amendment deadline
    const ms = ed.milestones || [];
    const dates = ms.map((m) => m.date);
    if (dates.join() !== [...dates].sort().join()) fail(`edition ${ed.id}`, "milestones out of order");
    for (const [what, date] of [["hearing", ed.hearing], ["vote", ed.vote]]) {
      if (!ms.some((m) => m.what === what && m.date === date)) fail(`edition ${ed.id}`, `milestones need the ${what} on ${date}`);
    }
    if (!ms.some((m) => m.what === "amendments")) fail(`edition ${ed.id}`, "milestones need the amendment deadline");
    for (const k of ["agendas", "find_supervisor", "supervisors"]) {
      if (!/^https:\/\//.test(e.participate?.[k] || "")) fail(`entities.json ${e.id}`, `participate.${k} must be an https link`);
    }
  }
}

// an edition's change log: [{ date, body, summary, url|null }] — hand-edited, so checked strictly
for (const e of entities) for (const ed of e.editions || []) {
  if (!ed.updates) continue;
  const log = read(`public/${ed.updates}`);
  if (!Array.isArray(log)) { fail(ed.updates, "must be a JSON array"); continue; }
  log.forEach((u, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date || "")) fail(ed.updates, `entry ${i}: date must be YYYY-MM-DD`);
    for (const k of ["body", "summary"]) if (typeof u[k] !== "string" || !u[k].trim()) fail(ed.updates, `entry ${i}: ${k} is required`);
    if (u.url !== null && !/^https:\/\//.test(u.url || "")) fail(ed.updates, `entry ${i}: url must be an https link or null`);
  });
}

// a next-year proposal covered by a sibling WPR tool
for (const e of entities.filter((x) => x.companion)) {
  if (!/^https:\/\//.test(e.companion.url) || !Number.isInteger(e.companion.year)) fail(`entities.json ${e.id}`, "companion needs {year, https url}");
}

// ---- County (adopted book + any editions) ----
const countyEnt = entities.find((e) => e.kind === "county");
for (const file of [countyEnt.data, ...(countyEnt.editions || []).map((ed) => ed.data)]) {
  const b = read(`public/${file}`);
  const where = file;
  const m = b.meta;
  if (!["adopted", "proposed"].includes(m.status)) fail(where, `meta.status "${m.status}"`);
  if ((m.status === "adopted") !== Boolean(m.adopted) || (m.status === "proposed") !== Boolean(m.presented)) {
    fail(where, "an adopted book needs meta.adopted, a proposed one meta.presented (and not the other)");
  }
  if (m.status === "proposed" && b.general_fund !== null) {
    // allowed only once the hearing notice is ingested; then it must be complete
    if (!b.general_fund.expenditures?.length) fail(where, "general_fund present but empty");
  }
  if (m.status === "adopted" && !b.general_fund) fail(where, "an adopted book must carry general_fund");
  const rows = [...b.departments.map((d) => [d.department, d]), ...b.funds.map((f) => [f.name, f])];
  for (const [name, r] of rows) {
    if (r.operating_expenditures + r.personnel_expenditures !== r.tax_levy + r.operating_revenues) {
      fail(where, `${name}: spending != levy + revenue`);
    }
    if (r.tax_levy - r.prior_tax_levy !== r.levy_difference) fail(where, `${name}: levy - prior != difference`);
  }
  const h = b.history;
  if (h.years.join() !== [...h.years].sort((a, c) => a - c).join()) fail(where, "history.years not ascending");
  if (h.years.at(-1) !== m.budget_year) fail(where, "latest history year != budget_year");
  for (const y of h.years) {
    if (!["adopted", "proposed"].includes(h.totals[y]?.basis)) fail(where, `history.totals[${y}].basis missing`);
  }
  if (h.totals[m.budget_year].basis !== (m.status === "proposed" ? "proposed" : "adopted")) {
    fail(where, "the latest year's basis disagrees with meta.status");
  }
  if (!Array.isArray(h.funds) || !h.funds.length) fail(where, "history.funds missing");
  // "What changed" and the bill chart read the LAST levy/homeowner row as this budget's year
  for (const k of ["levy_history", "homeowner_impact"]) {
    if (b[k].at(-1).year !== m.budget_year) fail(where, `${k} must end at budget_year ${m.budget_year}`);
  }
  if (!(b.debt.length && b.debt.every((d) => d.outstanding > 0))) fail(where, "debt series must be positive");
}

// ---- City ----
{
  const b = read("public/wausau-city.json");
  const p = b.personnel;
  for (const r of p.rows) if (r.fte.length !== p.total.length) fail("wausau-city.json", `personnel ${r.department}: ${r.fte.length} years vs ${p.total.length}`);
  if (p.years[0] !== Math.max(...p.years)) fail("wausau-city.json", "personnel years must be newest-first");
}

// ---- School ----
{
  const b = read("public/wausau-school.json");
  // per-student spending divides this book's general fund by the latest
  // enrollment year — they must be the same school year
  if (b.enrollment && b.enrollment.labels.at(-1) !== b.meta.fiscal_label) {
    fail("wausau-school.json", `latest enrollment ${b.enrollment.labels.at(-1)} != budget year ${b.meta.fiscal_label}`);
  }
}

// ---- Tax bill (DOR): every municipality x school district yields a real bill ----
{
  const d = read("public/marathon-tax-districts.json");
  for (const m of d.municipalities) {
    const where = `marathon-tax-districts.json ${m.type} of ${m.name}`;
    if (!m.school_districts.length) fail(where, "no school districts");
    if (!m.technical_colleges.length) fail(where, "no technical college");
    for (const s of m.school_districts) {
      const rate = billTotal(m, s); // the formula every tax-bill view uses
      if (!Number.isFinite(rate) || rate <= 0 || rate > 60) fail(where, `${s.name}: bill rate ${rate}`);
    }
  }
  // the state's credits: one rate per municipality / school district, two maximum values
  const c = d.meta.credits;
  if (!c || c.payable !== d.meta.tax_year + 1 || !(c.lottery_max_value > 0) || !(c.first_dollar_max_value > 0)) {
    fail("marathon-tax-districts.json", "meta.credits needs {payable: tax_year + 1, lottery_max_value, first_dollar_max_value}");
  }
  for (const m of d.municipalities) for (const s of m.school_districts) {
    if (!(s.credit_rate > 0 && s.credit_rate < 0.03)) fail(`marathon-tax-districts.json ${m.name}`, `${s.name}: credit_rate ${s.credit_rate}`);
    // the bill after credits on a typical home is still a bill
    if (!(netBill(m, s, c, 200000) > 0)) fail(`marathon-tax-districts.json ${m.name}`, `${s.name}: no bill left after credits`);
    // the bill in whole dollars adds up, comes to the headline figure, and its
    // first-dollar line doesn't move when the primary-home box is ticked
    for (const v of [87500, 200000, 455555]) {
      const [own, other] = [true, false].map((primary) => {
        const b = billDollars(Object.values(billParts(m, s)), v, stateCredits(s, c, v, primary));
        if (b.lines.reduce((x, y) => x + y, 0) !== b.levied || b.levied - b.lottery - b.firstDollar !== b.net
          || b.net !== Math.round(netBill(m, s, c, v, primary)) || b.lottery < 0 || b.firstDollar < 0
          || (!primary && b.lottery !== 0)) fail(`marathon-tax-districts.json ${m.name}`, `${s.name}: $${v} bill doesn't add up`);
        return b;
      });
      if (own.firstDollar !== other.firstDollar) fail(`marathon-tax-districts.json ${m.name}`, `${s.name}: first-dollar credit moves with the primary-home choice`);
    }
  }
  // every municipality gets its own share page at /tax/<slug>/
  const slugs = d.municipalities.map(muniSlug);
  if (new Set(slugs).size !== slugs.length) fail("marathon-tax-districts.json", "two municipalities share a page slug");
}

// ---- the map: one shape per municipality, each inside the map (scripts/extract_map.py) ----
{
  const d = read("public/marathon-tax-districts.json");
  const map = read("public/marathon-map.json");
  const where = "marathon-map.json";
  const codes = map.shapes.map((s) => s.code);
  const want = d.municipalities.map((m) => m.code);
  if (new Set(codes).size !== codes.length) fail(where, "a municipality has two shapes");
  const missing = want.filter((c) => !codes.includes(c));
  const extra = codes.filter((c) => !want.includes(c));
  if (missing.length || extra.length) fail(where, `shapes out of step with the DOR file: missing ${missing.join(", ") || "none"}, extra ${extra.join(", ") || "none"} — rerun python scripts/extract_map.py`);
  const { width: W, height: H } = map.meta;
  for (const s of map.shapes) {
    const [x, y] = s.label;
    if (!(x >= 0 && x <= W && y >= 0 && y <= H) || !/^M\d/.test(s.d)) fail(where, `${s.name}: bad path or label point`);
  }
  if (!(map.meta.units_per_mile > 0) || !/^https:\/\//.test(map.meta.source_url)) fail(where, "meta needs units_per_mile and an https source_url");
  // "Use my location": each municipality's own label point, as a longitude and
  // latitude, is found in that municipality — and a point outside the county in none
  for (const s of map.shapes) {
    const [lon, lat] = toLonLat(map, ...s.label);
    const got = locate(map, lon, lat, 0).code;
    if (got !== s.code) fail(where, `${s.name}: its own label point locates to ${got}`);
  }
  if (locate(map, -89.4012, 43.0731, 0).code !== null) fail(where, "Madison locates inside Marathon County");
  for (const c of WAUSAU_AREA) if (!codes.includes(c)) fail(where, `the Wausau area (mapgeo.js) names ${c}, which isn't on the map`);
}

// ---- share cards: the figures drawn on public/og-*.png (scripts/og_cards.py) still match the data ----
{
  const cards = read("public/og-cards.json");
  const stale = (where, msg) => fail(`og-cards.json ${where}`, `${msg} — rerun python scripts/og_cards.py`);
  const d = read("public/marathon-tax-districts.json");
  const pairs = d.municipalities.flatMap((m) => m.school_districts.map((sd) => ({ m, bill: netBill(m, sd, d.meta.credits, 200000) })))
    .sort((a, c) => a.bill - c.bill);
  const [lo, hi] = [pairs[0], pairs.at(-1)];
  const want = { lo: Math.round(lo.bill), lo_place: `${lo.m.type} of ${lo.m.name}`, hi: Math.round(hi.bill),
    hi_place: `${hi.m.type} of ${hi.m.name}`, municipalities: d.municipalities.length };
  const taxbillId = entities.find((e) => e.kind === "taxbill").id;
  for (const k of ["suite", taxbillId]) {
    if (JSON.stringify(cards[k]) !== JSON.stringify(want)) stale(k, `card says ${JSON.stringify(cards[k])}, data says ${JSON.stringify(want)}`);
  }
  // the Tax Bill card's map: every municipality shaded by its bill (muniBills), on these boundaries
  const geo = read(`public/${entities.find((e) => e.kind === "taxbill").with.map}`);
  const bills = Object.fromEntries(muniBills(d.municipalities, d.meta.credits, 200000).map((r) => [r.m.code, Math.round(r.bill)]));
  const drawn = cards.map || {};
  if (drawn.boundaries_as_of !== geo.meta.boundaries_as_of
    || JSON.stringify(Object.entries(drawn.bills || {}).sort()) !== JSON.stringify(Object.entries(bills).sort())) stale("map", "the map's bills or boundaries differ from the data");
  // the map's lightest and darkest places are the range the card (and the landing) print
  const vals = Object.values(bills);
  if (Math.min(...vals) !== want.lo || Math.max(...vals) !== want.hi) {
    fail("og-cards.json map", `the map runs ${Math.min(...vals)}-${Math.max(...vals)} but the range is ${want.lo}-${want.hi}: an extreme sits in a municipality's smaller school district, so the map and the printed range disagree — decide how to show it`);
  }
  for (const e of entities) for (const ed of e.editions || []) {
    const slug = `${e.id}-${ed.id}`;
    const c = cards[slug];
    if (!c) { stale(slug, "no card for this edition"); continue; }
    const b = read(`public/${ed.data}`);
    const lh = b.levy_history, home = b.homeowner_impact.at(-1);
    const pct = Math.round((lh.at(-1).levy / lh.at(-2).levy - 1) * 1000) / 10;
    if (c.levy_pct !== pct || c.typical_bill !== Math.round(home.tax_amount) || c.typical_pct !== Math.round(home.pct_change_bill * 10) / 10
      || c.hearing !== ed.hearing || c.vote !== ed.vote || c.year !== ed.year) stale(slug, "figures or dates differ from the data");
  }
}

// ---- the tax receipt: each budget's split of its property tax sums to the whole ----
{
  const budgets = { county: read("public/marathon-county.json"), city: read("public/wausau-city.json"), school: read("public/wausau-school.json") };
  for (const [name, shares] of [["county", countyShares(budgets.county)], ["city", cityShares(budgets.city)], ["school", schoolShares(budgets.school)]]) {
    const sum = shares.reduce((s, x) => s + x.share, 0);
    if (Math.abs(sum - 1) > 1e-9 || shares.some((x) => !(x.share >= 0))) fail(`receipt ${name}`, `shares sum to ${sum} (or one is negative)`);
  }
}

// ---- i18n: the three language tables carry exactly the same keys ----
// (English lives in src/i18n.jsx; Spanish and Hmong in src/strings/, loaded on demand)
{
  const keys = (file, marker) => {
    const body = readFileSync(file, "utf8").split(marker)[1].split("\n};")[0];
    return new Set([...body.matchAll(/^ {2}"([^"]+)":/gm)].map((x) => x[1]));
  };
  const en = keys("src/i18n.jsx", "const EN = {");
  for (const lang of ["es", "hmn"]) {
    const t = keys(`src/strings/${lang}.js`, "export default {");
    const missing = [...en].filter((k) => !t.has(k));
    const extra = [...t].filter((k) => !en.has(k));
    if (missing.length) fail(`i18n ${lang}`, `missing ${missing.join(", ")}`);
    if (extra.length) fail(`i18n ${lang}`, `not in EN: ${extra.join(", ")}`);
  }
}

if (failures.length) {
  console.error(`check-data: ${failures.length} failure(s)\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("check-data: all data contracts hold");
