import React, { useState, useEffect } from "react";
import { Receipt, ArrowUpRight } from "lucide-react";
import { useLang, useStrings } from "./i18n";
import { fetchData } from "./data";
import { usd, compact, fmtDate } from "./format";
import { ENTITY_LOGOS, MEETING_TRACKER_URL, countLink, SupportBand, SponsorSlot, useAnchorOnMount, billExtremes, rememberMuni, WAUSAU_CITY_DOR,
  CountyShapes, RAMP, rampColor } from "./ui";
import ChromeBar from "./ChromeBar";
import { muniBills, netBill } from "./taxmath";
import { prefetchProps } from "./views";

// The statement's third row: the county, every municipality shaded by what the
// same $200,000 home pays there (light → dark, the Tax Bill map's ramp), the
// two ends of the range pinned with their bills (a label sits right of its pin
// unless that would run off the map). The whole row opens the Tax
// Bill view's map; its box keeps the map's shape while the data loads.
function LandingMap({ map, figures, place, skel, href, prefetch }) {
  const t = useStrings();
  const ready = map && figures;
  const dollars = (n) => usd(Math.round(n));
  const pin = (end, cls) => {
    const s = map.shapes.find((x) => x.code === end.m.code);
    const [x, y] = s.label;
    return (
      <span className={"lp-pin " + cls + (x > map.meta.width * 0.82 ? " flip" : "")} aria-hidden="true"
        style={{ left: (x / map.meta.width) * 100 + "%", top: (y / map.meta.height) * 100 + "%" }}>
        <i /><b>{dollars(end.bill)}</b>
      </span>
    );
  };
  return (
    <a className="lp-map" href={href} {...prefetch} aria-busy={!ready}>
      <div className="lp-map-art">
        {ready ? (<>
          <CountyShapes map={map} fill={(code) => rampColor((figures.bills.get(code) - figures.lo.bill) / (figures.hi.bill - figures.lo.bill))}
            label={t("lp.map.alt", figures.n, usd(200000), dollars(figures.lo.bill), place(figures.lo), dollars(figures.hi.bill), place(figures.hi))} />
          {pin(figures.lo, "lo")}{pin(figures.hi, "hi")}
        </>) : skel("skel-map")}
      </div>
      <div className="lp-map-side">
        <span className="lp-map-head">{t("lp.map.head")}</span>
        <span className="lp-map-note">{t("lp.map.note", usd(200000))}</span>
        <span className="lp-map-ramp" style={{ background: `linear-gradient(90deg, ${RAMP.join(", ")})` }} aria-hidden="true" />
        <span className="lp-map-ends">
          {ready ? (<>
            <span><b>{dollars(figures.lo.bill)}</b>{place(figures.lo)}</span>
            <span><b>{dollars(figures.hi.bill)}</b>{place(figures.hi)}</span>
          </>) : <>{skel("skel-line")}{skel("skel-line skel-short")}</>}
        </span>
        <span className="lp-hook-cta">{t("lp.map.cta")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
      </div>
    </a>
  );
}

// Suite landing page — the front door. It paints at once: the hero, the
// budget-season box and the cards come from the bundled manifest and strings;
// only the figures (the statement block, each card's headline number) wait for
// the data files (via the shared cache), drawn meanwhile as same-size
// placeholders so nothing moves when they land. Picking a card drills into that
// body; the chrome's Home button returns here. Rendered when no entity hash is
// set (bare URL / "#home"), so direct links like #marathon-county skip it.
export default function Landing({ entities, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const [byFile, setByFile] = useState(null);
  const [err, setErr] = useState(null);
  useAnchorOnMount();

  const taxbillEnt = entities.find((e) => e.kind === "taxbill");
  useEffect(() => {
    // every entity's file, plus the county map's boundaries (fetched once, shared
    // with the Tax Bill view through the cache)
    const files = [...new Set([...entities.map((e) => e.data), taxbillEnt.with.map])];
    Promise.all(files.map((f) => fetchData(f).then((j) => [f, j])))
      .then((pairs) => setByFile(Object.fromEntries(pairs)))
      .catch((e) => setErr(String(e.message || e)));
  }, [entities, taxbillEnt]);

  // The combined-bill hook and the Tax Bill card: a $200,000 (fair market value)
  // City of Wausau home in the Wausau School District, after the state's credits
  // for a primary home — the same DOR data and computation as Your Tax Bill.
  const dor = byFile && byFile[taxbillEnt.data];
  const figures = dor && (() => {
    const wausau = dor.municipalities.find((m) => m.code === WAUSAU_CITY_DOR);
    const { lo, hi } = billExtremes(dor.municipalities, dor.meta.credits, 200000);
    return {
      combined: usd(Math.round(netBill(wausau, wausau.school_districts[0], dor.meta.credits, 200000))),
      lo, hi, n: dor.municipalities.length,
      // the map: each municipality's bill (largest school district), as on the Tax Bill view
      bills: new Map(muniBills(dor.municipalities, dor.meta.credits, 200000).map((r) => [r.m.code, r.bill])),
    };
  })();
  const map = byFile && byFile[taxbillEnt.with.map];
  const place = ({ m }) => `${m.type} of ${m.name}`;
  const skel = (cls) => <span className={"skel " + cls} aria-hidden="true" />;
  // Headline figure per card, straight from each entity's reconciled data.
  const headline = (e) => {
    if (!byFile) return { value: skel("skel-num"), label: t(e.kind === "taxbill" ? "lp.card.typicalBill" : "lp.card.budget") };
    const p = byFile[e.data];
    if (e.kind === "school") return { value: compact(p.meta.net_expenditures), label: t("lp.card.budget") };
    if (e.kind === "taxbill") return { value: figures.combined, label: t("lp.card.typicalBill") };
    return { value: compact(p.meta.total_expenditures), label: t("lp.card.budget") };
  };

  return (
    <div className="ftm">
      <ChromeBar {...chrome} />

      <header className="masthead lp-hero">
        <div className="kicker-row"><span className="pub">{t("common.publicLedger")}</span><SponsorSlot entityId={null} /></div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("lp.heroDek")}</p>
      </header>

      {err && <p className="callout-plain" role="alert">{t("app.error")} — {err}</p>}

      {/* The statement: what one home pays, and how far that swings across the county. */}
      <div className="lp-statement" aria-busy={!figures}>
        <button type="button" className="lp-fig" onClick={() => { rememberMuni(WAUSAU_CITY_DOR); chrome.onSelect(taxbillEnt.id); }} {...prefetchProps(taxbillEnt)}>
          <b className="lp-hook-num">{figures ? figures.combined : skel("skel-hook")}</b>
          <span>{t("lp.combinedCaption")}</span>
          <span className="lp-hook-cta">{t("lp.seeBreakdown")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
        </button>
        <a className="lp-fig" href={"#" + taxbillEnt.id + "/compare"} {...prefetchProps(taxbillEnt)}>
          <b className="lp-hook-num">{figures ? <>{usd(Math.round(figures.lo.bill))}–{usd(Math.round(figures.hi.bill))}</> : skel("skel-hook skel-wide")}</b>
          <span>{figures ? t("lp.rangeCaption", place(figures.lo), place(figures.hi), figures.n) : <>{skel("skel-line")}{skel("skel-line skel-short")}</>}</span>
          <span className="lp-hook-cta">{figures ? t("lp.compareCta", figures.n) : skel("skel-num")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
        </a>
        <LandingMap map={map} figures={figures} place={place} skel={skel} href={"#" + taxbillEnt.id + "/compare"} prefetch={prefetchProps(taxbillEnt)} />
      </div>

      {/* Budget season: next year's proposals — an edition served here, or a
          sibling WPR tool (companion). The cards below stay on adopted budgets. */}
      {entities.some((e) => (e.editions && e.editions.length) || e.companion) && (
        <section className="lp-seasons" aria-labelledby="lp-seasons-h">
          <h2 id="lp-seasons-h">{t("lp.seasonHead")}</h2>
          <ul>
            {entities.filter((e) => e.editions && e.editions.length).map((e) => {
              const ed = e.editions[0];
              return (
                <li key={e.id}><a href={"#" + e.id + "~" + ed.id}>
                  <span>{t("lp.season", e.name, ed.year, fmtDate(ed.hearing, lang, false))}</span>
                  <span className="lp-hook-cta">{t("lp.seasonCta")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
                </a></li>
              );
            })}
            {entities.filter((e) => e.companion).map((e) => (
              <li key={e.id}><a href={e.companion.url} target="_blank" rel="noopener noreferrer" onClick={countLink("companion")}>
                <span>{t("lp.companion." + e.kind, e.companion.year)}</span>
                <span className="lp-hook-cta">{t("lp.companionCta")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
              </a></li>
            ))}
          </ul>
        </section>
      )}

      <div className="lp-cards">
        {entities.map((e) => {
          const h = headline(e);
          return (
            <button type="button" className="lp-card" key={e.id} onClick={() => chrome.onSelect(e.id)} {...prefetchProps(e)}>
              <div className="lp-card-mark">
                {e.kind === "taxbill"
                  ? <Receipt size={26} strokeWidth={1.75} aria-hidden="true" />
                  : <img src={ENTITY_LOGOS[e.id]} alt="" />}
              </div>
              <div className="lp-card-name">{e.kind === "taxbill" ? t("common.yourTaxBill") : e.name}</div>
              <div className="lp-card-stat"><b>{h.value}</b> <span>{h.label}</span></div>
              <p className="lp-card-desc">{e.kind === "county"
                ? (byFile ? t("lp.desc.county", byFile[e.data].departments.length) : <>{skel("skel-line")}{skel("skel-line skel-short")}</>)
                : t("lp.desc." + e.kind)}</p>
              <span className="lp-card-cta">{t("lp.explore")} <ArrowUpRight size={14} strokeWidth={2.5} /></span>
            </button>
          );
        })}
      </div>

      <div className="lp-credibility">
        <p className="note">{t("lp.credibility")}</p>
        <a className="suite-link" href={MEETING_TRACKER_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("meeting-tracker")}>
          <span className="suite-link__icon" aria-hidden="true">📋</span>
          <span><b>{t("suite.linkLead")}</b> {t("suite.linkBody")}</span>
          <ArrowUpRight size={16} strokeWidth={2.5} className="suite-link__arrow" />
        </a>
      </div>

      <SupportBand />

      <footer className="foot">
        <p className="muted">{t("lp.footer")}</p>
      </footer>
    </div>
  );
}
