import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
  ReferenceLine, ComposedChart, BarChart, Bar, Area, Sankey, Layer,
} from "recharts";
import { ChevronDown, ArrowUpRight, ArrowDownRight, Receipt, Share2, Check, Home } from "lucide-react";
import { LANGS, LangProvider, useLang, useStrings } from "./i18n";
import annotations from "./annotations.json";
import logoUrl from "./assets/logo-32.png";
import marathonLogo from "./assets/marathon-county.jpg";
import wausauLogo from "./assets/wausau-city.jpg";
import schoolLogo from "./assets/wausau-school.jpg";

// Per-entity logos, keyed by manifest id (used in the chrome-bar switcher and
// the masthead). Square-format marks — shown whole (object-fit:contain), not
// circle-cropped. The three avatars are the same marks used in the Central
// Wisconsin Meeting Tracker, kept consistent across the WPR civic suite.
const ENTITY_LOGOS = {
  "marathon-county": marathonLogo,
  "wausau-city": wausauLogo,
  "wausau-school": schoolLogo,
};

/*
 * Follow the Money — civic budget explorer suite (Wausau Pilot & Review)
 *
 * Multi-entity: App reads public/entities.json (the manifest), then the active
 * entity's data file — marathon-county.json or wausau-city.json, produced by
 * scripts/extract_budget.py and scripts/extract_wausau.py respectively. Each
 * entity has its own body component (Ledger / CityLedger) and schema. One source
 * of truth: no inline data, no fallback; a missing file shows an error, not
 * stale or invented numbers.
 */
/* ---------- formatting ---------- */
const usd = (n) => (n < 0 ? "\u2212$" : "$") + Math.abs(n).toLocaleString("en-US");

// Build a CSV from an array of flat objects and trigger a download.
function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
const compact = (n) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M"
    : a >= 1e3 ? "$" + Math.round(a / 1e3) + "K" : "$" + a;
  return n < 0 ? "\u2212" + s : s;
};
const pct = (n) => (n > 0 ? "+" : "") + n.toFixed(1) + "%";
const deptSpend = (d) => d.operating_expenditures + d.personnel_expenditures;

/* ---------- small components ---------- */
function Delta({ value, invertColor = false, money = false, exact = false }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const up = value > 0;
  const good = invertColor ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const text = money
    ? sign + (exact ? "$" + Math.abs(value).toLocaleString("en-US") : compact(Math.abs(value)))
    : pct(value);
  return (
    <span className="delta" style={{ color: good ? "var(--neg)" : "var(--pos)" }}>
      <Icon size={13} strokeWidth={2.5} /> {text}
    </span>
  );
}

function SectionHead({ kicker, title, children }) {
  return (
    <header className="sec-head">
      <div className="kicker">{kicker}</div>
      <h2>{title}</h2>
      {children && <p className="standfirst">{children}</p>}
    </header>
  );
}

// Companion civic-transparency tool — the budgets adopted here are debated and voted
// in the meetings the tracker covers.
const MEETING_TRACKER_URL = "https://rowanflynnpilot.github.io/marathon-meetings/";

// "What changed this year" lead band — a few auto-computed highlights rendered between
// the masthead and the section nav. Each body passes its own data-appropriate items:
// { label, value, delta?, invert?, money?, exact?, note? }. delta uses <Delta>.
function Highlights({ items }) {
  const t = useStrings();
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="whatchanged">
      <div className="wc-head">{t("wc.head")}</div>
      <div className="wc-grid">
        {shown.map((it, i) => (
          <div className="wc-item" key={i}>
            <div className="wc-label">{it.label}</div>
            <div className="wc-value">{it.value}</div>
            <div className="wc-meta">
              {it.delta !== undefined && <Delta value={it.delta} invertColor={it.invert} money={it.money} exact={it.exact} />}
              {it.note && <span className="wc-note">{it.note}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Resolve editorial chart annotations for one entity+chart into the active language.
// Returns [] when none — charts render unchanged if a chart has no annotations.
function resolveNotes(chrome, lang, chartId) {
  const list = (chrome.annotations && chrome.annotations[chrome.activeId] && chrome.annotations[chrome.activeId][chartId]) || [];
  return list.map((a) => ({ x: a.x, tag: (a.tag && (a.tag[lang] || a.tag.en)) || "", note: (a.note && (a.note[lang] || a.note.en)) || "", source: a.source || null }));
}

// The text companion to the on-chart reference lines: a short list beneath the chart
// with each marker's year, plain-language note, and (when provided) a source link.
function ChartNotes({ notes }) {
  if (!notes || !notes.length) return null;
  return (
    <ul className="chart-notes">
      {notes.map((a) => (
        <li key={a.x}>
          <b>{a.x}</b> — {a.note}
          {a.source && <a className="chart-note-src" href={a.source} target="_blank" rel="noopener noreferrer" aria-label="source"> ↗</a>}
        </li>
      ))}
    </ul>
  );
}

// Shared methodology + open-data section, rendered by both entity bodies. The
// reconcile-against-printed-totals point is the core trust signal.
function Methodology({ b, chrome }) {
  const t = useStrings();
  const ent = chrome.entities.find((e) => e.id === chrome.activeId);
  const jsonUrl = import.meta.env.BASE_URL + ent.data;
  const kindNoun = t("method.kind." + ent.kind);
  const csvRows = ent.kind === "city"
    ? b.general_fund.expenditures.map((r) => ({ department: r.category, fund: "General Fund", budget_2025: r.prior, budget_2026: r.proposed }))
    : ent.kind === "school"
    ? b.funds.map((f) => ({ fund_no: f.fund_no, fund: f.name, revenues: f.revenues, expenditures: f.expenditures, prior_expenditures: f.prior_expenditures }))
    : b.departments.map((d) => ({ department: d.department, tax_levy: d.tax_levy, operating_revenues: d.operating_revenues, operating_expenditures: d.operating_expenditures, personnel_expenditures: d.personnel_expenditures }));
  return (
    <section id="methodology" className="block">
      <SectionHead kicker={t("method.kicker")} title={t("method.title")}>
        {t("method.intro", b.meta.entity, b.meta.budget_year, kindNoun)}
      </SectionHead>
      <ol className="method">
        <li><b>{t("method.step.sourceLabel")}</b> {t("method.step.source", b.meta.budget_year, b.meta.entity)}</li>
        <li><b>{t("method.step.extractionLabel")}</b> {t("method.step.extraction")}</li>
        <li><b>{t("method.step.verificationLabel")}</b> {t("method.step.verification")}</li>
        <li><b>{t("method.step.updatesLabel")}</b> {t("method.step.updates")}</li>
      </ol>
      <div className="downloads">
        <a className="dl-btn" href={jsonUrl} download>{t("method.dlJson")}</a>
        <button type="button" className="dl-btn" onClick={() => downloadCSV(`${ent.id}-${b.meta.budget_year}-spending.csv`, csvRows)}>
          {t("method.dlCsv")}
        </button>
      </div>
      <p className="note">{t("method.reuse")}</p>
      <a className="suite-link" href={MEETING_TRACKER_URL} target="_blank" rel="noopener noreferrer">
        <span className="suite-link__icon" aria-hidden="true">📋</span>
        <span><b>{t("suite.linkLead")}</b> {t("suite.linkBody")}</span>
        <ArrowUpRight size={16} strokeWidth={2.5} className="suite-link__arrow" />
      </a>
    </section>
  );
}

// Suite landing page — the front door. Fetches every entity's data once, shows a
// hero, the combined "your whole tax bill" hook, a card per entity (logo, headline
// figure, blurb), and the open-data/credibility strip. Picking a card drills into
// that body; the chrome's Home button returns here. Rendered when no entity hash is
// set (bare URL / "#home"), so direct links like #marathon-county still skip it.
function Landing({ entities, chrome }) {
  const t = useStrings();
  const [byFile, setByFile] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const files = [...new Set(entities.map((e) => e.data))];
    Promise.all(files.map((f) =>
      fetch(import.meta.env.BASE_URL + f)
        .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then((j) => [f, j])))
      .then((pairs) => setByFile(Object.fromEntries(pairs)))
      .catch((e) => setErr(String(e.message || e)));
  }, [entities]);

  if (err) return (<div className="ftm load"><style>{CSS}</style><p>Could not load budget data &mdash; {err}</p></div>);
  if (!byFile) return (<div className="ftm load"><style>{CSS}</style><p>Loading the ledger&hellip;</p></div>);

  const year = byFile[entities[0].data].meta.budget_year;
  // Headline figure per card, straight from each entity's reconciled data.
  const headline = (e) => {
    const p = byFile[e.data];
    if (e.kind === "school") return { value: compact(p.meta.net_expenditures), label: t("lp.card.budget") };
    if (e.kind === "taxbill") {
      const ry = p.tax_by_jurisdiction.rate_years[0];
      return { value: usd(Math.round(200 * p.tax_by_jurisdiction.total[ry])), label: t("lp.card.typicalBill") };
    }
    return { value: compact(p.meta.total_expenditures), label: t("lp.card.budget") };
  };
  const cityP = entities.find((e) => e.kind === "city");
  const cj = cityP && byFile[cityP.data].tax_by_jurisdiction;
  const combinedBill = cj ? usd(Math.round(200 * cj.total[cj.rate_years[0]])) : null;

  return (
    <div className="ftm">
      <style>{CSS}</style>
      <ChromeBar {...chrome} year={year} />

      <header className="masthead lp-hero">
        <div className="kicker-row"><span className="pub">{t("common.publicLedger")}</span></div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("lp.heroDek")}</p>
      </header>

      {combinedBill && (
        <button type="button" className="lp-hook" onClick={() => chrome.onSelect("your-tax-bill")}>
          <span>{t("lp.combined", combinedBill)}</span>
          <span className="lp-hook-cta">{t("lp.seeBreakdown")} <ArrowUpRight size={15} strokeWidth={2.5} /></span>
        </button>
      )}

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
              <p className="lp-card-desc">{t("lp.desc." + e.kind)}</p>
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

/* ---------- main ---------- */
// "Follow the Money" is a multi-entity suite. App loads the entity manifest,
// picks the active entity (from the URL hash, else the first), fetches its data
// file, and routes to the body for that entity's kind. The body components own
// all the section logic; App owns only entity selection + the shared chrome.
export default function App() {
  const [entities, setEntities] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "entities.json")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((list) => {
        setEntities(list);
        // A specific entity hash deep-links to that body; anything else (bare URL,
        // "#home", unknown) lands on the suite overview (activeId === null).
        const fromHash = list.find((e) => e.id === window.location.hash.slice(1));
        setActiveId(fromHash ? fromHash.id : null);
      })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!entities || !activeId) return;
    const ent = entities.find((e) => e.id === activeId);
    fetch(import.meta.env.BASE_URL + ent.data)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((payload) => setData({ id: activeId, payload }))
      .catch((e) => setErr(String(e.message || e)));
  }, [entities, activeId]);

  // null id => the suite overview (the landing page).
  const onSelect = (id) => { window.location.hash = id || "home"; setActiveId(id || null); };

  if (err) return (<div className="ftm load"><style>{CSS}</style><p>Could not load budget data &mdash; {err}</p></div>);
  if (!entities) return (<div className="ftm load"><style>{CSS}</style><p>Loading the ledger&hellip;</p></div>);

  const chrome = { entities, activeId, onSelect, annotations };
  // No entity selected → the suite landing page.
  if (!activeId) return <LangProvider><Landing entities={entities} chrome={chrome} /></LangProvider>;

  // Gate on data.id === activeId so we never render a body with the previous
  // entity's data during a switch (the bodies assume their own entity's schema).
  if (!data || data.id !== activeId)
    return (<div className="ftm load"><style>{CSS}</style><p>Loading the ledger&hellip;</p></div>);

  const ent = entities.find((e) => e.id === activeId);
  const Body = ent.kind === "city" ? CityLedger
    : ent.kind === "school" ? SchoolLedger
    : ent.kind === "taxbill" ? TaxBillOverview
    : Ledger;
  return <LangProvider><Body key={activeId} b={data.payload} chrome={chrome} /></LangProvider>;
}

// Shared WPR brand chrome bar, with the entity switcher (rendered only when the
// suite has more than one entity) and a share control.
function ChromeBar({ entities, activeId, onSelect, year }) {
  const active = entities.find((e) => e.id === activeId);
  const [shared, setShared] = useState(false);
  const t = useStrings();
  const { lang, setLang } = useLang();

  // Share a canonical deep-link to the ACTIVE entity, built from activeId rather
  // than location.href so it stays valid no matter what the in-page scroll has
  // done to the hash. No personal data (e.g. the tax-bill home value) is included.
  const onShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${activeId || "home"}`;
    const title = `Follow the Money${active ? " — " + active.name : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 1800);
      }
    } catch (e) { /* user dismissed the share sheet, or clipboard was blocked */ }
  };

  return (
    <>
      <div className="chrome-bar">
        <div className="chrome-bar__left">
          <a className="chrome-bar__brand" href="https://wausaupilotandreview.com"
             target="_blank" rel="noopener noreferrer">
            <img className="chrome-bar__logo-img" src={logoUrl} alt="Wausau Pilot &amp; Review" />
            <span className="chrome-bar__wordmark">Wausau Pilot &amp; Review</span>
          </a>
          {activeId && (
            <button type="button" className="chrome-bar__home" onClick={() => onSelect(null)}>
              <Home size={14} strokeWidth={2.5} aria-hidden="true" />
              <span>{t("lp.home")}</span>
            </button>
          )}
        </div>
        <div className="chrome-bar__right">
          <select className="chrome-bar__lang" value={lang} aria-label={t("chrome.language")}
            onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button type="button" className="chrome-bar__share" onClick={onShare}
            aria-label={shared ? t("chrome.copiedAria") : t("chrome.shareAria")}>
            {shared ? <Check size={14} strokeWidth={2.5} /> : <Share2 size={14} strokeWidth={2.5} />}
            <span>{shared ? t("chrome.copied") : t("chrome.share")}</span>
          </button>
          {year && <span className="chrome-bar__meta">{t("chrome.fyMeta", year)}</span>}
        </div>
        {entities.length > 1 && (
          <span className="chrome-bar__switch" role="tablist" aria-label={t("chrome.chooseBudget")}>
            {entities.map((e) => (
              <button key={e.id} type="button" role="tab" aria-selected={e.id === activeId}
                className={"chrome-bar__ent" + (e.id === activeId ? " on" : "")}
                onClick={() => onSelect(e.id)}>
                {e.kind === "taxbill"
                  ? <Receipt className="chrome-bar__ent-icon" size={18} strokeWidth={2} aria-hidden="true" />
                  : <img src={ENTITY_LOGOS[e.id]} alt="" />}
                <span>{e.kind === "taxbill" ? t("common.yourTaxBill") : e.short}</span>
              </button>
            ))}
          </span>
        )}
      </div>
      {lang === "hmn" && (
        <div className="beta-banner" role="note">
          <b>{t("beta.title")}</b> <span>{t("beta.body")}</span>
        </div>
      )}
    </>
  );
}

// Jurisdiction colors for the "your tax bill" split (City / school / county /
// college), sorted by rate descending: accent, gold, rust, slate.
const JURIS_COLORS = ["#16584a", "#9a7b2e", "#a8492f", "#3d5a80"];
// Shorter labels for the Sankey (the full names are too long to fit beside nodes).
const SANKEY_SHORT = {
  "Intergovernmental Grants and Aids": "Intergovernmental",
  "City County Information Technology": "Info Technology",
  "Public Charges for Services": "Public Charges",
  "Intergovernmental Charges for Services": "Intergov. Charges",
  "Other Financing Sources": "Other Financing",
};
const shortName = (n) => SANKEY_SHORT[n] || n;

// Cross-entity overview: a City of Wausau homeowner's COMPLETE local property-tax
// bill, split across every taxing jurisdiction (city, county, school, technical
// college), each row clickable through to its entity. Sourced from the City book's
// tax_by_jurisdiction table — all jurisdictions, one year, reconciled to the total
// — so it's the real breakdown of one bill, not four numbers stitched together.
// Maps a jurisdiction name to its suite entity id for the drill-down.
function billEntityFor(name) {
  const n = name.toLowerCase();
  if (n.includes("city of wausau")) return "wausau-city";
  if (n.includes("marathon county")) return "marathon-county";
  if (n.includes("school")) return "wausau-school";
  return null; // e.g. NC Technical College — not its own entity in the suite
}

function TaxBillOverview({ b, chrome }) {
  const t = useStrings();
  const [homeValue, setHomeValue] = useState(200000);
  const [taxTip, setTaxTip] = useState(null);
  const taxbarRef = useRef(null);

  const j = b.tax_by_jurisdiction;
  const ry = j.rate_years[0];
  const jrows = useMemo(() => [...j.rows].sort((a, c) => c.rates[ry] - a.rates[ry]), [j.rows, ry]);
  const jtotal = j.total[ry];
  const bill = Math.round((homeValue / 1000) * jtotal);
  const top = jrows[0];
  const inSuite = (id) => id && chrome.entities.some((e) => e.id === id);
  const drill = (id) => { if (inSuite(id)) chrome.onSelect(id); };

  return (
    <div className="ftm">
      <style>{CSS}</style>
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">{t("common.publicLedger")}</span>
            <span className="dot">·</span>
            <span>{t("common.yourTaxBill")}</span>
          </div>
        </div>
        <h1>{t("tb.h1")}</h1>
        <p className="dek">{t("tb.dek")}</p>
        <div className="stat-strip">
          <Stat icon="🧾" label={t("tb.stat.combinedRate")} value={"$" + jtotal.toFixed(2)} sub={t("tb.stat.combinedRateSub", ry)} />
          <Stat icon="🏛️" label={t("tb.stat.govts")} value={String(jrows.length)} sub={t("tb.stat.govtsSub")} />
          <Stat icon="🏠" label={t("tb.stat.largest")} value={Math.round((top.rates[ry] / jtotal) * 100) + "%"} sub={top.jurisdiction.replace(/\s*\(net\)/i, "")} />
        </div>
      </header>

      <section id="bill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("tb.sec.title")}>
          {t("tb.sec.dek")}
        </SectionHead>

        <div className="calc">
          <div className="calc-input">
            <label htmlFor="homeval-all">{t("tb.homeLabel")}</label>
            <div className="calc-field">
              <span>$</span>
              <input id="homeval-all" type="text" inputMode="numeric" value={homeValue.toLocaleString("en-US")}
                onChange={(e) => setHomeValue(Math.min(parseInt(e.target.value.replace(/[^\d]/g, "")) || 0, 99999999))} />
            </div>
          </div>
          <div className="calc-out">
            <span className="calc-out-label">{t("tb.estOut")}</span>
            <span className="calc-out-val">{usd(bill)}</span>
          </div>
        </div>

        <div className="taxbar" ref={taxbarRef} onMouseLeave={() => setTaxTip(null)}>
          {jrows.map((r, i) => {
            const share = (r.rates[ry] / jtotal) * 100;
            return (
              <div className="taxbar-seg" key={r.jurisdiction}
                style={{ width: share + "%", background: JURIS_COLORS[i % JURIS_COLORS.length] }}
                onMouseMove={(e) => {
                  const rect = taxbarRef.current.getBoundingClientRect();
                  setTaxTip({ i, x: e.clientX - rect.left, w: rect.width });
                }}>
                {share > 9 ? Math.round(share) + "%" : ""}
              </div>
            );
          })}
          {taxTip && (() => {
            const r = jrows[taxTip.i];
            const share = (r.rates[ry] / jtotal) * 100;
            return (
              <div className="taxbar-tip" style={{ left: Math.max(90, Math.min(taxTip.x, taxTip.w - 90)) }}>
                <div className="tip-year">{r.jurisdiction}</div>
                <div>{usd(Math.round((homeValue / 1000) * r.rates[ry]))} &middot; {share.toFixed(1)}% &middot; ${r.rates[ry].toFixed(2)}/$1k</div>
              </div>
            );
          })()}
        </div>

        <div className="jrows">
          {jrows.map((r, i) => {
            const id = billEntityFor(r.jurisdiction);
            const go = inSuite(id);
            return (
              <div key={r.jurisdiction} className={"jrow" + (go ? " go" : "")}
                {...(go ? {
                  role: "button", tabIndex: 0, onClick: () => drill(id),
                  onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); drill(id); } },
                } : {})}>
                <span className="jrow-sw" style={{ background: JURIS_COLORS[i % JURIS_COLORS.length] }} />
                <span className="jrow-name">
                  {r.jurisdiction}
                  {go && <span className="jrow-go">{t("tb.explore")} <ArrowUpRight size={12} strokeWidth={2.5} /></span>}
                </span>
                <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * r.rates[ry]))}</span>
                <span className="jrow-share">{((r.rates[ry] / jtotal) * 100).toFixed(0)}%</span>
              </div>
            );
          })}
          <div className="jrow total">
            <span className="jrow-sw" />
            <span className="jrow-name">{t("tb.totalRow")}</span>
            <span className="jrow-amt">{usd(bill)}</span>
            <span className="jrow-share">100%</span>
          </div>
        </div>
        <p className="note">{t("tb.note", ry, jtotal.toFixed(2))}</p>
      </section>

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> {t("tb.foot.source", ry)}</p>
        <p className="muted">{t("tb.foot.builtBy")}</p>
      </footer>
    </div>
  );
}

// City of Wausau body. A municipality is fund-based with no per-department levy,
// so the sections differ from the County's: spending by GF department and by
// all-funds category, the levy over time, the property-tax-by-jurisdiction
// split, and debt — all from the City's own validated schema.
function CityLedger({ b, chrome }) {
  const t = useStrings();
  const [gfFlow, setGfFlow] = useState("departments");
  const [active, setActive] = useState("where");
  const [wfDept, setWfDept] = useState(
    () => [...b.personnel.rows].sort((a, c) => c.fte[0] - a.fte[0])[0].department
  );
  const [taxTip, setTaxTip] = useState(null);
  const taxbarRef = useRef(null);
  const [homeValue, setHomeValue] = useState(200000);

  // Both tabs (departments / revenue) sorted by amount, largest first.
  const gfRows = useMemo(() => {
    const rows = gfFlow === "departments" ? b.general_fund.expenditures : b.general_fund.revenues;
    return [...rows].sort((a, c) => c.proposed - a.proposed);
  }, [gfFlow, b.general_fund]);
  const gfTotal = useMemo(() => gfRows.reduce((s, r) => s + r.proposed, 0), [gfRows]);
  const gfMax = useMemo(() => Math.max(...gfRows.map((r) => r.proposed)), [gfRows]);

  const cats = useMemo(() => [...b.expenditure_categories].sort((a, c) => c.current - a.current), [b.expenditure_categories]);
  const catMax = useMemo(() => Math.max(...cats.map((c) => c.current)), [cats]);

  // General Fund money flow: revenue sources -> General Fund -> departments. Keep
  // the largest few of each; group the rest so the diagram stays readable.
  const sankey = useMemo(() => {
    const TOP = 5;
    const group = (rows) => {
      const sorted = [...rows].sort((a, c) => c.proposed - a.proposed);
      const main = sorted.slice(0, TOP);
      const other = sorted.slice(TOP).reduce((s, r) => s + r.proposed, 0);
      return { main, other };
    };
    const rev = group(b.general_fund.revenues);
    const exp = group(b.general_fund.expenditures);
    const nodes = [];
    const id = (name, col) => { nodes.push({ name, col }); return nodes.length - 1; };
    const revIds = rev.main.map((r) => ({ i: id(shortName(r.category), 0), v: r.proposed }));
    if (rev.other > 0) revIds.push({ i: id("Other revenue", 0), v: rev.other });
    const gf = id("General Fund", 1);
    const expIds = exp.main.map((r) => ({ i: id(shortName(r.category), 2), v: r.proposed }));
    if (exp.other > 0) expIds.push({ i: id("Other departments", 2), v: exp.other });
    const links = [
      ...revIds.map((r) => ({ source: r.i, target: gf, value: r.v })),
      ...expIds.map((r) => ({ source: gf, target: r.i, value: r.v })),
    ];
    return { nodes, links };
  }, [b.general_fund]);

  const levy = b.levy_history;
  const levyFirst = levy[0], levyLast = levy[levy.length - 1];
  const levyPct = (levyLast.levy / levy[levy.length - 2].levy - 1) * 100;

  const j = b.tax_by_jurisdiction;
  const ry = j.rate_years[0];
  const jrows = useMemo(() => [...j.rows].sort((a, c) => c.rates[ry] - a.rates[ry]), [j.rows, ry]);
  const jtotal = j.total[ry];
  const cityShare = Math.round((jrows[0].rates[ry] / jtotal) * 100);

  const debt = b.debt;

  // Workforce: one department at a time. Departments sorted by current FTE for
  // the picker; the selected department's FTE becomes a year-ascending series
  // (the source arrays are newest-first).
  const wf = b.personnel;
  const wfDepts = useMemo(() => [...wf.rows].sort((a, c) => c.fte[0] - a.fte[0]), [wf.rows]);
  const wfSel = wf.rows.find((r) => r.department === wfDept) || wfDepts[0];
  const wfSeries = useMemo(() => wf.years.map((_, i) => {
    const idx = wf.years.length - 1 - i; // ascending position -> newest-first index
    return { year: wf.years[idx], fte: wfSel.fte[idx] ?? null };
  }), [wfSel, wf.years]);
  const wfNow = wfSel.fte[0];
  const wfThen = wfSel.fte[wfSel.fte.length - 1];
  const wfChange = wfNow - wfThen;

  const tif = b.tif;
  const tifGrowth = useMemo(() => [...tif.valuation_growth].sort((a, c) => c.growth - a.growth), [tif.valuation_growth]);
  const tifMaxGrowth = Math.max(...tifGrowth.map((g) => g.growth));

  const changed = useMemo(() => {
    const cur = b.expenditure_categories.reduce((s, c) => s + c.current, 0);
    const prior = b.expenditure_categories.reduce((s, c) => s + c.prior, 0);
    const mover = [...b.expenditure_categories].sort((a, c) => (c.current - c.prior) - (a.current - a.prior))[0];
    return [
      { label: t("wc.cityLevy"), value: usd(b.meta.tax_levy), delta: levyPct },
      { label: t("wc.totalBudgetAllFunds"), value: compact(b.meta.total_expenditures), delta: (cur / prior - 1) * 100 },
      { label: t("wc.fastestGrowing"), value: mover.category, note: "+" + compact(mover.current - mover.prior) },
    ];
  }, [t, b.expenditure_categories, b.meta, levyPct]);

  const sections = [
    ["where", "Where It Goes"],
    ["flow", "Money Flow"],
    ["allfunds", "All Funds"],
    ["overtime", "Over Time"],
    ["workforce", "Workforce"],
    ["taxbill", "Your Tax Bill"],
    ["development", "Development"],
    ["debt", "Debt"],
    ["methodology", "Methodology"],
  ];

  useEffect(() => {
    const els = sections.map(([id]) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="ftm">
      <style>{CSS}</style>
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">The Public Ledger</span>
            <span className="dot">·</span>
            <span>{b.meta.entity}</span>
          </div>
          {ENTITY_LOGOS[chrome.activeId] && (
            <img className="masthead-logo" src={ENTITY_LOGOS[chrome.activeId]} alt={b.meta.entity} />
          )}
        </div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("c.dek", b.meta.entity)}</p>
        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.total_expenditures)} sub={t("c.stat.allFunds")} />
          <Stat icon="🏛️" label={t("c.stat.cityLevy")} value={usd(b.meta.tax_levy)} sub={<Delta value={levyPct} />} />
          <Stat icon="🏠" label={t("c.stat.cityShare")} value={cityShare + "%"} sub={t("c.stat.cityShareSub", jtotal.toFixed(2))} />
        </div>
      </header>

      <Highlights items={changed} />

      <nav className="subnav">
        {sections.map(([id, label]) => (
          <a key={id} href={"#" + id} className={active === id ? "active" : ""}>{t("nav." + id)}</a>
        ))}
      </nav>

      {/* WHERE IT GOES — General Fund */}
      <section id="where" className="block">
        <SectionHead kicker={t("kick.generalFund")} title={t("title.whereDollarGoes")}>
          {t("c.where.dek", compact(b.meta.gf_expenditures))}
        </SectionHead>
        <div className="toggle" role="group" aria-label="General fund view">
          <button aria-pressed={gfFlow === "departments"} className={gfFlow === "departments" ? "on" : ""} onClick={() => setGfFlow("departments")}>{t("btn.byDepartment")}</button>
          <button aria-pressed={gfFlow === "revenues"} className={gfFlow === "revenues" ? "on" : ""} onClick={() => setGfFlow("revenues")}>{t("btn.revenue")}</button>
        </div>
        <div className="bars">
          {gfRows.map((r, i) => (
            <div className="bar-row no-spark" key={r.category} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="bar-label">{r.category}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.proposed / gfMax) * 100}%` }} /></div>
              <div className="bar-val">{compact(r.proposed)}</div>
              <div className="bar-share">{((r.proposed / gfTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={r.pct_change} invertColor={gfFlow === "departments"} /></div>
            </div>
          ))}
        </div>
        <p className="note">{gfFlow === "departments" ? t("c.where.noteDept") : t("c.where.noteRev")}</p>
      </section>

      {/* MONEY FLOW — General Fund Sankey */}
      <section id="flow" className="block">
        <SectionHead kicker={t("kick.followMoney")} title={t("title.howGfFlows")}>
          {t("c.flow.dek")}
        </SectionHead>
        <div className="chart-wrap">
          <div className="sankey-scroll">
            <div className="sankey-inner" role="img"
              aria-label={`Money-flow diagram: General Fund revenue sources flowing into the ${compact(b.meta.gf_expenditures)} general fund and out to departments. Largest department: ${sankey.nodes.find((n) => n.col === 2)?.name}.`}>
              <ResponsiveContainer width="100%" height={440}>
                <Sankey data={sankey} nodePadding={28} nodeWidth={12} iterations={64}
                  node={<SankeyNode />} link={{ stroke: "#16584a", strokeOpacity: 0.2 }}
                  margin={{ top: 24, right: 162, bottom: 24, left: 178 }}>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const p = (payload[0].payload && payload[0].payload.payload) || payload[0].payload || {};
                    const isLink = p.source && p.target && typeof p.source === "object";
                    return (
                      <div className="tip">
                        <div className="tip-year">{isLink ? `${p.source.name} → ${p.target.name}` : p.name}</div>
                        <div>{usd(p.value)}</div>
                      </div>
                    );
                  }} />
                </Sankey>
              </ResponsiveContainer>
            </div>
          </div>
          <p className="note">{t("c.flow.note")}</p>
        </div>
      </section>

      {/* ALL FUNDS — by category */}
      <section id="allfunds" className="block">
        <SectionHead kicker={t("kick.wholePicture")} title={t("c.allfunds.title")}>
          {t("c.allfunds.dek", compact(b.meta.total_expenditures))}
        </SectionHead>
        <div className="bars">
          {cats.map((c, i) => (
            <div className="bar-row no-spark" key={c.category} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="bar-label">{c.category}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.current / catMax) * 100}%` }} /></div>
              <div className="bar-val">{compact(c.current)}</div>
              <div className="bar-share">{((c.current / b.meta.total_expenditures) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={(c.current / c.prior - 1) * 100} invertColor /></div>
            </div>
          ))}
        </div>
        <p className="note">{t("c.allfunds.note")}</p>
      </section>

      {/* OVER TIME — levy */}
      <section id="overtime" className="block">
        <SectionHead kicker={t("kick.shiftingPriorities")} title={t("c.overtime.title")}>
          {t("c.overtime.dek", usd(levyFirst.levy), levyFirst.year, usd(levyLast.levy), levyLast.year, (((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0))}
        </SectionHead>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={levy} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--gold)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
              <Tooltip content={<BarTip seriesName="Tax levy" />} cursor={{ fill: "var(--paper-2)" }} />
              <Bar dataKey="levy" fill="var(--gold)" fillOpacity={0.82} radius={[2, 2, 0, 0]} maxBarSize={38} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="note">{t("c.overtime.note", levyFirst.year, levyLast.year)}</p>
        </div>

        <div className="callout">
          <div className="callout-title">{t("c.overtime.calloutTitle")}</div>
          <p>{t("c.overtime.calloutBody", usd(levyLast.exception), levyLast.year)}</p>
        </div>
      </section>

      {/* WORKFORCE — FTE over time, one department at a time */}
      <section id="workforce" className="block">
        <SectionHead kicker={t("c.workforce.kick")} title={t("c.workforce.title")}>
          {t("c.workforce.dek", wf.total[0], wf.total[wf.total.length - 1], b.meta.budget_year)}
        </SectionHead>
        <div className="wf-pick" role="group" aria-label="Choose a department">
          {wfDepts.map((d) => (
            <button key={d.department} type="button" aria-pressed={d.department === wfDept}
              className={"wf-chip" + (d.department === wfDept ? " on" : "")}
              onClick={() => setWfDept(d.department)}>{d.department}</button>
          ))}
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={wfSeries} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={34} />
              <Tooltip content={<WorkforceTip />} cursor={{ stroke: "var(--rule)" }} />
              <Area type="monotone" dataKey="fte" name={wfDept} stroke="var(--accent)" strokeWidth={2.5}
                fill="var(--accent)" fillOpacity={0.12} dot={{ r: 2.5, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="note">{t("c.workforce.note", wfDept, wfNow, b.meta.budget_year, wfChange, wf.years[wf.years.length - 1])}</p>
        </div>
      </section>

      {/* YOUR TAX BILL — interactive jurisdiction calculator */}
      <section id="taxbill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("title.taxbillMeaning")}>
          {t("c.taxbill.dek", cityShare)}
        </SectionHead>

        <div className="calc">
          <div className="calc-input">
            <label htmlFor="homeval">{t("c.taxbill.homeLabel")}</label>
            <div className="calc-field">
              <span>$</span>
              <input id="homeval" type="text" inputMode="numeric" value={homeValue.toLocaleString("en-US")}
                onChange={(e) => setHomeValue(Math.min(parseInt(e.target.value.replace(/[^\d]/g, "")) || 0, 99999999))} />
            </div>
          </div>
          <div className="calc-out">
            <span className="calc-out-label">{t("calc.estProperty")}</span>
            <span className="calc-out-val">{usd(Math.round((homeValue / 1000) * jtotal))}</span>
          </div>
        </div>

        <div className="taxbar" ref={taxbarRef} onMouseLeave={() => setTaxTip(null)}>
          {jrows.map((r, i) => {
            const share = (r.rates[ry] / jtotal) * 100;
            return (
              <div className="taxbar-seg" key={r.jurisdiction}
                style={{ width: share + "%", background: JURIS_COLORS[i % JURIS_COLORS.length] }}
                onMouseMove={(e) => {
                  const rect = taxbarRef.current.getBoundingClientRect();
                  setTaxTip({ i, x: e.clientX - rect.left, w: rect.width });
                }}>
                {share > 9 ? Math.round(share) + "%" : ""}
              </div>
            );
          })}
          {taxTip && (() => {
            const r = jrows[taxTip.i];
            const share = (r.rates[ry] / jtotal) * 100;
            return (
              <div className="taxbar-tip" style={{ left: Math.max(90, Math.min(taxTip.x, taxTip.w - 90)) }}>
                <div className="tip-year">{r.jurisdiction}</div>
                <div>{usd(Math.round((homeValue / 1000) * r.rates[ry]))} &middot; {share.toFixed(1)}% &middot; ${r.rates[ry].toFixed(2)}/$1k</div>
              </div>
            );
          })()}
        </div>
        <div className="jrows">
          {jrows.map((r, i) => (
            <div className="jrow" key={r.jurisdiction}>
              <span className="jrow-sw" style={{ background: JURIS_COLORS[i % JURIS_COLORS.length] }} />
              <span className="jrow-name">{r.jurisdiction}</span>
              <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * r.rates[ry]))}</span>
              <span className="jrow-share">{((r.rates[ry] / jtotal) * 100).toFixed(0)}%</span>
            </div>
          ))}
          <div className="jrow total">
            <span className="jrow-sw" />
            <span className="jrow-name">{t("c.taxbill.totalRow")}</span>
            <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * jtotal))}</span>
            <span className="jrow-share">100%</span>
          </div>
        </div>
        <p className="note">{t("c.taxbill.note", ry, jtotal.toFixed(2))}</p>
      </section>

      {/* DEVELOPMENT — tax increment districts */}
      <section id="development" className="block">
        <SectionHead kicker={t("c.dev.kick")} title={t("c.dev.title")}>
          {t("c.dev.dek", tifGrowth.length)}
        </SectionHead>
        <div className="gbars">
          {tifGrowth.map((g) => (
            <div className="gbar" key={g.tid}>
              <span className="gbar-name">District {g.tid}</span>
              <span className="gbar-track"><i style={{ width: `${(g.growth / tifMaxGrowth) * 100}%` }} /></span>
              <span className="gbar-val">+{g.growth.toFixed(2)}%</span>
            </div>
          ))}
        </div>
        {tif.developer_payments.length > 0 && (
          <div className="tif-pays">
            {tif.developer_payments.map((p) => (
              <div className="tif-pay" key={p.tid}>
                <b>District {p.tid}</b> &middot; {compact(p.amount)} <span>{p.note}</span>
              </div>
            ))}
          </div>
        )}
        <p className="note">
          {t("c.dev.note", usd(tif.levy_decrease))}
        </p>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker={t("c.debt.kick")} title={t("title.outstandingDebt")}>
          {t("c.debt.dek", compact(debt.outstanding), debt.pct_of_limit)}
        </SectionHead>
        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-new" /> {t("lbl.principal")}</span>
            <span><i className="sw sw-old" /> {t("lbl.interest")}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={debt.retirement} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
              <Tooltip content={<BarTip />} cursor={{ fill: "var(--paper-2)" }} />
              <Bar dataKey="principal" stackId="d" fill="var(--accent)" name={t("lbl.principal")} maxBarSize={26} />
              <Bar dataKey="interest" stackId="d" fill="var(--gold)" fillOpacity={0.82} name={t("lbl.interest")} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
          <p className="note">{t("c.debt.note", debt.retirement[0].year, compact(debt.retirement[0].total), debt.retirement[debt.retirement.length - 1].year)}</p>
        </div>
      </section>

      <Methodology b={b} chrome={chrome} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> {t("c.foot.source", b.meta.entity, b.meta.budget_year)} {t("foot.amended")}</p>
        <p className="muted">{t("c.foot.builtBy")}</p>
      </footer>
    </div>
  );
}

// Wausau School District body. A Wisconsin school district is fund-accounted and
// levied district-wide under a state revenue limit — no per-department levy (County)
// and no per-jurisdiction municipal split (City). Its honest "where it goes" is BY
// OBJECT: salaries + benefits are ~69% of the General Fund, because the book budgets
// salaries centrally, not per school. Sections: where it goes (object/revenue), the
// money flow, all funds, the mill rate over a half-century, the school portion of
// your tax bill, and debt. All from the district's own validated schema.
const SCHOOL_SANKEY_SHORT = {
  "Other School Districts": "Other Districts",
  "Non-Salary Operating": "Operating",
  "Transfers to Other Funds": "Transfers Out",
};

function SchoolLedger({ b, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const overNotes = resolveNotes(chrome, lang, "overtime");
  const enrNotes = resolveNotes(chrome, lang, "students");
  const [gfFlow, setGfFlow] = useState("expenditures");
  const [showPeople, setShowPeople] = useState(false);
  const [active, setActive] = useState("where");
  const [taxTip, setTaxTip] = useState(null);
  const taxbarRef = useRef(null);
  const [homeValue, setHomeValue] = useState(200000);

  const gfo = b.gf_expenditures;
  // Where it goes: General Fund by object (spending) or by source (revenue).
  const gfRows = useMemo(() => {
    const rows = gfFlow === "expenditures"
      ? gfo.by_object.map((r) => ({ label: r.object, amount: r.amount, prior: r.prior }))
      : b.gf_revenues.map((r) => ({ label: r.source, amount: r.amount, prior: r.prior }));
    return [...rows].sort((a, c) => c.amount - a.amount);
  }, [gfFlow, gfo, b.gf_revenues]);
  const gfTotal = gfFlow === "expenditures" ? b.meta.gf_expenditures : b.meta.gf_revenues;
  const gfMax = useMemo(() => Math.max(...gfRows.map((r) => r.amount)), [gfRows]);

  // "People" detail: the largest salary + benefit line items, mixed and ranked.
  const peopleRows = useMemo(
    () => [...gfo.salary_lines, ...gfo.benefit_lines].sort((a, c) => c.amount - a.amount).slice(0, 8),
    [gfo]);
  const peopleMax = peopleRows.length ? peopleRows[0].amount : 1;
  const salaries = gfo.by_object.find((o) => o.object === "Salaries").amount;
  const benefits = gfo.by_object.find((o) => o.object === "Benefits").amount;
  const peopleShare = Math.round(((salaries + benefits) / gfo.total) * 100);

  // All funds, largest spending first.
  const funds = useMemo(() => [...b.funds].sort((a, c) => c.expenditures - a.expenditures), [b.funds]);
  const fundsTotal = useMemo(() => funds.reduce((s, f) => s + f.expenditures, 0), [funds]);
  const fundMax = useMemo(() => Math.max(...funds.map((f) => f.expenditures)), [funds]);

  // General Fund money flow: revenue sources -> General Fund -> spending objects.
  const sankey = useMemo(() => {
    const nodes = [];
    const id = (name, col) => { nodes.push({ name: SCHOOL_SANKEY_SHORT[name] || name, col }); return nodes.length - 1; };
    const revIds = [...b.gf_revenues].sort((a, c) => c.amount - a.amount).map((r) => ({ i: id(r.source, 0), v: r.amount }));
    const gf = id("General Fund", 1);
    const expIds = [...gfo.by_object].sort((a, c) => c.amount - a.amount).map((r) => ({ i: id(r.object, 2), v: r.amount }));
    return {
      nodes,
      links: [
        ...revIds.map((r) => ({ source: r.i, target: gf, value: r.v })),
        ...expIds.map((r) => ({ source: gf, target: r.i, value: r.v })),
      ],
    };
  }, [b.gf_revenues, gfo]);

  // Over time: the mill rate (fiscal years, 1968-) joined with the equalized
  // valuation (calendar years, 1975-) on a common calendar start-year, so the
  // falling rate and the rising tax base sit on one dual-axis chart.
  const rate = b.rate_history;
  const overTime = useMemo(() => {
    const valByYear = Object.fromEntries(b.valuation_history.map((v) => [v.year, v.value]));
    return rate.map((r) => {
      const cy = parseInt(r.label.slice(0, 4), 10);
      return { year: cy, label: r.label, rate: r.rate, valuation: valByYear[cy] ?? null };
    });
  }, [rate, b.valuation_history]);
  const otTicks = useMemo(() => {
    const ys = overTime.map((d) => d.year);
    const step = Math.ceil(ys.length / 8);
    return ys.filter((_, i) => i % step === 0 || i === ys.length - 1);
  }, [overTime]);
  const valFirst = b.valuation_history[0], valLast = b.valuation_history[b.valuation_history.length - 1];
  const valGrowth = (valLast.value / valFirst.value).toFixed(0);
  const ratePeak = useMemo(() => Math.max(...rate.map((r) => r.rate)), [rate]);
  const bridge = b.mill_bridge;

  // Levy & headline deltas.
  const levyPrior = useMemo(() => b.levy_by_fund.reduce((s, l) => s + l.prior_levy, 0), [b.levy_by_fund]);
  const levyPct = (b.meta.total_levy / levyPrior - 1) * 100;
  const millPct = (bridge.result_rate / bridge.base_rate - 1) * 100;

  // Your tax bill: the school portion, split by fund (its four levy mill rates).
  const jrows = useMemo(() => [...b.levy_by_fund].sort((a, c) => c.mill_rate - a.mill_rate), [b.levy_by_fund]);
  const jtotal = b.levy_total.mill_rate;

  const debt = b.debt;

  // Enrollment & per-student (Phase 2b — present when the WISEdash enrollment files
  // were folded in). Headcount trend + general-fund spending per student.
  const enr = b.enrollment;
  const enrSeries = useMemo(
    () => enr ? enr.labels.map((label, i) => ({ label, count: enr.counts[i] })) : [],
    [enr]);
  const enrNow = enr ? enr.counts[enr.counts.length - 1] : 0;
  const enrThen = enr ? enr.counts[0] : 0;
  const enrChange = enrNow - enrThen;
  const perStudentGF = enr ? Math.round(b.gf_expenditures.total / enrNow) : 0;
  const perStudentAll = enr ? Math.round(b.meta.net_expenditures / enrNow) : 0;

  const changed = useMemo(() => ([
    { label: t("wc.schoolLevy"), value: usd(b.meta.total_levy), delta: levyPct },
    { label: t("wc.millRate"), value: "$" + b.meta.mill_rate.toFixed(2), delta: millPct, invert: true },
    enr && {
      label: t("wc.enrollment"), value: enrNow.toLocaleString(),
      note: t("wc.enrollNote", enrChange, enr.labels[0]),
    },
  ]), [t, b.meta, levyPct, millPct, enr, enrNow, enrChange]);

  const sections = [
    ["where", "Where It Goes"],
    ["flow", "Money Flow"],
    ["allfunds", "All Funds"],
    ...(enr ? [["students", "Students"]] : []),
    ["overtime", "Over Time"],
    ["taxbill", "Your Tax Bill"],
    ["debt", "Debt"],
    ["methodology", "Methodology"],
  ];

  useEffect(() => {
    const els = sections.map(([id]) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="ftm">
      <style>{CSS}</style>
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">The Public Ledger</span>
            <span className="dot">·</span>
            <span>{b.meta.entity}</span>
          </div>
          {ENTITY_LOGOS[chrome.activeId] && (
            <img className="masthead-logo" src={ENTITY_LOGOS[chrome.activeId]} alt={b.meta.entity} />
          )}
        </div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("s.dek", b.meta.entity)}</p>
        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.net_expenditures)} sub={t("s.stat.allFundsNet")} />
          <Stat icon="🏛️" label={t("s.stat.schoolLevy")} value={usd(b.meta.total_levy)} sub={<Delta value={levyPct} />} />
          <Stat icon="🏠" label={t("stat.millRate")} value={b.meta.mill_rate.toFixed(2)} sub={<Delta value={millPct} invertColor />} />
        </div>
      </header>

      <Highlights items={changed} />

      <nav className="subnav">
        {sections.map(([id, label]) => (
          <a key={id} href={"#" + id} className={active === id ? "active" : ""}>{t("nav." + id)}</a>
        ))}
      </nav>

      {/* WHERE IT GOES — General Fund by object / by source */}
      <section id="where" className="block">
        <SectionHead kicker={t("kick.generalFund")} title={t("title.whereDollarGoes")}>
          {t("s.where.dek", compact(b.meta.gf_expenditures))}
        </SectionHead>
        <div className="toggle" role="group" aria-label="General fund view">
          <button aria-pressed={gfFlow === "expenditures"} className={gfFlow === "expenditures" ? "on" : ""} onClick={() => setGfFlow("expenditures")}>{t("btn.spending")}</button>
          <button aria-pressed={gfFlow === "revenues"} className={gfFlow === "revenues" ? "on" : ""} onClick={() => setGfFlow("revenues")}>{t("btn.revenue")}</button>
        </div>
        <div className="bars">
          {gfRows.map((r, i) => (
            <div className="bar-row no-spark" key={r.label} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="bar-label">{r.label}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.amount / gfMax) * 100}%` }} /></div>
              <div className="bar-val">{compact(r.amount)}</div>
              <div className="bar-share">{((r.amount / gfTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={(r.amount / r.prior - 1) * 100} invertColor={gfFlow === "expenditures"} /></div>
            </div>
          ))}
        </div>
        {gfFlow === "expenditures" && (
          <>
            <div className="toggle" role="group" aria-label="Salary and benefit detail" style={{ marginTop: 14 }}>
              <button aria-pressed={showPeople} className={showPeople ? "on" : ""} onClick={() => setShowPeople((v) => !v)}>
                {t("s.where.showPeople", showPeople)}
              </button>
            </div>
            {showPeople && (
              <div className="bars">
                {peopleRows.map((r, i) => (
                  <div className="bar-row no-spark" key={r.label} style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="bar-label">{r.label}</div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.amount / peopleMax) * 100}%` }} /></div>
                    <div className="bar-val">{compact(r.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <p className="note">
          {gfFlow === "expenditures" ? t("s.where.noteSpend", peopleShare) : t("s.where.noteRev")}
        </p>
      </section>

      {/* MONEY FLOW — General Fund Sankey */}
      <section id="flow" className="block">
        <SectionHead kicker={t("kick.followMoney")} title={t("title.howGfFlows")}>
          {t("s.flow.dek")}
        </SectionHead>
        <div className="chart-wrap">
          <div className="sankey-scroll">
            <div className="sankey-inner" role="img"
              aria-label={`Money-flow diagram: General Fund revenue sources flowing into the ${compact(b.meta.gf_expenditures)} general fund and out to spending. Largest source: State Aids.`}>
              <ResponsiveContainer width="100%" height={420}>
                <Sankey data={sankey} nodePadding={28} nodeWidth={12} iterations={64}
                  node={<SankeyNode />} link={{ stroke: "#16584a", strokeOpacity: 0.2 }}
                  margin={{ top: 24, right: 150, bottom: 24, left: 150 }}>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const p = (payload[0].payload && payload[0].payload.payload) || payload[0].payload || {};
                    const isLink = p.source && p.target && typeof p.source === "object";
                    return (
                      <div className="tip">
                        <div className="tip-year">{isLink ? `${p.source.name} → ${p.target.name}` : p.name}</div>
                        <div>{usd(p.value)}</div>
                      </div>
                    );
                  }} />
                </Sankey>
              </ResponsiveContainer>
            </div>
          </div>
          <p className="note">{t("s.flow.note")}</p>
        </div>
      </section>

      {/* ALL FUNDS */}
      <section id="allfunds" className="block">
        <SectionHead kicker={t("kick.wholePicture")} title={t("s.allfunds.title")}>
          {t("s.allfunds.dek", compact(b.meta.gross_expenditures))}
        </SectionHead>
        <div className="bars">
          {funds.map((f, i) => (
            <div className="bar-row no-spark" key={f.fund_no} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="bar-label">{f.name} <span className="muted">· Fund {f.fund_no}</span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(f.expenditures / fundMax) * 100}%` }} /></div>
              <div className="bar-val">{compact(f.expenditures)}</div>
              <div className="bar-share">{((f.expenditures / fundsTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={(f.expenditures / f.prior_expenditures - 1) * 100} invertColor /></div>
            </div>
          ))}
        </div>
        <p className="note">{t("s.allfunds.note")}</p>
      </section>

      {/* STUDENTS — enrollment trend + spending per student */}
      {enr && (
      <section id="students" className="block">
        <SectionHead kicker={t("s.students.kick")} title={t("s.students.title")}>
          {t("s.students.dek", enrNow.toLocaleString(), enr.labels[enr.labels.length - 1], enrChange, enrThen.toLocaleString(), usd(perStudentGF))}
        </SectionHead>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={enrSeries} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis domain={["dataMin - 200", "dataMax + 200"]} tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => v.toLocaleString()} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                return (<div className="tip"><div className="tip-year">{label}</div><div><i className="sw" style={{ background: "var(--accent)" }} /> {payload[0].value.toLocaleString()} {t("s.students.studentsLabel")}</div></div>);
              }} cursor={{ stroke: "var(--rule)" }} />
              <Area type="monotone" dataKey="count" name="Enrollment" stroke="var(--accent)" strokeWidth={2.5}
                fill="var(--accent)" fillOpacity={0.12} dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              {enrNotes.map((a) => (
                <ReferenceLine key={a.x} x={a.x} stroke="var(--ink-soft)" strokeDasharray="3 3" strokeOpacity={0.75}
                  label={{ value: a.tag, position: "insideTopRight", fontSize: 10, fill: "var(--ink-soft)", fontFamily: "var(--sans)" }} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="note">{t("s.students.note", enr.labels[0], enr.labels[enr.labels.length - 1], usd(perStudentGF), usd(perStudentAll))}</p>
          <ChartNotes notes={enrNotes} />
        </div>
      </section>
      )}

      {/* OVER TIME — the mill rate across a half-century */}
      <section id="overtime" className="block">
        <SectionHead kicker={t("kick.shiftingPriorities")} title={t("s.overtime.title")}>
          {t("s.overtime.dek", ratePeak.toFixed(2), b.meta.mill_rate.toFixed(2), valGrowth, valFirst.year, compact(valLast.value), valLast.year)}
        </SectionHead>
        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw" style={{ background: "var(--accent)" }} /> {t("s.overtime.legendRate")}</span>
            <span><i className="sw" style={{ background: "var(--gold)" }} /> {t("s.overtime.legendVal")}</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={overTime} margin={{ top: 8, right: 14, bottom: 4, left: 6 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" ticks={otTicks} tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis yAxisId="val" orientation="right" tick={{ fill: "var(--gold)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => "$" + (v / 1e9).toFixed(0) + "B"} />
              <YAxis yAxisId="rate" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={34} tickFormatter={(v) => "$" + v} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const r = payload.find((p) => p.dataKey === "rate");
                const v = payload.find((p) => p.dataKey === "valuation");
                return (
                  <div className="tip">
                    <div className="tip-year">{label}</div>
                    {r && <div><i className="sw" style={{ background: "var(--accent)" }} /> {t("s.overtime.tipRate")} ${r.value.toFixed(2)}</div>}
                    {v && v.value != null && <div><i className="sw" style={{ background: "var(--gold)" }} /> {t("s.overtime.tipVal")} {compact(v.value)}</div>}
                  </div>
                );
              }} cursor={{ stroke: "var(--rule)" }} />
              <Area yAxisId="val" type="monotone" dataKey="valuation" name="Equalized value" stroke="var(--gold)"
                strokeWidth={1.5} fill="var(--gold)" fillOpacity={0.14} dot={false} connectNulls activeDot={{ r: 4 }} />
              <Line yAxisId="rate" type="monotone" dataKey="rate" name="Mill rate" stroke="var(--accent)" strokeWidth={2.5}
                dot={false} activeDot={{ r: 5 }} />
              {overNotes.map((a) => (
                <ReferenceLine key={a.x} yAxisId="rate" x={a.x} stroke="var(--ink-soft)" strokeDasharray="3 3" strokeOpacity={0.75}
                  label={{ value: a.tag, position: "insideTopRight", fontSize: 10, fill: "var(--ink-soft)", fontFamily: "var(--sans)" }} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="note">{t("s.overtime.note", rate[0].label, rate[rate.length - 1].label, valFirst.year, valLast.year)}</p>
          <ChartNotes notes={overNotes} />
        </div>

        <div className="callout">
          <div className="callout-title">{t("s.overtime.calloutTitle", Math.round((bridge.base_rate - bridge.result_rate) * 100))}</div>
          <div className="bridge">
            <div className="bridge-row"><span>{bridge.base_label}</span><b>${bridge.base_rate.toFixed(2)}</b></div>
            {bridge.factors.map((f) => (
              <div className="bridge-row" key={f.factor}>
                <span>{f.factor}</span>
                <span className="bridge-delta" style={{ color: f.delta > 0 ? "var(--neg)" : "var(--pos)" }}>
                  {f.delta > 0 ? "+" : "−"}${Math.abs(f.delta).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="bridge-row total"><span>{bridge.result_label}</span><b>${bridge.result_rate.toFixed(2)}</b></div>
          </div>
        </div>
      </section>

      {/* YOUR TAX BILL — school portion, split by fund */}
      <section id="taxbill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("title.taxbillMeaning")}>
          {t("s.taxbill.dek", jtotal.toFixed(2))}
        </SectionHead>

        <div className="calc">
          <div className="calc-input">
            <label htmlFor="homeval-s">{t("s.taxbill.homeLabel")}</label>
            <div className="calc-field">
              <span>$</span>
              <input id="homeval-s" type="text" inputMode="numeric" value={homeValue.toLocaleString("en-US")}
                onChange={(e) => setHomeValue(Math.min(parseInt(e.target.value.replace(/[^\d]/g, "")) || 0, 99999999))} />
            </div>
          </div>
          <div className="calc-out">
            <span className="calc-out-label">{t("s.taxbill.estOut")}</span>
            <span className="calc-out-val">{usd(Math.round((homeValue / 1000) * jtotal))}</span>
          </div>
        </div>

        <div className="taxbar" ref={taxbarRef} onMouseLeave={() => setTaxTip(null)}>
          {jrows.map((r, i) => {
            const share = (r.mill_rate / jtotal) * 100;
            return (
              <div className="taxbar-seg" key={r.fund}
                style={{ width: share + "%", background: JURIS_COLORS[i % JURIS_COLORS.length] }}
                onMouseMove={(e) => {
                  const rect = taxbarRef.current.getBoundingClientRect();
                  setTaxTip({ i, x: e.clientX - rect.left, w: rect.width });
                }}>
                {share > 9 ? Math.round(share) + "%" : ""}
              </div>
            );
          })}
          {taxTip && (() => {
            const r = jrows[taxTip.i];
            const share = (r.mill_rate / jtotal) * 100;
            return (
              <div className="taxbar-tip" style={{ left: Math.max(90, Math.min(taxTip.x, taxTip.w - 90)) }}>
                <div className="tip-year">{r.fund}</div>
                <div>{usd(Math.round((homeValue / 1000) * r.mill_rate))} &middot; {share.toFixed(1)}% &middot; ${r.mill_rate.toFixed(2)}/$1k</div>
              </div>
            );
          })()}
        </div>
        <div className="jrows">
          {jrows.map((r, i) => (
            <div className="jrow" key={r.fund}>
              <span className="jrow-sw" style={{ background: JURIS_COLORS[i % JURIS_COLORS.length] }} />
              <span className="jrow-name">{r.fund}</span>
              <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * r.mill_rate))}</span>
              <span className="jrow-share">{((r.mill_rate / jtotal) * 100).toFixed(0)}%</span>
            </div>
          ))}
          <div className="jrow total">
            <span className="jrow-sw" />
            <span className="jrow-name">{t("s.taxbill.totalRow")}</span>
            <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * jtotal))}</span>
            <span className="jrow-share">100%</span>
          </div>
        </div>
        <p className="note">{t("s.taxbill.note", b.meta.fiscal_label, jtotal.toFixed(2))}</p>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker={t("s.debt.kick")} title={t("title.outstandingDebt")}>
          {t("s.debt.dek", compact(debt.outstanding_principal), compact(debt.total_interest_remaining))}
        </SectionHead>
        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-new" /> {t("lbl.principal")}</span>
            <span><i className="sw sw-old" /> {t("lbl.interest")}</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={debt.retirement} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
              <Tooltip content={<BarTip />} cursor={{ fill: "var(--paper-2)" }} />
              <Bar dataKey="principal" stackId="d" fill="var(--accent)" name={t("lbl.principal")} maxBarSize={26} />
              <Bar dataKey="interest" stackId="d" fill="var(--gold)" fillOpacity={0.82} name={t("lbl.interest")} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
          <p className="note">{t("s.debt.note", debt.retirement[0].year, compact(debt.retirement[0].total), debt.retirement[debt.retirement.length - 1].year)}</p>
        </div>
      </section>

      <Methodology b={b} chrome={chrome} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> {t("s.foot.source", b.meta.entity, b.meta.fiscal_label)} {t("foot.amended")}</p>
        <p className="muted">{t("s.foot.builtBy")}</p>
      </footer>
    </div>
  );
}

function Ledger({ b, chrome }) {
  const t = useStrings();
  const [flow, setFlow] = useState("expenditures");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");
  const [open, setOpen] = useState(null);
  const [active, setActive] = useState("where");
  const [deptView, setDeptView] = useState("amount");
  const [homeValue, setHomeValue] = useState(200000);

  // Both tabs sorted by amount, largest first.
  const gfRows = useMemo(() => [...b.general_fund[flow]].sort((a, c) => c.proposed_next - a.proposed_next), [flow, b.general_fund]);
  const gfTotal = useMemo(() => gfRows.reduce((s, r) => s + r.proposed_next, 0), [gfRows]);
  const gfMax = useMemo(() => Math.max(...gfRows.map((r) => r.proposed_next)), [gfRows]);

  const sortedDepts = useMemo(() => {
    const val = (d) => (sortKey === "spend" ? deptSpend(d) : sortKey === "levy" ? d.tax_levy
      : sortKey === "personnel" ? d.personnel_expenditures
      : sortKey === "change" ? (d.levy_difference ?? -Infinity) : d.department);
    const arr = [...b.departments];
    arr.sort((a, c) => {
      const va = val(a), vc = val(c);
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vc) : vc.localeCompare(va);
      return sortDir === "asc" ? va - vc : vc - va;
    });
    return arr;
  }, [b.departments, sortKey, sortDir]);

  const deptMaxSpend = useMemo(() => Math.max(...b.departments.map(deptSpend)), [b.departments]);
  const debtTotal = useMemo(() => b.debt.reduce((s, d) => s + d.outstanding, 0), [b.debt]);

  const setSort = (k) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "department" ? "asc" : "desc"); }
  };

  const trend = useMemo(
    () => b.levy_history.map((l) => {
      const h = b.homeowner_impact.find((x) => x.year === l.year);
      return { year: l.year, rate: l.rate, bill: h ? h.tax_amount : null };
    }),
    [b.levy_history, b.homeowner_impact]
  );
  const lastTrend = trend[trend.length - 1];

  // Total county levy vs. mill rate, straight from the (already multi-year)
  // levy_history. A different lens than the per-home bill chart below: total
  // dollars raised, not the bill on a typical home.
  const levyTrend = b.levy_history;
  const levyFirst = levyTrend[0];
  const levyLast = levyTrend[levyTrend.length - 1];
  const levyPrev = levyTrend[levyTrend.length - 2];
  // Masthead deltas computed from the (self-consistent) levy history, not
  // hardcoded — see the methodology note re: the county summary page's $200K
  // higher figure.
  const levyPctChange = (levyLast.levy / levyPrev.levy - 1) * 100;
  const ratePctChange = (levyLast.rate / levyPrev.rate - 1) * 100;

  // Total-budget YoY change — dormant until a prior year's totals land in
  // history (i.e. once prior-year PDFs are ingested), mirroring the levy delta.
  const tYears = Object.keys(b.history.totals).map(Number).sort((a, c) => a - c);
  const budgetPctChange = tYears.length >= 2
    ? (b.history.totals[String(tYears[tYears.length - 1])].total_expenditures
      / b.history.totals[String(tYears[tYears.length - 2])].total_expenditures - 1) * 100
    : null;

  // Department adopted levy, prior year vs latest, for the comparison chart.
  // Dormant until >=2 adopted years exist in history. Excludes revenue-returning
  // offices (negative levy: County Treasurer, Register of Deeds, Non
  // Departmental), whose book-to-book reclassifications swing levy by tens of
  // millions — an artifact that would dwarf every real department.
  const deptCompare = useMemo(() => {
    const years = b.history.years;
    if (years.length < 2) return null;
    const first = String(years[0]), last = String(years[years.length - 1]);
    const rows = b.history.departments
      .filter((d) => d.adopted[first] > 0 && d.adopted[last] > 0)
      .map((d) => ({ name: d.department, first: d.adopted[first], last: d.adopted[last], change: d.adopted[last] - d.adopted[first] }));
    const maxVal = Math.max(...rows.map((r) => Math.max(r.first, r.last)), 1);
    const maxChange = Math.max(...rows.map((r) => Math.abs(r.change)), 1);
    return { first, last, rows, maxVal, maxChange };
  }, [b.history]);

  // Biggest single-department levy increase. Require a positive levy in BOTH years
  // so revenue-returning offices (County Treasurer, Register of Deeds, Non
  // Departmental) are excluded — their levy sign flips between books and shows a
  // tens-of-millions reclassification artifact that would dwarf every real change.
  const levyMover = useMemo(() => {
    const ds = b.departments.filter((d) =>
      typeof d.levy_difference === "number" && d.tax_levy > 0 && d.prior_tax_levy > 0);
    return ds.sort((a, c) => c.levy_difference - a.levy_difference)[0];
  }, [b.departments]);

  const changed = useMemo(() => ([
    { label: t("wc.countyLevy"), value: usd(b.meta.tax_levy), delta: levyPctChange },
    { label: t("wc.millRate"), value: "$" + b.meta.tax_rate.toFixed(2), delta: ratePctChange },
    levyMover && levyMover.levy_difference > 0
      ? { label: t("wc.biggestLevyIncrease"), value: levyMover.department, note: "+" + usd(levyMover.levy_difference) }
      : (budgetPctChange != null
        ? { label: t("wc.totalBudget"), value: compact(b.meta.total_expenditures), delta: budgetPctChange }
        : null),
  ]), [t, b.meta, levyPctChange, ratePctChange, levyMover, budgetPctChange]);

  const sections = [
    ["where", "Where It Goes"],
    ["departments", "Departments"],
    ["trends", "Over Time"],
    ["bill", "Your Tax Bill"],
    ["funds", "Funds"],
    ["debt", "Debt"],
    ["methodology", "Methodology"],
  ];

  // Scroll-spy: highlight the tab for whichever section sits near mid-viewport.
  useEffect(() => {
    const els = sections.map(([id]) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="ftm">
      <style>{CSS}</style>

      {/* WPR brand chrome bar — shared suite chrome */}
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      {/* masthead */}
      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">The Public Ledger</span>
            <span className="dot">·</span>
            <span>{b.meta.entity}</span>
            {/* sponsor slot lands here later */}
          </div>
          {ENTITY_LOGOS[chrome.activeId] && (
            <img className="masthead-logo" src={ENTITY_LOGOS[chrome.activeId]} alt={b.meta.entity} />
          )}
        </div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("co.dek", b.meta.entity, new Date(b.meta.adopted + "T00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</p>

        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.total_expenditures)} sub={budgetPctChange != null ? <Delta value={budgetPctChange} /> : null} />
          <Stat icon="🏛️" label={t("co.stat.countyLevy")} value={usd(b.meta.tax_levy)} sub={<Delta value={levyPctChange} />} />
          <Stat icon="🏠" label={t("stat.millRate")} value={"$" + b.meta.tax_rate.toFixed(2)} sub={<Delta value={ratePctChange} />} />
        </div>
      </header>

      <Highlights items={changed} />

      <nav className="subnav">
        {sections.map(([id, label]) => (
          <a key={id} href={"#" + id} className={active === id ? "active" : ""}>{t("nav." + id)}</a>
        ))}
      </nav>

      {/* WHERE IT GOES */}
      <section id="where" className="block">
        <SectionHead kicker={t("kick.generalFund")} title={t("title.whereDollarGoes")}>
          {t("co.where.dek")}
        </SectionHead>

        <div className="toggle" role="group" aria-label="General fund view">
          <button aria-pressed={flow === "expenditures"} className={flow === "expenditures" ? "on" : ""} onClick={() => setFlow("expenditures")}>{t("btn.spending")}</button>
          <button aria-pressed={flow === "revenues"} className={flow === "revenues" ? "on" : ""} onClick={() => setFlow("revenues")}>{t("btn.revenue")}</button>
        </div>

        <div className="bars">
          {gfRows.map((r, i) => (
            <div className="bar-row" key={r.category} style={{ animationDelay: `${i * 45}ms` }}>
              <div className="bar-label">{r.category}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(r.proposed_next / gfMax) * 100}%` }} />
              </div>
              <Spark className="hide-sm"
                values={[r.actual_prior, r.budget_current, r.proposed_next]}
                tone={(r.proposed_next >= r.actual_prior) === (flow === "revenues") ? "pos" : "neg"} />
              <div className="bar-val">{compact(r.proposed_next)}</div>
              <div className="bar-share">{((r.proposed_next / gfTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={r.pct_change} invertColor={flow === "expenditures"} /></div>
            </div>
          ))}
        </div>
        <p className="note">{t("co.where.note", flow)}</p>
      </section>

      {/* DEPARTMENTS */}
      <section id="departments" className="block">
        <SectionHead kicker={t("co.dept.kick")} title={t("co.dept.title")}>
          {t("co.dept.dek")}
        </SectionHead>

        <div className="ledger">
          <div className="ledger-head">
            <button className={sortKey === "department" ? "sorted" : ""} onClick={() => setSort("department")}>{t("co.dept.colDepartment")}</button>
            <button className={sortKey === "spend" ? "sorted" : ""} onClick={() => setSort("spend")}>{t("co.dept.colSpend")}</button>
            <button className={"hide-sm " + (sortKey === "personnel" ? "sorted" : "")} onClick={() => setSort("personnel")}>{t("co.dept.colPersonnel")}</button>
            <button className={sortKey === "levy" ? "sorted" : ""} onClick={() => setSort("levy")}>{t("co.dept.colLevy")}</button>
            <button className={"hide-sm " + (sortKey === "change" ? "sorted" : "")} onClick={() => setSort("change")}>{t("co.dept.colVs")}</button>
            <span className="chev-col" />
          </div>

          {sortedDepts.map((d) => {
            const spend = deptSpend(d);
            const isOpen = open === d.department;
            return (
              <div key={d.department} className={"ledger-item" + (isOpen ? " open" : "")}>
                <button className="ledger-row" onClick={() => setOpen(isOpen ? null : d.department)} aria-expanded={isOpen}>
                  <span className="d-name">
                    {d.department}
                    <span className="d-spark"><span style={{ width: `${(spend / deptMaxSpend) * 100}%` }} /></span>
                  </span>
                  <span className="d-spend">{usd(spend)}</span>
                  <span className="d-pers hide-sm">{compact(d.personnel_expenditures)}</span>
                  <span className="d-levy"><span className="lg-only">{usd(d.tax_levy)}</span><span className="sm-only">{compact(d.tax_levy)}</span></span>
                  <span className="d-change hide-sm"><Delta value={d.levy_difference} money /></span>
                  <span className="chev-col"><ChevronDown size={16} className="chev" /></span>
                </button>
                {isOpen && (
                  <div className="detail">
                    <div className="detail-grid">
                      <Balance title={t("bal.whereGoes")} rows={[
                        [t("bal.operatingExp"), d.operating_expenditures],
                        [t("bal.personnel"), d.personnel_expenditures],
                      ]} total={[t("bal.totalSpending"), spend]} />
                      <Balance title={t("bal.whereFrom")} rows={[
                        [t("bal.revenueRaised"), d.operating_revenues],
                        [t("bal.countyLevy"), d.tax_levy],
                      ]} total={[t("bal.totalFunding"), d.operating_revenues + d.tax_levy]} />
                    </div>
                    <p className="detail-note">
                      {t("co.dept.detailLevy", d.department.replace(/&rsquo;/g, "'"))}{" "}
                      {d.levy_difference === null ? t("co.dept.unchanged") :
                        d.levy_difference >= 0
                          ? t("co.dept.rose", usd(d.levy_difference))
                          : t("co.dept.fell", usd(Math.abs(d.levy_difference)))}
                      {d.tax_levy < 0 && " " + t("co.dept.returns")}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* OVER TIME */}
      <section id="trends" className="block">
        <SectionHead kicker={t("kick.shiftingPriorities")} title={t("co.trends.title")}>
          {t("co.trends.dek")}
        </SectionHead>

        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-levy" /> {t("co.trends.legendLevy")}</span>
            <span><i className="sw sw-rate" /> {t("co.trends.legendRate")}</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={levyTrend} margin={{ top: 8, right: 12, bottom: 4, left: 10 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis yAxisId="levy" tick={{ fill: "var(--gold)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
              <YAxis yAxisId="rate" orientation="right" domain={[3, 5.5]} tick={{ fill: "var(--accent)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v.toFixed(1)} width={42} />
              <Tooltip content={<LevyTip />} cursor={{ fill: "var(--paper-2)" }} />
              <Bar yAxisId="levy" dataKey="levy" fill="var(--gold)" fillOpacity={0.82} radius={[2, 2, 0, 0]} maxBarSize={34} />
              <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="note">{t("co.trends.note", usd(levyFirst.levy), levyFirst.year, usd(levyLast.levy), levyLast.year, (((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0), levyFirst.rate.toFixed(2), levyLast.rate.toFixed(2))}</p>
        </div>

        {deptCompare && (
          <div className="chart-wrap" style={{ marginTop: 44 }}>
            <h3 className="subhead">{t("co.trends.subhead", deptCompare.first, deptCompare.last)}</h3>
            <div className="toggle" role="group" aria-label="Department comparison view">
              <button aria-pressed={deptView === "amount"} className={deptView === "amount" ? "on" : ""} onClick={() => setDeptView("amount")}>{t("co.trends.amounts")}</button>
              <button aria-pressed={deptView === "change"} className={deptView === "change" ? "on" : ""} onClick={() => setDeptView("change")}>{t("co.trends.change")}</button>
            </div>

            {deptView === "amount" ? (
              <>
                <div className="chart-legend">
                  <span><i className="sw sw-old" /> {t("co.trends.legendYr", deptCompare.first)}</span>
                  <span><i className="sw sw-new" /> {t("co.trends.legendYr", deptCompare.last)}</span>
                </div>
                <div className="cmp">
                  {[...deptCompare.rows].sort((a, c) => c.last - a.last).map((d) => (
                    <div className="cmp-row" key={d.name}>
                      <div className="cmp-head">
                        <span className="cmp-name">{d.name}</span>
                        <span className="cmp-delta">
                          <Delta value={d.change} money exact />
                          <span className="cmp-pct">{pct((d.change / d.first) * 100)}</span>
                        </span>
                      </div>
                      <div className="cmp-bar">
                        <span className="cmp-yr">&rsquo;{String(deptCompare.first).slice(2)}</span>
                        <span className="cmp-track"><i className="cmp-fill old" style={{ width: `${(d.first / deptCompare.maxVal) * 100}%` }} /></span>
                        <span className="cmp-val">{usd(d.first)}</span>
                      </div>
                      <div className="cmp-bar">
                        <span className="cmp-yr">&rsquo;{String(deptCompare.last).slice(2)}</span>
                        <span className="cmp-track"><i className="cmp-fill new" style={{ width: `${(d.last / deptCompare.maxVal) * 100}%` }} /></span>
                        <span className="cmp-val">{usd(d.last)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="chg">
                {[...deptCompare.rows].sort((a, c) => c.change - a.change).map((d) => (
                  <div className="chg-row" key={d.name}>
                    <span className="chg-name">{d.name}</span>
                    <span className="chg-track">
                      <i className={"chg-fill " + (d.change >= 0 ? "up" : "down")}
                        style={{ width: `${(Math.abs(d.change) / deptCompare.maxChange) * 50}%` }} />
                    </span>
                    <span className="chg-val"><Delta value={d.change} money exact /></span>
                  </div>
                ))}
              </div>
            )}

            <p className="note">{t("co.trends.cmpNote", deptCompare.first, deptCompare.last)}</p>
          </div>
        )}
      </section>

      {/* TAX BILL */}
      <section id="bill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("title.taxbillMeaning")}>
          {t("co.bill.dek")}
        </SectionHead>

        <div className="calc">
          <div className="calc-input">
            <label htmlFor="homeval-c">{t("co.bill.homeLabel")}</label>
            <div className="calc-field">
              <span>$</span>
              <input id="homeval-c" type="text" inputMode="numeric" value={homeValue.toLocaleString("en-US")}
                onChange={(e) => setHomeValue(Math.min(parseInt(e.target.value.replace(/[^\d]/g, "")) || 0, 99999999))} />
            </div>
          </div>
          <div className="calc-out">
            <span className="calc-out-label">{t("co.bill.estOut", b.meta.budget_year)}</span>
            <span className="calc-out-val">{usd(Math.round((homeValue / 1000) * b.meta.tax_rate))}</span>
          </div>
        </div>

        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-rate" /> {t("co.bill.legendRate")}</span>
            <span><i className="sw sw-bill" /> {t("co.bill.legendBill")}</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis yAxisId="rate" domain={[3, 5.5]} tick={{ fill: "var(--accent)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v.toFixed(1)} width={42} />
              <YAxis yAxisId="bill" orientation="right" domain={[650, 900]} tick={{ fill: "var(--gold)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v} width={48} />
              <Tooltip content={<BillTip />} />
              <Line yAxisId="rate" type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              <Line yAxisId="bill" type="monotone" dataKey="bill" stroke="var(--gold)" strokeWidth={2.5} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} />
              <ReferenceDot yAxisId="bill" x={lastTrend.year} y={lastTrend.bill} r={4} fill="var(--gold)" stroke="none" />
            </LineChart>
          </ResponsiveContainer>
          <p className="note">{t("co.bill.note", usd(b.homeowner_impact[0].avg_value), b.homeowner_impact[0].year, usd(b.homeowner_impact[b.homeowner_impact.length - 1].avg_value), lastTrend.year, b.homeowner_impact[0].tax_rate.toFixed(2), lastTrend.rate.toFixed(2))}</p>
        </div>
      </section>

      {/* FUNDS */}
      <section id="funds" className="block">
        <SectionHead kicker={t("co.funds.kick")} title={t("co.funds.title")}>
          {t("co.funds.dek")}
        </SectionHead>
        <div className="fund-table">
          <div className="fund-head">
            <span>{t("co.funds.colFund")}</span><span>{t("co.funds.colLevy")}</span><span className="hide-sm">{t("co.funds.colRevenue")}</span><span>{t("co.funds.colSpending")}</span>
          </div>
          {b.funds.map((f) => (
            <div className="fund-row" key={f.fund_no}>
              <span className="f-name"><b>{f.name}</b><em>#{f.fund_no}</em></span>
              <span>{f.tax_levy ? usd(f.tax_levy) : <span className="muted">{t("co.funds.none")}</span>}</span>
              <span className="hide-sm">{usd(f.operating_revenues)}</span>
              <span>{usd(f.operating_expenditures + f.personnel_expenditures)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker={t("co.debt.kick")} title={t("title.outstandingDebt")}>
          {t("co.debt.dek", b.debt.length, usd(debtTotal))}
        </SectionHead>
        <div className="debt-list">
          {b.debt.map((d) => (
            <div className="debt-row" key={d.series}>
              <span className="db-bar" style={{ width: `${(d.outstanding / debtTotal) * 100}%` }} />
              <span className="db-name">{d.series}</span>
              <span className="db-val">{usd(d.outstanding)}</span>
            </div>
          ))}
        </div>
      </section>

      <Methodology b={b} chrome={chrome} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> {t("co.foot.source", b.meta.entity, b.meta.budget_year)} {t("foot.amended")}</p>
        <p className="muted">{t("co.foot.builtBy")}</p>
        <p className="muted"><b>{t("co.foot.levyLabel")}</b> {t("co.foot.levyBody")}</p>
      </footer>
    </div>
  );
}

/* ---------- sub-components ---------- */
function Stat({ icon, label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-icon" aria-hidden="true">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Balance({ title, rows, total }) {
  return (
    <div className="balance">
      <div className="balance-title">{title}</div>
      {rows.map(([k, v]) => (
        <div className="balance-row" key={k}><span>{k}</span><span>{usd(v)}</span></div>
      ))}
      <div className="balance-row total"><span>{total[0]}</span><span>{usd(total[1])}</span></div>
    </div>
  );
}

function BillTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const rate = payload.find((p) => p.dataKey === "rate");
  const bill = payload.find((p) => p.dataKey === "bill");
  return (
    <div className="tip">
      <div className="tip-year">{label}</div>
      {rate && <div><i className="sw sw-rate" /> Mill rate ${rate.value.toFixed(2)}</div>}
      {bill && <div><i className="sw sw-bill" /> Avg bill {usd(Math.round(bill.value))}</div>}
    </div>
  );
}

// Workforce line-chart tooltip — plain FTE counts (not dollars).
function WorkforceTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const rows = [...payload].filter((p) => p.value != null).sort((a, c) => c.value - a.value);
  return (
    <div className="tip">
      <div className="tip-year">{label}</div>
      {rows.map((p) => (
        <div key={p.dataKey}><i className="sw" style={{ background: p.color }} /> {p.name || p.dataKey} {p.value} FTE</div>
      ))}
    </div>
  );
}

// Sankey node: a colored bar with a label (revenue sources on the left, the
// General Fund hub in the middle, departments on the right).
function SankeyNode({ x, y, width, height, payload }) {
  const col = payload.col;
  const fill = col === 0 ? "#9a7b2e" : col === 1 ? "#16584a" : "#1c1a16";
  if (height <= 0) return null;
  const amt = compact(payload.value);
  if (col === 1) {
    return (
      <Layer>
        <rect x={x} y={y} width={width} height={height} fill={fill} />
        <text x={x + width / 2} y={y - 9} textAnchor="middle" fontSize={13} fontWeight={700}
          fontFamily="Public Sans, system-ui, sans-serif" fill="#1c1a16">{payload.name} {amt}</text>
      </Layer>
    );
  }
  const left = col === 0;
  // Small revenue/spending lines layout to a near-invisible sliver; floor the bar
  // so it stays visible and always render the label (nodePadding keeps the stacked
  // labels from colliding). The label centers on the drawn bar.
  const barH = Math.max(height, 2.5);
  return (
    <Layer>
      <rect x={x} y={y} width={width} height={barH} fill={fill} fillOpacity={0.9} />
      <text x={left ? x - 8 : x + width + 8} y={y + barH / 2} textAnchor={left ? "end" : "start"}
        dominantBaseline="middle" fontSize={11.5} fontWeight={600}
        fontFamily="Public Sans, system-ui, sans-serif" fill="#1c1a16">
        {payload.name} <tspan fill="#6b6555" fontWeight={400}>{amt}</tspan>
      </text>
    </Layer>
  );
}

// Generic bar-chart tooltip (City levy + debt charts). `seriesName` labels a
// series whose Bar has no `name`; multi-series bars use their own names.
function BarTip({ active, payload, label, seriesName }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="tip">
      <div className="tip-year">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey}><i className="sw" style={{ background: p.color }} /> {p.name || seriesName || p.dataKey} {compact(p.value)}</div>
      ))}
    </div>
  );
}

function LevyTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const levy = payload.find((p) => p.dataKey === "levy");
  const rate = payload.find((p) => p.dataKey === "rate");
  return (
    <div className="tip">
      <div className="tip-year">{label}</div>
      {levy && <div><i className="sw sw-levy" /> Levy {usd(levy.value)}</div>}
      {rate && <div><i className="sw sw-rate" /> Mill rate ${rate.value.toFixed(2)}</div>}
    </div>
  );
}

// Inline 3-point trajectory sparkline (pure SVG — no chart lib needed).
function Spark({ values, tone, className = "" }) {
  const w = 56, h = 16, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (w - 2 * pad),
    h - pad - ((v - min) / span) * (h - 2 * pad),
  ]);
  const [ex, ey] = pts[pts.length - 1];
  return (
    <svg className={"spark " + className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none" stroke={`var(--${tone})`} strokeWidth="1.5" />
      <circle cx={ex} cy={ey} r="1.8" fill={`var(--${tone})`} />
    </svg>
  );
}

/* ---------- styles ---------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Public+Sans:wght@400;500;600;700&family=Playfair+Display:wght@900&display=swap');

html{scroll-behavior:smooth;}

.ftm {
  --paper:#f5f1e8; --paper-2:#efe9da; --ink:#1c1a16; --ink-soft:#6b6555; --rule:#ddd5c2;
  --accent:#16584a; --pos:#2f6f4f; --neg:#a8492f; --gold:#9a7b2e;
  --serif:'Fraunces',Georgia,serif; --sans:'Public Sans',system-ui,sans-serif;
  background:var(--paper); color:var(--ink); font-family:var(--sans);
  font-feature-settings:"tnum" 1; line-height:1.5; max-width:1080px; margin:0 auto;
  padding:0 24px 80px;
}
.ftm *{box-sizing:border-box;}
.ftm h1,.ftm h2{font-family:var(--serif); font-weight:600; letter-spacing:-0.01em; margin:0;}

/* WPR brand chrome bar — shared "Follow the Money" suite chrome (matches River Conditions) */
/* Two-tier chrome: brand + share/FY on the top row, the entity switcher as its own
   full-width row beneath. Scales cleanly to four (and more) entities at any width
   instead of cramming them into the brand row. */
.chrome-bar{display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:9px 14px;
  margin:0 -24px; padding:9px 24px; background:#0d7377; color:#fff;}
.chrome-bar__brand{display:flex; align-items:center; gap:10px; text-decoration:none; color:#fff;}
.chrome-bar__logo-img{height:30px; width:30px; border-radius:50%; object-fit:cover;
  border:1.5px solid rgba(255,255,255,.5); flex-shrink:0;}
.chrome-bar__wordmark{font-family:'Playfair Display',Georgia,serif; font-weight:900;
  font-size:14px; letter-spacing:.03em; text-transform:uppercase; white-space:nowrap;}
.chrome-bar__left{display:flex; align-items:center; gap:12px; min-width:0; flex:1 1 auto;}
.chrome-bar__divider{width:1px; height:18px; background:rgba(255,255,255,.35);}
.chrome-bar__section{font-weight:600; font-size:12px; letter-spacing:.04em;
  text-transform:uppercase; opacity:.9; white-space:nowrap;}
.chrome-bar__right{display:flex; align-items:center; gap:12px; flex:0 0 auto;}
.chrome-bar__meta{font-size:11px; letter-spacing:.04em; opacity:.75; white-space:nowrap;}
.chrome-bar__share{display:inline-flex; align-items:center; gap:6px; cursor:pointer;
  background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.32); color:#fff;
  font-family:var(--sans); font-weight:600; font-size:12px; letter-spacing:.02em; line-height:1;
  padding:6px 12px; border-radius:18px; white-space:nowrap;
  transition:background .15s ease, border-color .15s ease;}
.chrome-bar__share:hover{background:rgba(255,255,255,.2);}
.chrome-bar__home{display:inline-flex; align-items:center; gap:6px; cursor:pointer; color:#fff;
  background:transparent; border:none; font-family:var(--sans); font-weight:600; font-size:12.5px;
  letter-spacing:.02em; padding:4px 4px; opacity:.9;}
.chrome-bar__home:hover{opacity:1; text-decoration:underline; text-underline-offset:3px;}
.chrome-bar__lang{appearance:none; -webkit-appearance:none; background:rgba(255,255,255,.10);
  border:1px solid rgba(255,255,255,.32); color:#fff; font-family:var(--sans); font-weight:600;
  font-size:12px; padding:6px 10px; border-radius:18px; cursor:pointer; line-height:1;}
.chrome-bar__lang option{color:#1c1a16;}
.chrome-bar__lang:hover{background:rgba(255,255,255,.2);}
/* Hmong beta notice — full-bleed strip directly under the chrome bar. */
.beta-banner{margin:0 -24px; padding:9px 24px; background:var(--gold); color:#1c1a16;
  font-family:var(--sans); font-size:12.5px; line-height:1.45;}
.beta-banner b{font-weight:700;}
/* the switcher row */
.chrome-bar__switch{display:flex; flex-wrap:wrap; align-items:center; gap:8px; flex:1 1 100%;
  padding-top:8px; border-top:1px solid rgba(255,255,255,.18);}
.chrome-bar__ent{display:inline-flex; align-items:center; gap:8px; cursor:pointer;
  background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.28); color:#fff;
  font-family:var(--sans); font-weight:600; font-size:12.5px; letter-spacing:.02em; line-height:1;
  padding:6px 14px 6px 5px; border-radius:18px; white-space:nowrap;
  transition:background .15s ease, border-color .15s ease, color .15s ease;}
.chrome-bar__ent img{width:24px; height:24px; border-radius:5px; object-fit:contain;
  background:#fff; padding:2px; flex-shrink:0;}
.chrome-bar__ent:hover{background:rgba(255,255,255,.18);}
.chrome-bar__ent.on{background:#fff; color:var(--ink); border-color:#fff;}
/* Switcher icon for the non-government "Your Tax Bill" view — sized to match the
   entity seals so the row reads evenly. */
.chrome-bar__ent-icon{width:24px; height:24px; padding:3px; border-radius:5px;
  background:rgba(255,255,255,.16); color:inherit; flex-shrink:0;}
.chrome-bar__ent.on .chrome-bar__ent-icon{background:var(--paper-2);}
@media (max-width:560px){
  .chrome-bar__divider,.chrome-bar__section{display:none;}
  /* The controls cluster (language · share · FY) gets its own row so the added
     language selector never pushes past the edge. */
  .chrome-bar__right{flex:1 1 100%; flex-wrap:wrap; gap:8px 10px;}
  /* Stack the entity buttons full-width so the labels never run off the edge. */
  .chrome-bar__ent{flex:1 1 100%; justify-content:flex-start; font-size:12px; padding:6px 12px 6px 5px;}
  .chrome-bar__ent img, .chrome-bar__ent-icon{width:22px; height:22px;}
}

/* masthead */
.masthead{padding:54px 0 30px; border-bottom:2px solid var(--ink);}
.masthead-head{display:flex; align-items:flex-start; justify-content:space-between; gap:18px;}
.masthead-logo{width:78px; height:78px; flex-shrink:0; border-radius:14px; object-fit:contain;
  background:#fff; padding:7px; border:1px solid var(--rule); box-shadow:0 1px 5px rgba(28,26,22,.08);}
.kicker-row{display:flex; align-items:center; gap:10px; font-size:12px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--ink-soft); font-weight:600;}
.kicker-row .pub{color:var(--accent);}
.kicker-row .dot{opacity:.5;}
.masthead h1{font-size:clamp(44px,8vw,82px); line-height:.98; margin:14px 0 0; font-weight:600;}
.masthead .dek{font-size:18px; max-width:60ch; color:#3a362d; margin:16px 0 0; line-height:1.55;}
.stat-strip{display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--rule);
  border:1px solid var(--rule); margin-top:36px;}
.stat{background:var(--paper); padding:40px 24px 34px; transition:background .15s ease;
  display:flex; flex-direction:column; align-items:center; text-align:center;}
.stat:hover{background:var(--paper-2);}
.stat-icon{font-size:34px; line-height:1; margin-bottom:16px;}
.stat-label{font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-soft); font-weight:700;}
.stat-value{font-family:var(--serif); font-size:clamp(32px,4.6vw,54px); font-weight:600; line-height:1;
  margin:12px 0 10px; letter-spacing:-0.02em; max-width:100%;}
.stat-sub{font-size:15px; color:var(--ink-soft);}

/* subnav — pronounced tab bar with an active scroll-spy underline */
.subnav{position:sticky; top:0; z-index:5; display:flex; justify-content:space-evenly; gap:4px; flex-wrap:wrap;
  background:var(--paper); border-bottom:2px solid var(--ink); padding:0; margin-bottom:8px;
  box-shadow:0 7px 14px -12px rgba(28,26,22,.4);}
.subnav a{position:relative; flex:1 1 auto; text-align:center; font-size:14px; font-weight:600; letter-spacing:.02em;
  color:var(--ink-soft); text-decoration:none; padding:16px 14px 14px;
  border-bottom:2px solid transparent; margin-bottom:-2px;
  transition:color .15s ease, background .15s ease, border-color .15s ease;}
.subnav a:hover{color:var(--ink); background:var(--paper-2);}
.subnav a.active{color:var(--accent); border-bottom-color:var(--accent);}

/* sections */
.block{padding:46px 0; border-bottom:1px solid var(--rule); scroll-margin-top:54px;}
.sec-head{max-width:62ch; margin-bottom:26px;}
.kicker{font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); font-weight:700;}
.sec-head h2{font-size:clamp(28px,4.5vw,40px); margin:6px 0 0;}
.standfirst{font-size:16px; color:#3a362d; margin:12px 0 0; line-height:1.55;}
.note{font-size:13px; color:var(--ink-soft); margin:18px 0 0; font-style:italic; max-width:64ch;}
/* editorial chart annotations — the text list under a chart, paired with the
   dashed on-chart reference lines. */
.chart-notes{list-style:none; margin:10px 0 0; padding:0; max-width:66ch; border-left:3px solid var(--rule);}
.chart-notes li{font-size:13px; color:#3a362d; line-height:1.5; padding:3px 0 3px 12px;}
.chart-notes li b{color:var(--accent); font-variant-numeric:tabular-nums;}
.chart-note-src{color:var(--accent); text-decoration:none; font-weight:700;}
.muted{color:var(--ink-soft);}
.load{padding:90px 0; font-size:16px; color:var(--ink-soft);}

/* toggle */
.toggle{display:inline-flex; border:1px solid var(--ink); margin-bottom:24px;}
.toggle button{font-family:var(--sans); font-size:13px; font-weight:600; padding:7px 20px;
  background:var(--paper); color:var(--ink); border:none; cursor:pointer;
  transition:background .18s ease, color .18s ease;}
.toggle button.on{background:var(--ink); color:var(--paper);}
.toggle button:first-child{border-right:1px solid var(--ink);}

/* bars */
.bars{display:flex; flex-direction:column; gap:2px;}
.bar-row{display:grid; grid-template-columns:1.6fr 3fr 56px auto 42px 72px; align-items:center; gap:14px;
  padding:9px 0; border-bottom:1px solid var(--rule); animation:rise .5s both ease-out;}
.bar-label{font-size:14px; font-weight:500;}
.bar-track{height:14px; background:var(--paper-2);}
.bar-fill{height:100%; background:var(--accent); transform-origin:left; animation:grow .7s both ease-out;}
.spark{display:block;}
.bar-row.no-spark{grid-template-columns:1.6fr 3fr auto 42px 72px;}
.bar-val{font-size:14px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right;}
.bar-share{font-size:13px; color:var(--ink-soft); text-align:right; font-variant-numeric:tabular-nums;}
.bar-delta{font-size:12px; text-align:right;}
.delta{display:inline-flex; align-items:center; gap:1px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap;}

/* tax bill — property-tax-by-jurisdiction split (City body) */
.taxbar{display:flex; height:46px; margin-top:6px; border:1px solid var(--ink); position:relative;}
.taxbar-seg{display:flex; align-items:center; justify-content:center; color:#fff; min-width:0; cursor:default;
  font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; animation:grow .6s both ease-out; transform-origin:left;}
.taxbar-tip{position:absolute; bottom:calc(100% + 9px); transform:translateX(-50%); z-index:10;
  background:var(--ink); color:var(--paper); padding:8px 12px; border-radius:3px; white-space:nowrap;
  font-size:12px; pointer-events:none; box-shadow:0 3px 10px rgba(28,26,22,.22);}
.taxbar-tip .tip-year{font-family:var(--serif); font-weight:700; font-size:13px; margin-bottom:3px;}
.jrows{margin-top:20px; border-top:2px solid var(--ink);}
.jrow{display:grid; grid-template-columns:16px 1fr 96px 50px; align-items:center; gap:12px;
  padding:11px 2px; border-bottom:1px solid var(--rule); font-size:14px; font-variant-numeric:tabular-nums;}
.jrow-sw{width:12px; height:12px; border-radius:2px;}
.jrow-name{font-weight:500;}
.jrow-amt,.jrow-share{text-align:right;}
.jrow-amt{font-weight:600;}
.jrow.total{font-weight:700; border-bottom:none; border-top:1px solid var(--ink); margin-top:2px;}
/* Clickable jurisdiction rows in the complete-bill overview drill through to that
   government's page. */
.jrow.go{cursor:pointer; transition:background .12s ease;}
.jrow.go:hover{background:var(--paper-2);}
.jrow.go:focus-visible{outline:2px solid var(--accent); outline-offset:-2px;}
.jrow-go{display:inline-flex; align-items:center; gap:2px; margin-left:9px; font-size:11px; font-weight:700;
  letter-spacing:.04em; text-transform:uppercase; color:var(--accent); opacity:0; transition:opacity .12s ease;}
.jrow.go:hover .jrow-go, .jrow.go:focus-visible .jrow-go{opacity:1;}
@media (hover:none){ .jrow-go{opacity:.85;} }

/* money-flow Sankey — fits on desktop; scrolls horizontally only when too narrow */
.sankey-scroll{overflow-x:auto; overflow-y:hidden; -webkit-overflow-scrolling:touch;}
.sankey-inner{width:100%; min-width:640px;}

/* tax-bill calculator */
.calc{display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:18px;
  margin:0 0 24px; padding:20px 22px; background:var(--paper-2); border:1px solid var(--rule);}
.calc-input{display:flex; flex-direction:column; gap:7px;}
.calc-input label{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); font-weight:700;}
.calc-field{display:flex; align-items:center; gap:4px; background:var(--paper); border:1px solid var(--ink); padding:6px 12px;}
.calc-field span{font-family:var(--serif); font-size:24px; font-weight:600; color:var(--ink-soft);}
.calc-field input{font-family:var(--serif); font-size:28px; font-weight:600; color:var(--ink); background:transparent;
  border:none; outline:none; width:7ch; letter-spacing:-0.01em; font-variant-numeric:tabular-nums;}
.calc-out{display:flex; flex-direction:column; gap:5px; text-align:right;}
.calc-out-label{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); font-weight:700;}
.calc-out-val{font-family:var(--serif); font-size:clamp(34px,4.5vw,46px); font-weight:600; line-height:1; color:var(--accent); letter-spacing:-0.02em;}

/* callout (e.g. the levy-ceiling note) */
.callout{margin-top:26px; padding:18px 22px; background:var(--paper-2); border-left:3px solid var(--neg);}
.callout-title{font-family:var(--serif); font-size:19px; font-weight:600; letter-spacing:-0.01em; margin-bottom:7px;}
.callout p{font-size:15px; color:#3a362d; line-height:1.55; margin:0; max-width:66ch;}

/* mill-rate bridge (the year-over-year rate walk, inside a callout) */
.bridge{margin-top:10px; max-width:46ch;}
.bridge-row{display:flex; justify-content:space-between; gap:16px; padding:5px 0; font-size:14px;
  font-family:var(--sans); border-bottom:1px solid var(--rule);}
.bridge-row span:first-child{color:#3a362d;}
.bridge-row b{font-variant-numeric:tabular-nums;}
.bridge-delta{font-variant-numeric:tabular-nums; font-weight:600;}
.bridge-row.total{border-bottom:none; border-top:2px solid var(--ink); margin-top:2px; padding-top:8px; font-weight:600;}

/* growth bars (TIF valuation growth) */
.gbars{border-top:2px solid var(--ink); margin-top:4px;}
.gbar{display:grid; grid-template-columns:108px 1fr 70px; align-items:center; gap:14px;
  padding:11px 2px; border-bottom:1px solid var(--rule);}
.gbar-name{font-size:14px; font-weight:600;}
.gbar-track{height:14px; background:var(--paper-2);}
.gbar-track i{display:block; height:100%; background:var(--accent); transform-origin:left; animation:grow .6s both ease-out;}
.gbar-val{text-align:right; font-size:14px; font-weight:600; font-variant-numeric:tabular-nums;}
.tif-pays{display:flex; flex-direction:column; gap:8px; margin-top:22px;}
.tif-pay{font-size:14px; padding:11px 14px; background:var(--paper-2); border-left:3px solid var(--accent);}
.tif-pay span{color:var(--ink-soft);}

/* workforce department picker */
.wf-pick{display:flex; flex-wrap:wrap; gap:8px; margin-bottom:22px;}
.wf-chip{font-family:var(--sans); font-size:13px; font-weight:600; padding:6px 14px; cursor:pointer;
  background:var(--paper); color:var(--ink-soft); border:1px solid var(--rule); border-radius:18px;
  transition:color .12s ease, background .12s ease, border-color .12s ease;}
.wf-chip:hover{color:var(--ink); border-color:var(--ink-soft);}
.wf-chip.on{background:var(--ink); color:var(--paper); border-color:var(--ink);}

/* methodology & open data */
.method{margin:6px 0 0; padding:0 0 0 22px; max-width:66ch;}
.method li{font-size:15px; color:#3a362d; line-height:1.55; margin-bottom:11px;}
.downloads{display:flex; flex-wrap:wrap; gap:12px; margin-top:26px;}
.dl-btn{display:inline-flex; align-items:center; font-family:var(--sans); font-size:13px; font-weight:600;
  padding:10px 18px; border:1px solid var(--ink); background:var(--ink); color:var(--paper);
  text-decoration:none; cursor:pointer; transition:background .15s ease, color .15s ease;}
.dl-btn:hover{background:transparent; color:var(--ink);}

/* "What changed this year" lead band (between masthead and section nav) */
.whatchanged{margin:22px 0 2px; padding:18px 22px; background:var(--paper-2); border:1px solid var(--rule);}
.wc-head{font-family:var(--sans); font-size:12px; font-weight:700; letter-spacing:.14em;
  text-transform:uppercase; color:var(--accent); margin-bottom:14px;}
.wc-grid{display:grid; grid-template-columns:repeat(3,1fr); gap:20px;}
.wc-item{display:flex; flex-direction:column; gap:4px; min-width:0;}
.wc-label{font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); font-weight:700;}
.wc-value{font-family:var(--serif); font-size:clamp(19px,2.3vw,25px); font-weight:600; line-height:1.12;
  color:var(--ink); letter-spacing:-0.01em;}
.wc-meta{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px; margin-top:1px;}
.wc-note{color:var(--ink-soft);}
@media (max-width:620px){ .wc-grid{grid-template-columns:1fr; gap:14px;} }

/* suite cross-link to the Central Wisconsin Meeting Tracker */
.suite-link{display:flex; align-items:center; gap:14px; margin-top:24px; padding:15px 20px;
  background:var(--paper-2); border-left:3px solid var(--accent); text-decoration:none; color:var(--ink);
  transition:background .15s ease;}
.suite-link:hover{background:rgba(22,88,74,.07);}
.suite-link__icon{font-size:22px; flex-shrink:0; line-height:1;}
.suite-link span{font-size:14px; line-height:1.5;}
.suite-link span b{color:var(--accent);}
.suite-link__arrow{flex-shrink:0; color:var(--accent); margin-left:auto;}

/* ---------- suite landing page ---------- */
.lp-hero{padding-bottom:24px;}
.lp-hook{display:flex; align-items:center; justify-content:space-between; gap:16px; width:100%;
  margin:22px 0 0; padding:16px 22px; text-align:left; cursor:pointer; font-family:var(--serif);
  font-size:clamp(16px,2vw,20px); line-height:1.4; color:var(--ink);
  background:var(--paper-2); border:1px solid var(--rule); border-left:3px solid var(--accent);
  transition:background .15s ease;}
.lp-hook:hover{background:rgba(22,88,74,.07);}
.lp-hook-cta{display:inline-flex; align-items:center; gap:5px; flex-shrink:0; font-family:var(--sans);
  font-size:13px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; color:var(--accent);}
.lp-cards{display:grid; grid-template-columns:repeat(auto-fit, minmax(232px, 1fr)); gap:16px; margin-top:34px;}
.lp-card{display:flex; flex-direction:column; align-items:flex-start; gap:9px; text-align:left;
  padding:22px 22px 20px; background:var(--paper); border:1px solid var(--ink); cursor:pointer;
  transition:transform .12s ease, box-shadow .15s ease;}
.lp-card:hover{transform:translateY(-3px); box-shadow:0 8px 22px rgba(28,26,22,.12);}
.lp-card-mark{width:48px; height:48px; display:flex; align-items:center; justify-content:center; color:var(--accent);}
.lp-card-mark img{width:48px; height:48px; object-fit:contain;}
.lp-card-name{font-family:var(--serif); font-size:21px; font-weight:600; letter-spacing:-0.01em; line-height:1.15;}
.lp-card-stat{font-variant-numeric:tabular-nums;}
.lp-card-stat b{font-family:var(--serif); font-size:26px; font-weight:600; color:var(--accent); letter-spacing:-0.02em;}
.lp-card-stat span{font-size:12px; letter-spacing:.04em; text-transform:uppercase; color:var(--ink-soft); font-weight:700;}
.lp-card-desc{font-size:14px; color:#3a362d; line-height:1.5; margin:2px 0 0; flex:1;}
.lp-card-cta{display:inline-flex; align-items:center; gap:5px; margin-top:6px; font-family:var(--sans);
  font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--accent);}
.lp-credibility{margin-top:40px; padding-top:6px; border-top:2px solid var(--ink);}
.lp-credibility .note{margin-top:16px; font-style:normal; font-size:14px; color:#3a362d; max-width:72ch;}

/* accessibility: visible focus + respect reduced-motion */
.ftm a:focus-visible, .ftm button:focus-visible, .ftm input:focus-visible, .ftm select:focus-visible{
  outline:2px solid var(--accent); outline-offset:2px;}
.chrome-bar a:focus-visible, .chrome-bar button:focus-visible{outline:2px solid #fff; outline-offset:2px;}
@media (prefers-reduced-motion: reduce){
  html{scroll-behavior:auto;}
  .ftm *, .ftm *::before, .ftm *::after{animation-duration:.001ms !important; transition-duration:.001ms !important;}
}

/* ledger / departments */
.ledger{border-top:2px solid var(--ink);}
.ledger-head{display:grid; grid-template-columns:2.4fr 1.1fr 1fr 1.1fr .8fr 24px; gap:12px;
  padding:10px 8px; border-bottom:1px solid var(--rule);}
.ledger-head button{font-family:var(--sans); font-size:11px; letter-spacing:.06em; text-transform:uppercase;
  font-weight:700; color:var(--ink-soft); background:none; border:none; cursor:pointer; text-align:right; padding:0;}
.ledger-head button:first-child{text-align:left;}
.ledger-head button.sorted{color:var(--accent);}
.ledger-head button:hover{color:var(--ink);}
.ledger-item{border-bottom:1px solid var(--rule);}
.ledger-item.open{background:var(--paper-2);}
.ledger-row{display:grid; grid-template-columns:2.4fr 1.1fr 1fr 1.1fr .8fr 24px; gap:12px; width:100%;
  align-items:center; padding:13px 8px; background:none; border:none; cursor:pointer; text-align:right;
  font-family:var(--sans); color:var(--ink); font-size:15px;}
.ledger-row:hover{background:var(--paper-2);}
.d-name{display:flex; flex-direction:column; align-items:flex-start; gap:5px; text-align:left; font-weight:600;}
.d-spark{width:120px; max-width:40vw; height:3px; background:var(--rule);}
.d-spark span{display:block; height:100%; background:var(--accent);}
.d-spend{font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap;}
.d-pers,.d-levy{font-variant-numeric:tabular-nums; color:#3a362d; white-space:nowrap;}
.d-change{font-size:13px;}
.chev-col{display:flex; justify-content:flex-end;}
.chev{color:var(--ink-soft); transition:transform .2s;}
.ledger-item.open .chev{transform:rotate(180deg);}

.detail{padding:6px 8px 22px; animation:rise .35s both ease-out;}
.detail-grid{display:grid; grid-template-columns:1fr 1fr; gap:30px; max-width:680px;}
.balance{border-top:1px solid var(--ink);}
.balance-title{font-size:11px; letter-spacing:.08em; text-transform:uppercase; font-weight:700;
  color:var(--accent); padding:8px 0;}
.balance-row{display:flex; justify-content:space-between; padding:7px 0; font-size:14px;
  border-bottom:1px solid var(--rule); font-variant-numeric:tabular-nums;}
.balance-row span:first-child{color:#3a362d;}
.balance-row.total{font-weight:700; border-bottom:none; border-top:1px solid var(--ink); margin-top:2px;}
.balance-row.total span:first-child{color:var(--ink);}
.detail-note{font-size:13px; color:var(--ink-soft); margin:16px 0 0; max-width:62ch; font-style:italic;}

/* chart */
.chart-wrap{margin-top:6px;}
.chart-legend{display:flex; gap:22px; font-size:13px; color:#3a362d; margin-bottom:12px; flex-wrap:wrap;}
.sw{display:inline-block; width:14px; height:3px; vertical-align:middle; margin-right:6px;}
.sw-rate{background:var(--accent);}
.sw-bill{background:var(--gold);}
.sw-levy{background:var(--gold);}
.sw-old{background:var(--gold); opacity:.7;}
.sw-new{background:var(--accent);}
.subhead{font-family:var(--serif); font-size:21px; font-weight:600; margin:0 0 14px; letter-spacing:-0.01em;}

/* department comparison — Amounts (grouped 2-year bars) */
.cmp{display:flex; flex-direction:column; margin-top:4px; border-top:2px solid var(--ink);}
.cmp-row{padding:13px 0; border-bottom:1px solid var(--rule);}
.cmp-head{display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:8px;}
.cmp-name{font-size:14px; font-weight:600;}
.cmp-delta{display:inline-flex; align-items:baseline; gap:8px; font-size:12px; white-space:nowrap;}
.cmp-pct{font-size:11px; color:var(--ink-soft); font-variant-numeric:tabular-nums;}
.cmp-bar{display:grid; grid-template-columns:24px 1fr 108px; align-items:center; gap:10px; margin-top:4px;}
.cmp-yr{font-size:11px; color:var(--ink-soft); font-variant-numeric:tabular-nums; text-align:right;}
.cmp-track{height:13px; background:var(--paper-2);}
.cmp-fill{display:block; height:100%; transform-origin:left; animation:grow .6s both ease-out;}
.cmp-fill.old{background:var(--gold); opacity:.7;}
.cmp-fill.new{background:var(--accent);}
.cmp-val{font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap;}

/* department comparison — Change (diverging bars) */
.chg{display:flex; flex-direction:column; margin-top:8px; border-top:2px solid var(--ink);}
.chg-row{display:grid; grid-template-columns:1.5fr 1.9fr 96px; align-items:center; gap:12px;
  padding:9px 0; border-bottom:1px solid var(--rule);}
.chg-name{font-size:13px; font-weight:500;}
.chg-track{position:relative; height:15px; background:var(--paper-2);}
.chg-track::before{content:''; position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:var(--ink-soft); opacity:.55;}
.chg-fill{position:absolute; top:0; bottom:0; animation:grow .6s both ease-out;}
.chg-fill.up{left:50%; background:var(--neg); transform-origin:left;}
.chg-fill.down{right:50%; background:var(--pos); transform-origin:right;}
.chg-val{font-size:12px; text-align:right;}
.tip{background:var(--ink); color:var(--paper); padding:10px 12px; font-size:13px; border-radius:2px;}
.tip-year{font-weight:700; font-family:var(--serif); margin-bottom:4px;}
.tip i{margin-right:5px;}

/* funds */
.fund-table{border-top:2px solid var(--ink);}
.fund-head{display:grid; grid-template-columns:2.4fr 1fr 1fr 1fr; gap:12px; padding:10px 8px;
  border-bottom:1px solid var(--rule); font-size:11px; letter-spacing:.06em; text-transform:uppercase;
  font-weight:700; color:var(--ink-soft); text-align:right;}
.fund-head span:first-child{text-align:left;}
.fund-row{display:grid; grid-template-columns:2.4fr 1fr 1fr 1fr; gap:12px; padding:12px 8px;
  border-bottom:1px solid var(--rule); font-size:14px; text-align:right; font-variant-numeric:tabular-nums;}
.fund-row:hover{background:var(--paper-2);}
.f-name{text-align:left; display:flex; flex-direction:column;}
.f-name b{font-weight:600;}
.f-name em{font-style:normal; font-size:11px; color:var(--ink-soft);}

/* debt */
.debt-list{display:flex; flex-direction:column; gap:3px; border-top:2px solid var(--ink); padding-top:10px;}
.debt-row{position:relative; display:flex; justify-content:space-between; align-items:center;
  padding:11px 12px; font-size:14px; overflow:hidden;}
.db-bar{position:absolute; left:0; top:0; bottom:0; background:var(--paper-2); z-index:0;}
.db-name,.db-val{position:relative; z-index:1;}
.db-name{font-weight:500;}
.db-val{font-weight:600; font-variant-numeric:tabular-nums;}

/* footer */
.foot{padding:34px 0 0; font-size:13px; color:#3a362d; max-width:70ch;}
.foot p{margin:0 0 8px;}

@keyframes grow{from{transform:scaleX(0);}to{transform:scaleX(1);}}
@keyframes rise{from{opacity:0; transform:translateY(8px);}to{opacity:1; transform:translateY(0);}}

.sm-only{display:none;}

@media(max-width:680px){
  .ftm{padding:0 16px 60px;}
  .hide-sm{display:none !important;}
  .lg-only{display:none;}
  .sm-only{display:inline;}
  .stat-strip{grid-template-columns:1fr;}
  .stat{padding:26px 20px 22px;}
  .stat-icon{font-size:30px; margin-bottom:10px;}
  /* tabs: a clean swipeable single row instead of a ragged wrap */
  .subnav{flex-wrap:nowrap; justify-content:flex-start; overflow-x:auto;
    scrollbar-width:none; -webkit-overflow-scrolling:touch;}
  .subnav::-webkit-scrollbar{display:none;}
  .subnav a{flex:0 0 auto; white-space:nowrap;}
  .bar-row, .bar-row.no-spark{grid-template-columns:1.4fr 2fr auto 56px; }
  .bar-share{display:none;}
  .ledger-head,.ledger-row{grid-template-columns:2fr 1fr 1fr 22px;}
  .detail-grid{grid-template-columns:1fr; gap:18px;}
  .fund-head,.fund-row{grid-template-columns:2fr 1fr 1fr;}
}
`;
