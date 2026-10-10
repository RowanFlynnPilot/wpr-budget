import React, { useState, useEffect, useMemo, useRef } from "react";
import { useStrings } from "./i18n";
import { fetchData } from "./data";
import { usd } from "./format";
import { track } from "./analytics";
import entities from "./entities.json";
import { billRates, countLink, MoneyInput, useHomeValue, useMuniChoice, useSchoolChoice, JURIS_COLORS, WAUSAU_CITY_DOR } from "./ui";

// The story card (#card): "What does your home pay?" — municipality, school
// district, home value, the year's bill and its split, and a link out to the
// full tool. Built for WordPress posts, where WPR's firewall rejects any
// <script>, so the iframe can't be sized by postMessage: the card fits the same
// fixed frame height at every width (see "Embedding" in CLAUDE.md) and centers
// itself in the frame. No chrome, no charts library; the same data, formula
// and remembered choices as the Your Tax Bill view.
const TAXBILL = entities.find((e) => e.kind === "taxbill");
const FULL_TOOL = `https://rowanflynnpilot.github.io/wpr-budget/#${TAXBILL.id}`;

export default function Card() {
  const t = useStrings();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetchData(TAXBILL.data).then(setD).catch((e) => setErr(String(e.message || e)));
  }, []);
  if (err) return <div className="ftm ftm-card"><p className="load">{t("app.error")} — {err}</p></div>;
  if (!d) return <div className="ftm ftm-card"><p className="load">{t("app.loading")}</p></div>;
  return <CardBody d={d} />;
}

function CardBody({ d }) {
  const t = useStrings();
  const [homeValue, setHomeValue] = useHomeValue();
  const [muniCode, setMuniCode] = useMuniChoice();
  const muni = d.municipalities.find((m) => m.code === muniCode)
    || d.municipalities.find((m) => m.code === WAUSAU_CITY_DOR);
  const [school, setSchool] = useSchoolChoice(muni.code);
  const bill = useMemo(() => billRates(muni, school), [muni, school]);
  const rows = [...bill.rows].sort((a, c) => c.rate - a.rate);
  const dollars = (rate) => usd(Math.round((homeValue / 1000) * rate));
  const counted = useRef(false);
  const part = (r) => (r.key === "municipality" ? t("card.part." + muni.type) : t("card.part." + r.key));

  return (
    <div className="ftm ftm-card">
      <div className="card-inner">
        <div className="card-kicker">Follow the Money <span>· Wausau Pilot &amp; Review</span></div>
        <h1 className="card-title">{t("card.title")}</h1>
        <div className="card-controls">
          <label>
            <span>{t("card.where")}</span>
            <select className="muni-select" value={muni.code} onChange={(e) => {
              const m = d.municipalities.find((x) => x.code === e.target.value);
              track("Municipality", { name: `${m.type} of ${m.name}`, via: "card" });
              setMuniCode(e.target.value);
            }}>
              {["City", "Village", "Town"].map((type) => (
                <optgroup key={type} label={t("tb.group." + type)}>
                  {d.municipalities.filter((m) => m.type === type).map((m) => (
                    <option key={m.code} value={m.code}>{`${m.type} of ${m.name}`}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>{t("card.school")}</span>
            <select className="muni-select" value={bill.school.code} disabled={!bill.schoolOptions}
              onChange={(e) => setSchool(e.target.value)}>
              {muni.school_districts.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("card.value")}</span>
            <span className="card-field">$<MoneyInput value={homeValue}
              onValue={(v) => {
                if (!counted.current) { counted.current = true; track("Home value", { view: "card" }); }
                setHomeValue(v);
              }} /></span>
          </label>
        </div>
        <div className="card-result" aria-live="polite" aria-atomic="true">
          <b>{dollars(bill.total)}</b> <span>{t("card.perYear")}</span>
        </div>
        <div className="taxbar card-bar" aria-hidden="true">
          {rows.map((r, i) => (
            <div key={r.key} className="taxbar-seg" style={{ width: (r.rate / bill.total) * 100 + "%", background: JURIS_COLORS[i] }}>
              {r.rate / bill.total > 0.12 ? Math.round((r.rate / bill.total) * 100) + "%" : ""}
            </div>
          ))}
        </div>
        <ul className="card-legend">
          {rows.map((r, i) => (
            <li key={r.key}><i style={{ background: JURIS_COLORS[i] }} />{part(r)} <b>{dollars(r.rate)}</b></li>
          ))}
        </ul>
        <a className="card-cta" href={FULL_TOOL} target="_blank" rel="noopener noreferrer" onClick={countLink("full-tool")}>
          {t("card.cta", d.municipalities.length)} →
        </a>
        <div className="card-source">{t("card.source", d.meta.tax_year)}</div>
      </div>
    </div>
  );
}
