// Build-time per-entity share pages. The SPA is hash-routed, so crawlers see
// ONE URL and one OG card; these tiny static stubs at /<entity-id>/ give each
// entity its own title/description (with the shared suite card image) and
// instantly redirect readers to the hash route. Runs after `vite build` — see
// the "build" script in package.json. Share links: use
// https://rowanflynnpilot.github.io/wpr-budget/<entity-id>/ when the preview
// card should name the entity.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { billTotal, muniSlug, MUNI_KEY } from "../src/taxmath.js";

const BASE = "https://rowanflynnpilot.github.io/wpr-budget/";
const entities = JSON.parse(readFileSync("src/entities.json", "utf8"));
// The tax-bill card states the municipality count from the data, not a literal.
const dor = JSON.parse(readFileSync("public/marathon-tax-districts.json", "utf8"));
const munis = dor.municipalities.length;

const DESC = {
  county: (e) => `Where the money comes from and where it goes in ${e.name}'s adopted budget — every department, the tax levy, the mill rate, and outstanding debt.`,
  city: (e) => `Where the money comes from and where it goes in the ${e.name} adopted budget — the general fund, the money flow, the workforce, and your tax bill.`,
  school: (e) => `Where the money goes in the ${e.name} budget — spending by object, enrollment, a half-century of mill rates, and the school share of your tax bill.`,
  taxbill: () => `Your complete property-tax bill for any home in Marathon County — all ${munis} cities, villages and towns, every school district — split across the county, your municipality, your school district and the technical college.`,
};

// A budget-season PROPOSED edition gets its own stub too (/<entity-id>-<edition-id>/),
// so a story about the proposal can share a card that says "proposed".
const day = (iso) => new Date(iso + "T00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" });
const EDITION_DESC = (e, ed) => `${e.name}'s proposed ${ed.year} budget, as presented by the County Administrator — every department, the proposed tax levy and mill rate, and outstanding debt. Public hearing ${day(ed.hearing)}; board vote ${day(ed.vote)}.`;

const pages = entities.flatMap((e) => [
  {
    slug: e.id,
    title: `${e.kind === "taxbill" ? "Your Tax Bill" : e.name} — Follow the Money · Wausau Pilot & Review`,
    desc: DESC[e.kind](e),
    route: e.id,
  },
  ...(e.editions || []).map((ed) => ({
    slug: `${e.id}-${ed.id}`,
    title: `${e.name} Proposed ${ed.year} Budget — Follow the Money · Wausau Pilot & Review`,
    desc: EDITION_DESC(e, ed),
    route: `${e.id}~${ed.id}`,
  })),
]);

// The About page (/about/): the link for grant applications and sponsors.
pages.push({
  slug: "about",
  title: "About Follow the Money — Wausau Pilot & Review",
  desc: `A free public ledger of the money behind local government in Marathon County: three budgets explained line by line and the complete property-tax bill for all ${munis} cities, villages and towns, in English, Spanish and Hmong — every number checked against the official documents.`,
  route: "about",
});

// One page per municipality (/tax/<slug>/), for sharing a town's own bill in
// its own Facebook group: the card states what a $200,000 home pays there, and
// the page opens the Tax Bill view on that municipality (it writes the view's
// remembered municipality first — the URL itself carries no reader data).
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const townPages = dor.municipalities.map((m) => {
  const where = `${m.type} of ${m.name}`;
  const bills = m.school_districts.map((sd) => 200 * billTotal(m, sd));
  const amount = bills.length > 1 ? `${usd(Math.min(...bills))}–${usd(Math.max(...bills))}` : usd(bills[0]);
  return {
    slug: "tax/" + muniSlug(m),
    title: `${where}: ${amount} a year on a $200,000 home — Follow the Money · Wausau Pilot & Review`,
    desc: `What a $200,000 home in the ${where} pays in local property taxes at ${dor.meta.tax_year} rates${bills.length > 1 ? ", depending on its school district" : ""}, before the lottery and first-dollar credits — where every dollar goes, and how it compares with Marathon County's other ${munis - 1} cities, villages and towns.`,
    route: "your-tax-bill",
    image: "og-your-tax-bill.png",
    remember: m.code,
  };
});

// A page's card image: its own numbers card when scripts/og_cards.py made one
// (og-<slug>.png), else the suite card.
const cardFor = (slug) => (existsSync(`public/og-${slug}.png`) ? `og-${slug}.png` : "og-image.png");

for (const { slug, title, desc, route, remember, image = cardFor(slug) } of [...pages, ...townPages]) {
  const target = BASE + "#" + route;
  const pageUrl = BASE + slug + "/";
  const before = remember ? `try{localStorage.setItem(${JSON.stringify(MUNI_KEY)},${JSON.stringify(remember)})}catch(e){}` : "";
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${pageUrl}" />
    <link rel="icon" type="image/png" href="${BASE}favicon.png" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Wausau Pilot &amp; Review" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:image" content="${BASE}${image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${BASE}${image}" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <script>${before}location.replace(${JSON.stringify(target)});</script>
  </head>
  <body>
    <p><a href="${target}">Follow the Money — ${title}</a></p>
  </body>
</html>
`;
  mkdirSync(`dist/${slug}`, { recursive: true });
  writeFileSync(`dist/${slug}/index.html`, html);
  console.log(`wrote dist/${slug}/index.html`);
}
