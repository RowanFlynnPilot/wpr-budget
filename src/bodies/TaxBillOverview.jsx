import React, { useMemo } from "react";
import { useStrings } from "../i18n";
import { usd } from "../format";
import {
  SectionHead, Stat, SponsorSlot, HomeValueCalc, TaxSplit, MuniPicker, SchoolPicker, billRates,
  useAnchorOnMount, useHomeValue, useMuniChoice, useSchoolChoice, WAUSAU_CITY_DOR,
} from "../ui";
import ChromeBar from "../ChromeBar";

// Cross-entity overview: ANY Marathon County homeowner's complete local
// property-tax bill — pick the municipality (and, where it spans more than one,
// the school district), enter the home's fair market value — split across every
// taxing government, each row clickable through to its entity where the suite
// has one. Sourced from the Wisconsin DOR's Town, Village and City Taxes data
// (b = public/marathon-tax-districts.json): every municipality's actual levies
// and values for the latest certified year, on one basis (see billRates).
export default function TaxBillOverview({ b, chrome }) {
  const t = useStrings();
  const [homeValue, setHomeValue] = useHomeValue();
  const [muniCode, setMuniCode] = useMuniChoice();
  useAnchorOnMount();

  const year = b.meta.tax_year;
  // A saved choice from an older data year that no longer exists starts over at Wausau.
  const muni = b.municipalities.find((m) => m.code === muniCode)
    || b.municipalities.find((m) => m.code === WAUSAU_CITY_DOR);
  const [school, setSchool] = useSchoolChoice(muni.code);
  const bill = useMemo(() => billRates(muni, school), [muni, school]);
  const inSuite = (id) => id && chrome.entities.some((e) => e.id === id);
  const splitRows = useMemo(() => bill.rows
    .map((r) => ({ ...r, drillId: inSuite(r.drillId) ? r.drillId : null }))
    .sort((a, c) => c.rate - a.rate), [bill.rows]);
  const total = bill.total;
  const top = splitRows[0];

  return (
    <div className="ftm">
      <ChromeBar {...chrome} />

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
          <Stat icon="🧾" label={t("tb.stat.combinedRate")} value={"$" + total.toFixed(2)} sub={t("tb.stat.combinedRateSub", year)} />
          <Stat icon="🏛️" label={t("tb.stat.govts")} value={String(splitRows.length)} sub={t("tb.stat.govtsSub")} />
          <Stat icon="🏠" label={t("tb.stat.largest")} value={Math.round((top.rate / total) * 100) + "%"} sub={top.label.replace(/\s*\(net\)/i, "")} />
        </div>
      </header>

      <section id="bill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("tb.sec.title")}>
          {t("tb.sec.dek")}
        </SectionHead>

        <MuniPicker municipalities={b.municipalities} value={muni.code} onChange={setMuniCode} />
        <SchoolPicker options={bill.schoolOptions} value={bill.school.code} onChange={setSchool} where={bill.where} />

        <HomeValueCalc id="homeval-all" label={t("tb.homeLabel")} outLabel={t("tb.estOut")}
          outValue={usd(Math.round((homeValue / 1000) * total))} value={homeValue} onChange={setHomeValue} />

        <TaxSplit rows={splitRows} total={total} homeValue={homeValue}
          totalLabel={t("tb.totalRow")} exploreLabel={t("tb.explore")}
          onDrill={(id) => chrome.onSelect(id)} />
        <p className="note">{t("tb.note", year, total.toFixed(2), bill.where)}</p>
        {bill.collegeAveraged && <p className="note">{t("tb.collegeAveraged", bill.where)}</p>}
      </section>

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> {t("tb.foot.source", year)}</p>
        <p className="muted">{t("tb.foot.builtBy")}</p>
      </footer>
    </div>
  );
}
