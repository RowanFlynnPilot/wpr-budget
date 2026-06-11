import React, { useState, useMemo } from "react";
import { useStrings } from "../i18n";
import { usd } from "../format";
import { SectionHead, Stat, SponsorSlot, HomeValueCalc, TaxSplit, useAnchorOnMount } from "../ui";
import ChromeBar from "../ChromeBar";

// Cross-entity overview: a City of Wausau homeowner's COMPLETE local property-
// tax bill, split across every taxing jurisdiction (city, county, school,
// technical college), each row clickable through to its entity. Sourced from
// the City book's tax_by_jurisdiction table — all jurisdictions, one year,
// reconciled to the total — so it's the real breakdown of one bill, not four
// numbers stitched together.

// Maps a jurisdiction name to its suite entity id for the drill-down.
function billEntityFor(name) {
  const n = name.toLowerCase();
  if (n.includes("city of wausau")) return "wausau-city";
  if (n.includes("marathon county")) return "marathon-county";
  if (n.includes("school")) return "wausau-school";
  return null; // e.g. NC Technical College — not its own entity in the suite
}

export default function TaxBillOverview({ b, chrome }) {
  const t = useStrings();
  const [homeValue, setHomeValue] = useState(200000);
  useAnchorOnMount();

  const j = b.tax_by_jurisdiction;
  const ry = j.rate_years[0];
  const jtotal = j.total[ry];
  const inSuite = (id) => id && chrome.entities.some((e) => e.id === id);
  const splitRows = useMemo(() => [...j.rows]
    .sort((a, c) => c.rates[ry] - a.rates[ry])
    .map((r) => {
      const id = billEntityFor(r.jurisdiction);
      return { key: r.jurisdiction, label: r.jurisdiction, rate: r.rates[ry], drillId: inSuite(id) ? id : null };
    }), [j.rows, ry]);
  const bill = Math.round((homeValue / 1000) * jtotal);
  const top = splitRows[0];

  return (
    <div className="ftm">
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">{t("common.publicLedger")}</span>
            <span className="dot">·</span>
            <span>{t("common.yourTaxBill")}</span>
            <SponsorSlot entityId={chrome.activeId} />
          </div>
        </div>
        <h1>{t("tb.h1")}</h1>
        <p className="dek">{t("tb.dek")}</p>
        <div className="stat-strip">
          <Stat icon="🧾" label={t("tb.stat.combinedRate")} value={"$" + jtotal.toFixed(2)} sub={t("tb.stat.combinedRateSub", ry)} />
          <Stat icon="🏛️" label={t("tb.stat.govts")} value={String(splitRows.length)} sub={t("tb.stat.govtsSub")} />
          <Stat icon="🏠" label={t("tb.stat.largest")} value={Math.round((top.rate / jtotal) * 100) + "%"} sub={top.label.replace(/\s*\(net\)/i, "")} />
        </div>
      </header>

      <section id="bill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("tb.sec.title")}>
          {t("tb.sec.dek")}
        </SectionHead>

        <HomeValueCalc id="homeval-all" label={t("tb.homeLabel")} outLabel={t("tb.estOut")}
          outValue={usd(bill)} value={homeValue} onChange={setHomeValue} />

        <TaxSplit rows={splitRows} total={jtotal} homeValue={homeValue}
          totalLabel={t("tb.totalRow")} exploreLabel={t("tb.explore")}
          onDrill={(id) => chrome.onSelect(id)} />
        <p className="note">{t("tb.note", ry, jtotal.toFixed(2))}</p>
      </section>

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> {t("tb.foot.source", ry)}</p>
        <p className="muted">{t("tb.foot.builtBy")}</p>
      </footer>
    </div>
  );
}
