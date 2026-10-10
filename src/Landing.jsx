import React, { useState, useEffect } from "react";
import { Receipt, ArrowUpRight } from "lucide-react";
import { useLang, useStrings } from "./i18n";
import { fetchData } from "./data";
import { usd, compact, fmtDate } from "./format";
import { ENTITY_LOGOS, MEETING_TRACKER_URL, SponsorSlot, useAnchorOnMount, billRates, rememberMuni, WAUSAU_CITY_DOR } from "./ui";
import ChromeBar from "./ChromeBar";

// Suite landing page — the front door. Fetches every entity's data once (via
// the shared cache), shows a hero, the combined "your whole tax bill" hook, a
// card per entity (logo, headline figure, blurb), and the open-data/credibility
// strip. Picking a card drills into that body; the chrome's Home button returns
// here. Rendered when no entity hash is set (bare URL / "#home"), so direct
// links like #marathon-county still skip it.
export default function Landing({ entities, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const [byFile, setByFile] = useState(null);
  const [err, setErr] = useState(null);
  useAnchorOnMount();

  useEffect(() => {
    const files = [...new Set(entities.map((e) => e.data))];
    Promise.all(files.map((f) => fetchData(f).then((j) => [f, j])))
      .then((pairs) => setByFile(Object.fromEntries(pairs)))
      .catch((e) => setErr(String(e.message || e)));
  }, [entities]);

  if (err) return (<div className="ftm load"><p>Could not load budget data &mdash; {err}</p></div>);
  if (!byFile) return (<div className="ftm load"><p>Loading the ledger&hellip;</p></div>);

  const year = byFile[entities[0].data].meta.budget_year;
  // The combined-bill hook and the Tax Bill card: a $200,000 (fair market value)
  // City of Wausau home in the Wausau School District, from the same DOR data
  // and computation as the Your Tax Bill view itself.
  const taxbillEnt = entities.find((e) => e.kind === "taxbill");
  const wausau = byFile[taxbillEnt.data].municipalities.find((m) => m.code === WAUSAU_CITY_DOR);
  const combinedBill = usd(Math.round(200 * billRates(wausau, "").total));
  // Headline figure per card, straight from each entity's reconciled data.
  const headline = (e) => {
    const p = byFile[e.data];
    if (e.kind === "school") return { value: compact(p.meta.net_expenditures), label: t("lp.card.budget") };
    if (e.kind === "taxbill") return { value: combinedBill, label: t("lp.card.typicalBill") };
    return { value: compact(p.meta.total_expenditures), label: t("lp.card.budget") };
  };

  return (
    <div className="ftm">
      <ChromeBar {...chrome} year={year} />

      <header className="masthead lp-hero">
        <div className="kicker-row"><span className="pub">{t("common.publicLedger")}</span><SponsorSlot entityId={null} /></div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("lp.heroDek")}</p>
      </header>

      <button type="button" className="lp-hook" onClick={() => { rememberMuni(WAUSAU_CITY_DOR); chrome.onSelect(taxbillEnt.id); }}>
        <span>{t("lp.combined", combinedBill)}</span>
        <span className="lp-hook-cta">{t("lp.seeBreakdown")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
      </button>

      {/* Budget season: any entity whose next-year PROPOSED book is out. The cards
          and headline figures above stay on the adopted budgets. */}
      {entities.filter((e) => e.editions && e.editions.length).map((e) => {
        const ed = e.editions[0];
        return (
          <a key={e.id} className="edition edition--pointer" href={"#" + e.id + "~" + ed.id}>
            <span>{t("lp.season", e.name, ed.year, fmtDate(ed.hearing, lang, false))}</span>
            <span className="lp-hook-cta">{t("lp.seasonCta")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
          </a>
        );
      })}

      <div className="lp-cards">
        {entities.map((e) => {
          const h = headline(e);
          return (
            <button type="button" className="lp-card" key={e.id} onClick={() => chrome.onSelect(e.id)}>
              <div className="lp-card-mark">
                {e.kind === "taxbill"
                  ? <Receipt size={26} strokeWidth={1.75} aria-hidden="true" />
                  : <img src={ENTITY_LOGOS[e.id]} alt="" />}
              </div>
              <div className="lp-card-name">{e.kind === "taxbill" ? t("common.yourTaxBill") : e.name}</div>
              <div className="lp-card-stat"><b>{h.value}</b> <span>{h.label}</span></div>
              <p className="lp-card-desc">{e.kind === "county"
                ? t("lp.desc.county", byFile[e.data].departments.length)
                : t("lp.desc." + e.kind)}</p>
              <span className="lp-card-cta">{t("lp.explore")} <ArrowUpRight size={14} strokeWidth={2.5} /></span>
            </button>
          );
        })}
      </div>

      <div className="lp-credibility">
        <p className="note">{t("lp.credibility")}</p>
        <a className="suite-link" href={MEETING_TRACKER_URL} target="_blank" rel="noopener noreferrer">
          <span className="suite-link__icon" aria-hidden="true">📋</span>
          <span><b>{t("suite.linkLead")}</b> {t("suite.linkBody")}</span>
          <ArrowUpRight size={16} strokeWidth={2.5} className="suite-link__arrow" />
        </a>
      </div>

      <footer className="foot">
        <p className="muted">{t("lp.footer")}</p>
      </footer>
    </div>
  );
}
