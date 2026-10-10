import React, { useMemo, useState } from "react";
import { useStrings } from "../i18n";
import { usd } from "../format";
import { track } from "../analytics";
import { muniSlug } from "../taxmath";
import {
  SponsorSlot, SourceLink, SectionHead, HomeValueCalc, TaxSplit, MuniPicker, SchoolPicker, billRates, billExtremes, placeLabel,
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
// Share this municipality's own page (/tax/<slug>/): its card names the
// place and what a $200,000 home pays there. Never the reader's home value.
function ShareTown({ muni, where }) {
  const t = useStrings();
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${import.meta.env.BASE_URL}tax/${muniSlug(muni)}/`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${where} — Follow the Money`, url });
        track("Share", { view: "your-tax-bill", method: "native", town: where });
      } else {
        await navigator.clipboard.writeText(url);
        track("Share", { view: "your-tax-bill", method: "copy", town: where });
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch (e) { /* dismissed, or the clipboard was blocked */ }
  };
  return (
    <button type="button" className="table-toggle share-town" onClick={share}>
      {copied ? t("tb.shareCopied") : t("tb.shareTown", where)}
    </button>
  );
}

// "Same home, different bill": every municipality's bill on the reader's own
// home value, ranked dearest first. A municipality spanning several school
// districts is ranked by its largest district (the thin line under its bar is
// the range across them) — except the reader's own, which shows the district
// they chose. Collapsed: the five dearest, the five cheapest, and the reader's.
// A row is a button: it opens that municipality's bill above.
const RANK_EDGE = 5;
function Ranking({ municipalities, muni, school, homeValue, onPick }) {
  const t = useStrings();
  const [all, setAll] = useState(false);
  const rows = useMemo(() => municipalities.map((m) => {
    const rates = m.school_districts.map((sd) => billRates(m, sd.code).total);
    const rate = m.code === muni.code ? billRates(m, school).total : rates[0];
    return { m, rate, min: Math.min(...rates), max: Math.max(...rates) };
  }).sort((a, c) => c.rate - a.rate), [municipalities, muni.code, school]);
  const { lo, hi } = useMemo(() => billExtremes(municipalities), [municipalities]);
  const top = Math.max(...rows.map((r) => r.max));
  const dollars = (rate) => usd(Math.round((homeValue / 1000) * rate));
  const mine = rows.findIndex((r) => r.m.code === muni.code);
  const shown = all ? rows.map((r, i) => i)
    : [...new Set([...rows.keys()].filter((i) => i < RANK_EDGE || i >= rows.length - RANK_EDGE).concat(mine))].sort((a, c) => a - c);
  return (
    <section id="compare" className="block">
      <SectionHead kicker={t("tb.cmp.kick")} title={t("tb.cmp.title")}>
        {t("tb.cmp.dek", usd(homeValue), rows.length)}
      </SectionHead>
      <p className="rank-lede">{t("tb.cmp.range", dollars(lo.rate), placeLabel(t, lo), dollars(hi.rate), placeLabel(t, hi), dollars(hi.rate - lo.rate))}</p>
      <ol className="rank-list">
        {shown.map((i, k) => {
          const r = rows[i];
          const on = i === mine;
          const gap = k > 0 && i - shown[k - 1] > 1;
          return (
            <React.Fragment key={r.m.code}>
              {gap && <li className="rank-gap" aria-hidden="true">⋯</li>}
              <li className={"rank-row" + (on ? " on" : "")}>
                <button type="button" aria-current={on || undefined} onClick={() => {
                  track("Municipality", { name: `${r.m.type} of ${r.m.name}`, via: "ranking" });
                  onPick(r.m.code);
                }}>
                  <span className="rank-n">{i + 1}</span>
                  <span className="rank-name">{r.m.type} of {r.m.name}{r.m.split_county ? " " + t("tb.splitPart") : ""}
                    {on && <em className="rank-yours">{t("tb.cmp.yours")}</em>}</span>
                  <span className="rank-bar" aria-hidden="true">
                    <i style={{ width: (r.rate / top) * 100 + "%" }} />
                    {r.max > r.min && <s style={{ left: (r.min / top) * 100 + "%", width: ((r.max - r.min) / top) * 100 + "%" }} />}
                  </span>
                  <span className="rank-val">{dollars(r.rate)}</span>
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      <button type="button" className="table-toggle" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? t("tb.cmp.showFewer") : t("tb.cmp.showAll", rows.length)}
      </button>
      <p className="note">{t("tb.cmp.note")}</p>
    </section>
  );
}

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
      </header>

      {/* The tool first: where -> (school) -> value -> the bill, split. */}
      <section id="bill" className="block tb-steps">
        <MuniPicker municipalities={b.municipalities} value={muni.code} onChange={setMuniCode} step={1} />
        <SchoolPicker options={bill.schoolOptions} value={bill.school.code} onChange={setSchool} where={bill.where} step={2} />

        <HomeValueCalc id="homeval-all" label={t("tb.homeLabel")} outLabel={t("tb.estOut")} step={bill.schoolOptions ? 3 : 2}
          outValue={usd(Math.round((homeValue / 1000) * total))} value={homeValue} onChange={setHomeValue} />

        <TaxSplit rows={splitRows} total={total} homeValue={homeValue}
          totalLabel={t("tb.totalRow")} exploreLabel={t("tb.explore")}
          onDrill={(id) => chrome.onSelect(id)} />
        <p className="note">{t("tb.note", year, total.toFixed(2), bill.where)}</p>
        {bill.collegeAveraged && <p className="note">{t("tb.collegeAveraged", bill.where)}</p>}
        <details className="tb-more">
          <summary>{t("tb.businessQ")}</summary>
          <p>{t("tb.businessA")}</p>
        </details>
        <ShareTown muni={muni} where={bill.where} />
      </section>

      <Ranking municipalities={b.municipalities} muni={muni} school={bill.school.code} homeValue={homeValue}
        onPick={(code) => {
          setMuniCode(code);
          document.getElementById("bill").scrollIntoView({ behavior: "instant", block: "start" });
        }} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> <SourceLink source={chrome.source}>{t("tb.foot.source", year)}</SourceLink></p>
        <p className="muted">{t("tb.foot.builtBy")}</p>
      </footer>
    </div>
  );
}
