// Data-contract checks on the COMMITTED files — the gate CI runs before every
// deploy (`npm run check`). verify.py proves the JSON reproduces from the source
// PDFs, but those PDFs aren't in the repo; this proves what ships is internally
// consistent and that the UI's assumptions about it hold. Zero dependencies.
//
//   node scripts/check-data.mjs      # exit 1 with every failure listed
import { readFileSync, existsSync } from "node:fs";
import { billTotal, muniSlug } from "../src/taxmath.js";

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
  // every municipality gets its own share page at /tax/<slug>/
  const slugs = d.municipalities.map(muniSlug);
  if (new Set(slugs).size !== slugs.length) fail("marathon-tax-districts.json", "two municipalities share a page slug");
}

// ---- i18n: the three language tables carry exactly the same keys ----
{
  const src = readFileSync("src/i18n.jsx", "utf8");
  const table = (name) => {
    const body = src.split(`const ${name} = {`)[1].split("\n};")[0];
    return new Set([...body.matchAll(/^ {2}"([^"]+)":/gm)].map((x) => x[1]));
  };
  const en = table("EN");
  for (const lang of ["ES", "HMN"]) {
    const t = table(lang);
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
