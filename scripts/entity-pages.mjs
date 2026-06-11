// Build-time per-entity share pages. The SPA is hash-routed, so crawlers see
// ONE URL and one OG card; these tiny static stubs at /<entity-id>/ give each
// entity its own title/description (with the shared suite card image) and
// instantly redirect readers to the hash route. Runs after `vite build` — see
// the "build" script in package.json. Share links: use
// https://rowanflynnpilot.github.io/wpr-budget/<entity-id>/ when the preview
// card should name the entity.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://rowanflynnpilot.github.io/wpr-budget/";
const entities = JSON.parse(readFileSync("src/entities.json", "utf8"));

const DESC = {
  county: (e) => `Where the money comes from and where it goes in ${e.name}'s adopted budget — every department, the tax levy, the mill rate, and outstanding debt.`,
  city: (e) => `Where the money comes from and where it goes in the ${e.name} adopted budget — the general fund, the money flow, the workforce, and your tax bill.`,
  school: (e) => `Where the money goes in the ${e.name} budget — spending by object, enrollment, a half-century of mill rates, and the school share of your tax bill.`,
  taxbill: () => "Your complete Wausau property-tax bill, split across the city, county, school district and technical college — one calculator, every jurisdiction.",
};

for (const e of entities) {
  const title = `${e.kind === "taxbill" ? "Your Tax Bill" : e.name} — Follow the Money · Wausau Pilot & Review`;
  const desc = DESC[e.kind](e);
  const target = BASE + "#" + e.id;
  const pageUrl = BASE + e.id + "/";
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
    <meta property="og:image" content="${BASE}og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${BASE}og-image.png" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <script>location.replace(${JSON.stringify(target)});</script>
  </head>
  <body>
    <p><a href="${target}">Follow the Money — ${title}</a></p>
  </body>
</html>
`;
  mkdirSync(`dist/${e.id}`, { recursive: true });
  writeFileSync(`dist/${e.id}/index.html`, html);
  console.log(`wrote dist/${e.id}/index.html`);
}
