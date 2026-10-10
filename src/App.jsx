import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { LangProvider } from "./i18n";
import entities from "./entities.json";
import annotations from "./annotations.json";
import { fetchData } from "./data";
import { setPendingSection } from "./nav";
import Landing from "./Landing";

/*
 * Follow the Money — civic budget explorer suite (Wausau Pilot & Review)
 *
 * Multi-entity: the manifest (src/entities.json) is bundled; the URL hash is
 * the single source of truth for navigation — "#<entity-id>[~<edition>][/<section>]".
 * Entity switches, subnav section links, and browser back/forward all funnel
 * through hashchange. App fetches the active entity's data file and routes to
 * the body for that entity's kind; the bodies own all the section logic.
 *
 * Editions: during budget season an entity can also serve the next year's
 * PROPOSED book (an `editions` entry in the manifest), e.g.
 * "#marathon-county~2027-proposed". The bare entity id stays the adopted book,
 * so existing embeds and links never silently change what they show. The
 * "route id" (entity + edition) is what deep links, the subnav and Share carry.
 *
 * The four bodies are lazy chunks: the landing page (the default front door
 * and the WordPress embed) ships without recharts; the chart-heavy code loads
 * only when a body opens. One source of truth: no inline data, no fallback; a
 * missing file shows an error, not stale or invented numbers.
 */
const Ledger = lazy(() => import("./bodies/Ledger"));
const CityLedger = lazy(() => import("./bodies/CityLedger"));
const SchoolLedger = lazy(() => import("./bodies/SchoolLedger"));
const TaxBillOverview = lazy(() => import("./bodies/TaxBillOverview"));

const BODY_BY_KIND = { county: Ledger, city: CityLedger, school: SchoolLedger, taxbill: TaxBillOverview };

// Parse "#<entity-id>[~<edition>][/<section>]". Anything that isn't a known
// entity id (bare URL, "#home", unknown) means the suite landing page
// (route === null); an unknown edition is dropped like an unknown section.
function parseHash() {
  const [routeToken, section] = window.location.hash.slice(1).split("/");
  const [id, editionId] = routeToken.split("~");
  const ent = entities.find((e) => e.id === id);
  if (!ent) return { route: null, section: null };
  const edition = (ent.editions || []).find((ed) => ed.id === editionId) || null;
  return { route: edition ? `${ent.id}~${edition.id}` : ent.id, section: section || null };
}

// Route id -> the entity, its edition (or null for the adopted book), and the
// data file to fetch.
function resolveRoute(route) {
  const [id, editionId] = route.split("~");
  const ent = entities.find((e) => e.id === id);
  const edition = editionId ? ent.editions.find((ed) => ed.id === editionId) : null;
  return { ent, edition, dataFile: edition ? edition.data : ent.data };
}

function Frame({ children }) {
  return <div className="ftm load"><p>{children}</p></div>;
}

export default function App() {
  const [route, setRoute] = useState(() => {
    const r = parseHash();
    setPendingSection(r.section); // consumed by the body's mount effect
    return r.route;
  });
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const onHash = () => {
      const r = parseHash();
      if (r.route === routeRef.current) {
        // Same view: scroll only, no state change. Instant, not smooth —
        // smooth programmatic scrolls are unreliably canceled by chart
        // reflows (and were observed not to move at all in testing).
        // (Without a section, the browser's own history scroll restoration
        // does the right thing.)
        if (r.section) document.getElementById(r.section)?.scrollIntoView({ behavior: "instant", block: "start" });
        return;
      }
      // Different view: remember the section target; the new body's mount
      // effect (after data + lazy chunk are both ready) performs the scroll.
      setPendingSection(r.section);
      setRoute(r.route);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Fetch the active route's data. The stale flag closes a race: switching
  // A->B while A's (slower) fetch is in flight must not let A's late response
  // overwrite B's data — with the route gate below, that would strand the
  // view on the loading screen.
  useEffect(() => {
    if (!route) return;
    let stale = false;
    fetchData(resolveRoute(route).dataFile)
      .then((payload) => { if (!stale) setData({ route, payload }); })
      .catch((e) => { if (!stale) setErr(String(e.message || e)); });
    return () => { stale = true; };
  }, [route]);

  // A route id ("marathon-county", "marathon-county~2027-proposed"); null =>
  // the suite overview (the landing page). hashchange drives the actual update.
  const onSelect = (id) => { window.location.hash = id || "home"; };

  if (err) return <Frame>Could not load budget data &mdash; {err}</Frame>;

  // No entity selected → the suite landing page.
  if (!route) {
    const chrome = { entities, activeId: null, routeId: null, edition: null, onSelect, annotations };
    return <LangProvider><Landing entities={entities} chrome={chrome} /></LangProvider>;
  }

  // Gate on data.route === route so we never render a body with the previous
  // route's data during a switch (the bodies assume their own entity's schema,
  // and an edition switch must never show the other edition's figures).
  if (!data || data.route !== route) return <Frame>Loading the ledger&hellip;</Frame>;

  const { ent, edition, dataFile } = resolveRoute(route);
  const chrome = { entities, activeId: ent.id, routeId: route, edition, dataFile, onSelect, annotations };
  const Body = BODY_BY_KIND[ent.kind] || Ledger;
  return (
    <LangProvider>
      <Suspense fallback={<Frame>Loading the ledger&hellip;</Frame>}>
        <Body key={route} b={data.payload} chrome={chrome} />
      </Suspense>
    </LangProvider>
  );
}
