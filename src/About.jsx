import React, { useState, useEffect } from "react";
import { useLang, useStrings } from "./i18n";
import { fetchData } from "./data";
import { compact, fmtDate } from "./format";
import { analyticsEnabled } from "./analytics";
import { CORRECTIONS_URL, SALES_EMAIL, SupportBand, countLink, useAnchorOnMount } from "./ui";
import ChromeBar from "./ChromeBar";

// "About this project" (#about) — the page to put in a grant application or
// hand a prospective sponsor: what the tool covers (every figure computed from
// the same data files the views use), how the numbers are checked, privacy,
// reuse, sponsorship, credits. Lazy-loaded like the bodies.
export default function About({ entities, chrome }) {
  const t = useStrings();
  const [byFile, setByFile] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const files = [...new Set(entities.map((e) => e.data))];
    Promise.all(files.map((f) => fetchData(f).then((j) => [f, j])))
      .then((pairs) => setByFile(Object.fromEntries(pairs)))
      .catch((e) => setErr(String(e.message || e)));
  }, [entities]);

  if (err) return (<div className="ftm"><ChromeBar {...chrome} /><div className="load"><p>{t("app.error")} — {err}</p></div></div>);
  if (!byFile) return (<div className="ftm"><ChromeBar {...chrome} /><div className="load"><p>{t("app.loading")}</p></div></div>);
  return <AboutBody byFile={byFile} entities={entities} chrome={chrome} />;
}

// Mounts only once the data is in, so a deep link (#about/sponsor) and the
// focus-on-view-change land on content that exists.
function AboutBody({ byFile, entities, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  useAnchorOnMount();

  const dor = byFile[entities.find((e) => e.kind === "taxbill").data];
  const totalTax = dor.municipalities.reduce((s, m) => s + m.total_tax, 0);
  // The three budgets as each view headlines them (the School's net of transfers).
  const budgets = entities.filter((e) => e.kind !== "taxbill").reduce((s, e) => {
    const m = byFile[e.data].meta;
    return s + (e.kind === "school" ? m.net_expenditures : m.total_expenditures);
  }, 0);
  const season = entities.find((e) => e.editions && e.editions.length);
  const ed = season && season.editions[0];

  return (
    <div className="ftm">
      <ChromeBar {...chrome} />
      <header className="masthead lp-hero">
        <div className="kicker-row"><span className="pub">{t("about.kicker")}</span></div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("about.dek")}</p>
      </header>

      <div className="about-stats">
        <div><b>{compact(totalTax)}</b><span>{t("about.stat.tax", dor.meta.tax_year)}</span></div>
        <div><b>{dor.municipalities.length}</b><span>{t("about.stat.munis")}</span></div>
        <div><b>{compact(budgets)}</b><span>{t("about.stat.budgets")}</span></div>
        <div><b>3</b><span>{t("about.stat.langs")}</span></div>
      </div>

      <section className="about-sec">
        <h2>{t("about.for.title")}</h2>
        <p><b>{t("about.for.bill.lead")}</b> {t("about.for.bill")}</p>
        <p><b>{t("about.for.season.lead")}</b> {t("about.for.season")}
          {ed && (<> {" "}<a href={"#" + season.id + "~" + ed.id}>{t("about.for.season.now", season.name, ed.year, fmtDate(ed.hearing, lang, false))}</a></>)}</p>
        <p><b>{t("about.for.check.lead")}</b> {t("about.for.check")}</p>
      </section>

      <section className="about-sec">
        <h2>{t("about.check.title")}</h2>
        <p>{t("about.check.1")}</p>
        <p>{t("about.check.2")}</p>
        <p>{t("about.check.3")}</p>
        <p>{t("method.corrections")}{" "}
          <a href={CORRECTIONS_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("corrections")}>{t("method.correctionsLink")}</a></p>
      </section>

      <section className="about-sec">
        <h2>{t("about.privacy.title")}</h2>
        <p>{t("about.privacy.local")}</p>
        {analyticsEnabled && <p>{t("about.privacy.counted")}</p>}
      </section>

      <section className="about-sec">
        <h2>{t("about.reuse.title")}</h2>
        <p>{t("about.reuse.body")}{" "}
          <a href={CORRECTIONS_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("contact")}>{t("about.reuse.link")}</a></p>
      </section>

      <section className="about-sec" id="sponsor">
        <h2>{t("about.sponsor.title")}</h2>
        <p>{t("about.sponsor.body")}</p>
        <p>{t("about.sponsor.ask")}{" "}
          <a href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Sponsoring Follow the Money")}`} onClick={countLink("sponsor-email")}>{SALES_EMAIL}</a></p>
      </section>

      <SupportBand about={false} />

      <footer className="foot">
        <p className="muted">{t("about.credits")}</p>
      </footer>
    </div>
  );
}
