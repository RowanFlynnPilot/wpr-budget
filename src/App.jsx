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
 * the single source of truth for navigation — "#<entity-id>[/<section>]".
 * Entity switches, subnav section links, and browser back/forward all funnel
 * through hashchange. App fetches the active entity's data file and routes to
 * the body for that entity's kind; the bodies own all the section logic.
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

// Parse "#<entity-id>[/<section>]". Anything that isn't a known entity id
// (bare URL, "#home", unknown) means the suite landing page (id === null).
function parseHash() {
  const [id, section] = window.location.hash.slice(1).split("/");
  const ent = entities.find((e) => e.id === id);
  return { id: ent ? ent.id : null, section: (ent && section) || null };
}

function Frame({ children }) {
  return <div className="ftm load"><p>{children}</p></div>;
}

export default function App() {
  const [activeId, setActiveId] = useState(() => {
    const r = parseHash();
    setPendingSection(r.section); // consumed by the body's mount effect
    return r.id;
  });
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    const onHash = () => {
      const r = parseHash();
      if (r.id === activeIdRef.current) {
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
      setActiveId(r.id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Fetch the active entity's data. The stale flag closes a race: switching
  // A->B while A's (slower) fetch is in flight must not let A's late response
  // overwrite B's data — with the activeId gate below, that would strand the
  // view on the loading screen.
  useEffect(() => {
    if (!activeId) return;
    const ent = entities.find((e) => e.id === activeId);
    let stale = false;
    fetchData(ent.data)
      .then((payload) => { if (!stale) setData({ id: activeId, payload }); })
      .catch((e) => { if (!stale) setErr(String(e.message || e)); });
    return () => { stale = true; };
  }, [activeId]);

  // null id => the suite overview (the landing page). hashchange drives the
  // actual route update.
  const onSelect = (id) => { window.location.hash = id || "home"; };

  if (err) return <Frame>Could not load budget data &mdash; {err}</Frame>;

  const chrome = { entities, activeId, onSelect, annotations };
  // No entity selected → the suite landing page.
  if (!activeId) return <LangProvider><Landing entities={entities} chrome={chrome} /></LangProvider>;

  // Gate on data.id === activeId so we never render a body with the previous
  // entity's data during a switch (the bodies assume their own entity's schema).
  if (!data || data.id !== activeId) return <Frame>Loading the ledger&hellip;</Frame>;

  const ent = entities.find((e) => e.id === activeId);
  const Body = BODY_BY_KIND[ent.kind] || Ledger;
  return (
    <LangProvider>
      <Suspense fallback={<Frame>Loading the ledger&hellip;</Frame>}>
        <Body key={activeId} b={data.payload} chrome={chrome} />
      </Suspense>
    </LangProvider>
  );
}
