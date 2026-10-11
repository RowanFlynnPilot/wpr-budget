import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { LangProvider, useStrings } from "./i18n";
import entities from "./entities.json";
import annotations from "./annotations.json";
import { fetchData } from "./data";
import { BODY_LOADERS } from "./views";
import { setPendingSection } from "./nav";
import Landing from "./Landing";
import ChromeBar from "./ChromeBar";

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
const Ledger = lazy(BODY_LOADERS.county);
const CityLedger = lazy(BODY_LOADERS.city);
const SchoolLedger = lazy(BODY_LOADERS.school);
const TaxBillOverview = lazy(BODY_LOADERS.taxbill);
const About = lazy(() => import("./About"));
const Card = lazy(() => import("./Card"));

const BODY_BY_KIND = { county: Ledger, city: CityLedger, school: SchoolLedger, taxbill: TaxBillOverview };

// Parse "#<entity-id>[~<edition>][/<section>]". Anything that isn't a known
// entity id (bare URL, "#home", unknown) means the suite landing page
// (route === null); an unknown edition is dropped like an unknown section.
// "#about[/<section>]" is the About page and "#card" the story card for
// WordPress embeds — neither is an entity, and neither has a data file of its own.
function parseHash() {
  const [routeToken, section] = window.location.hash.slice(1).split("/");
  if (routeToken === "about") return { route: "about", section: section || null };
  if (routeToken === "card") return { route: "card", section: null };
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

// Loading / error states keep the chrome (so a reader can always switch view or
// go home) and speak the reader's language.
function Frame({ chrome, msg, detail }) {
  const t = useStrings();
  return (
    <div className="ftm">
      {chrome && <ChromeBar {...chrome} />}
      <div className="load" role="status"><p>{t(msg)}{detail ? " — " + detail : ""}</p></div>
    </div>
  );
}

const SITE = "Follow the Money · Wausau Pilot & Review";

// A render error in one view must not blank the whole page (or the WordPress
// embed): show the chrome and a translated message instead, logged for
// debugging. Keyed by route in App, so switching views clears it.
class ViewBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("view failed to render", error, info.componentStack);
  }
  render() {
    return this.state.failed ? <Frame chrome={this.props.chrome} msg="app.renderError" /> : this.props.children;
  }
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

  // Fetch the active route's data, plus any supporting files the manifest
  // lists under `with` (e.g. the DOR taxing-district data the tax-bill views
  // need) — all before the body renders, so a body never sees half its data.
  // The stale flag closes a race: switching A->B while A's (slower) fetch is in
  // flight must not let A's late response overwrite B's data — with the route
  // gate below, that would strand the view on the loading screen.
  useEffect(() => {
    if (!route || route === "about" || route === "card") return;
    let stale = false;
    setErr(null); // a failed view must not strand every later view on its error
    const { ent, edition, dataFile } = resolveRoute(route);
    // The view's code downloads alongside its data, not after it (React.lazy
    // shares the same import, so the body mounts as soon as both are in).
    BODY_LOADERS[ent.kind]().catch(() => {});
    // An edition's change log (amendments since the proposal) rides along as `updates`.
    const extras = Object.entries({ ...(ent.with || {}), ...(edition && edition.updates ? { updates: edition.updates } : {}) });
    Promise.all([fetchData(dataFile), ...extras.map(([, file]) => fetchData(file))])
      .then(([payload, ...more]) => {
        if (!stale) setData({ route, payload, extra: Object.fromEntries(extras.map(([key], i) => [key, more[i]])) });
      })
      .catch((e) => { if (!stale) setErr(String(e.message || e)); });
    return () => { stale = true; };
  }, [route]);

  // A route id ("marathon-county", "marathon-county~2027-proposed"); null =>
  // the suite overview (the landing page). hashchange drives the actual update.
  const onSelect = (id) => { window.location.hash = id || "home"; };

  // The tab/window title names the view (screen readers announce it; shared
  // tabs and history read better).
  useEffect(() => {
    if (!route) { document.title = SITE; return; }
    if (route === "about") { document.title = `About — ${SITE}`; return; }
    if (route === "card") { document.title = `What does your home pay? — ${SITE}`; return; }
    const { ent, edition } = resolveRoute(route);
    document.title = `${ent.name}${edition ? `, ${edition.year} proposed budget` : ""} — ${SITE}`;
  }, [route]);

  // No entity selected → the suite landing page.
  if (!route) {
    const chrome = { entities, activeId: null, routeId: null, edition: null, onSelect, annotations };
    if (err) return <LangProvider><Frame chrome={chrome} msg="app.error" detail={err} /></LangProvider>;
    return <LangProvider><Landing entities={entities} chrome={chrome} /></LangProvider>;
  }

  if (route === "card") {
    return (
      <LangProvider>
        <ViewBoundary key={route} chrome={null}>
          <Suspense fallback={null}><Card /></Suspense>
        </ViewBoundary>
      </LangProvider>
    );
  }

  if (route === "about") {
    const chrome = { entities, activeId: null, routeId: "about", edition: null, onSelect, annotations };
    return (
      <LangProvider>
        <ViewBoundary key={route} chrome={chrome}>
          <Suspense fallback={<Frame chrome={chrome} msg="app.loading" />}>
            <About entities={entities} chrome={chrome} />
          </Suspense>
        </ViewBoundary>
      </LangProvider>
    );
  }

  const { ent, edition, dataFile } = resolveRoute(route);
  // `source`: the document this view's numbers come from (the edition's, if any).
  const source = edition ? edition.source : ent.source;
  const chrome = { entities, activeId: ent.id, routeId: route, edition, dataFile, source, onSelect, annotations };
  if (err) return <LangProvider><Frame chrome={chrome} msg="app.error" detail={err} /></LangProvider>;

  // Gate on data.route === route so we never render a body with the previous
  // route's data during a switch (the bodies assume their own entity's schema,
  // and an edition switch must never show the other edition's figures).
  if (!data || data.route !== route) return <LangProvider><Frame chrome={chrome} msg="app.loading" /></LangProvider>;

  const Body = BODY_BY_KIND[ent.kind] || Ledger;
  return (
    <LangProvider>
      <ViewBoundary key={route} chrome={chrome}>
        <Suspense fallback={<Frame chrome={chrome} msg="app.loading" />}>
          <Body key={route} b={data.payload} extra={data.extra} chrome={chrome} />
        </Suspense>
      </ViewBoundary>
    </LangProvider>
  );
}
