import React, { useState, useEffect, useRef } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useStrings } from "./i18n";
import sponsors from "./sponsors.json";
import { usd, compact, pct, downloadCSV } from "./format";
import { consumePendingSection } from "./nav";
import marathonLogo from "./assets/marathon-county.jpg";
import wausauLogo from "./assets/wausau-city.jpg";
import schoolLogo from "./assets/wausau-school.jpg";

// Per-entity logos, keyed by manifest id (used in the chrome-bar switcher and
// the masthead). Square-format marks — shown whole (object-fit:contain), not
// circle-cropped. The three avatars are the same marks used in the Central
// Wisconsin Meeting Tracker, kept consistent across the WPR civic suite.
export const ENTITY_LOGOS = {
  "marathon-county": marathonLogo,
  "wausau-city": wausauLogo,
  "wausau-school": schoolLogo,
};

// Jurisdiction colors for the "your tax bill" split, sorted by rate
// descending: accent, gold, rust, slate.
export const JURIS_COLORS = ["#16584a", "#9a7b2e", "#a8492f", "#3d5a80"];

// Companion civic-transparency tool — the budgets adopted here are debated and
// voted in the meetings the tracker covers.
export const MEETING_TRACKER_URL = "https://rowanflynnpilot.github.io/marathon-meetings/";

/* ---------- hooks ---------- */

// Position the viewport when a body (or the landing page) mounts: a deep-
// linked section jumps straight to its target, anything else starts at the
// top. Instant, not smooth — smooth programmatic scrolls are unreliably
// canceled by chart reflows. The ref guards StrictMode's double-run.
export function useAnchorOnMount() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const section = consumePendingSection();
    const el = section && document.getElementById(section);
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
}

// Scroll-spy: returns the id of the section near mid-viewport, and mirrors it
// into the URL via replaceState (no history entry, no hashchange) so the
// address bar always holds a valid "#<entity>/<section>" deep link.
export function useScrollSpy(sectionIds, entityId) {
  const [active, setActive] = useState(sectionIds[0]);
  useEffect(() => {
    const els = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          setActive(e.target.id);
          history.replaceState(null, "", "#" + entityId + "/" + e.target.id);
        }
      }),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  return active;
}

/* ---------- small building blocks ---------- */

export function Delta({ value, invertColor = false, money = false, exact = false }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  // A directional arrow on "no change" reads as a glitch — render zero neutral.
  if (value === 0) return <span className="delta muted">{money ? "$0" : pct(0)}</span>;
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

export function SectionHead({ kicker, title, children }) {
  return (
    <header className="sec-head">
      <div className="kicker">{kicker}</div>
      <h2>{title}</h2>
      {children && <p className="standfirst">{children}</p>}
    </header>
  );
}

export function Stat({ icon, label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-icon" aria-hidden="true">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Balance({ title, rows, total }) {
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

// Inline 3-point trajectory sparkline (pure SVG — no chart lib needed).
export function Spark({ values, tone, className = "" }) {
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

// "What changed this year" lead band — a few auto-computed highlights rendered
// between the masthead and the section nav. Each body passes its own
// data-appropriate items: { label, value, delta?, invert?, money?, exact?, note? }.
export function Highlights({ items }) {
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

// Section nav with scroll-spy highlight; links carry "#<entity>/<section>" so
// they never destroy the entity deep-link.
export function SubNav({ sections, active, entityId }) {
  const t = useStrings();
  return (
    <nav className="subnav">
      {sections.map((id) => (
        <a key={id} href={"#" + entityId + "/" + id} className={active === id ? "active" : ""}>{t("nav." + id)}</a>
      ))}
    </nav>
  );
}

/* ---------- annotations ---------- */

// Resolve editorial chart annotations for one entity+chart into the active
// language. Returns [] when none — charts render unchanged without them.
export function resolveNotes(chrome, lang, chartId) {
  const list = (chrome.annotations && chrome.annotations[chrome.activeId] && chrome.annotations[chrome.activeId][chartId]) || [];
  return list.map((a) => ({ x: a.x, tag: (a.tag && (a.tag[lang] || a.tag.en)) || "", note: (a.note && (a.note[lang] || a.note.en)) || "", source: a.source || null }));
}

// The text companion to the on-chart reference lines: a short list beneath the
// chart with each marker's year, plain-language note, and source link.
export function ChartNotes({ notes }) {
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

/* ---------- sponsor surface ---------- */

// A tasteful "Presented by" line in the masthead kicker row. Driven by
// src/sponsors.json; renders NOTHING while sponsors.enabled is false (the
// surface is built but hidden). A per-entity sponsor overrides the suite-wide
// title sponsor. Clearly labeled and rel="sponsored"; never interleaved with data.
export function SponsorSlot({ entityId }) {
  const t = useStrings();
  if (!sponsors.enabled) return null;
  const s = (entityId && sponsors.byEntity && sponsors.byEntity[entityId]) || sponsors.title;
  if (!s || !s.name) return null;
  const logo = s.logo ? (s.logo.startsWith("http") ? s.logo : import.meta.env.BASE_URL + s.logo) : null;
  const inner = (
    <>
      <span className="sponsor-slot__label">{t("sponsor.presentedBy")}</span>
      {logo ? <img className="sponsor-slot__logo" src={logo} alt={s.name} /> : <span className="sponsor-slot__name">{s.name}</span>}
    </>
  );
  return s.url
    ? <a className="sponsor-slot" href={s.url} target="_blank" rel="noopener noreferrer sponsored">{inner}</a>
    : <span className="sponsor-slot">{inner}</span>;
}

/* ---------- per-capita divisor toggle ---------- */

// Total / per-resident / per-household chips for the "Where It Goes" bars
// (County + City; the School body already shows per-student figures).
export function DivisorToggle({ divisor, onChange }) {
  const t = useStrings();
  const opts = [["total", "pc.total"], ["resident", "pc.perResident"], ["household", "pc.perHousehold"]];
  return (
    <div className="toggle" role="group" aria-label="Amount basis" style={{ marginLeft: 10 }}>
      {opts.map(([key, label]) => (
        <button key={key} aria-pressed={divisor === key} className={divisor === key ? "on" : ""}
          onClick={() => onChange(key)}>{t(label)}</button>
      ))}
    </div>
  );
}

/* ---------- tax-bill building blocks ---------- */

// The home value persists across bodies and sessions (localStorage only —
// never in URLs or shares), so a reader who typed their home's value into one
// calculator finds it waiting in the others.
const HOME_VALUE_KEY = "wpr-budget-homeval";
export function useHomeValue() {
  const [value, setValue] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(HOME_VALUE_KEY), 10);
      if (saved > 0) return saved;
    } catch (e) { /* localStorage unavailable */ }
    return 200000;
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(HOME_VALUE_KEY, String(v)); } catch (e) { /* ignore */ }
  };
  return [value, set];
}

// The "what's your home worth" input + estimated-bill output. Controlled: the
// body owns the value because the tax split below derives from it too.
export function HomeValueCalc({ id, label, outLabel, outValue, value, onChange }) {
  return (
    <div className="calc">
      <div className="calc-input">
        <label htmlFor={id}>{label}</label>
        <div className="calc-field">
          <span>$</span>
          <input id={id} type="text" inputMode="numeric" value={value.toLocaleString("en-US")}
            onChange={(e) => onChange(Math.min(parseInt(e.target.value.replace(/[^\d]/g, "")) || 0, 99999999))} />
        </div>
      </div>
      <div className="calc-out">
        <span className="calc-out-label">{outLabel}</span>
        <span className="calc-out-val">{outValue}</span>
      </div>
    </div>
  );
}

// Stacked tax-split bar + per-row table. rows: [{ key, label, rate, drillId? }]
// with rate per $1,000 of home value; rows with a drillId become clickable
// when onDrill is provided (the complete-bill overview). Hover state is local,
// so mousemove re-renders only this component — not the chart-heavy body.
export function TaxSplit({ rows, total, homeValue, totalLabel, exploreLabel, onDrill }) {
  const [tip, setTip] = useState(null);
  const barRef = useRef(null);
  return (
    <>
      <div className="taxbar" ref={barRef} onMouseLeave={() => setTip(null)}>
        {rows.map((r, i) => {
          const share = (r.rate / total) * 100;
          return (
            <div className="taxbar-seg" key={r.key}
              style={{ width: share + "%", background: JURIS_COLORS[i % JURIS_COLORS.length] }}
              onMouseMove={(e) => {
                const rect = barRef.current.getBoundingClientRect();
                setTip({ i, x: e.clientX - rect.left, w: rect.width });
              }}>
              {share > 9 ? Math.round(share) + "%" : ""}
            </div>
          );
        })}
        {tip && (() => {
          const r = rows[tip.i];
          const share = (r.rate / total) * 100;
          return (
            <div className="taxbar-tip" style={{ left: Math.max(90, Math.min(tip.x, tip.w - 90)) }}>
              <div className="tip-year">{r.label}</div>
              <div>{usd(Math.round((homeValue / 1000) * r.rate))} &middot; {share.toFixed(1)}% &middot; ${r.rate.toFixed(2)}/$1k</div>
            </div>
          );
        })()}
      </div>
      <div className="jrows">
        {rows.map((r, i) => {
          const go = !!(r.drillId && onDrill);
          return (
            <div key={r.key} className={"jrow" + (go ? " go" : "")}
              {...(go ? {
                role: "button", tabIndex: 0, onClick: () => onDrill(r.drillId),
                onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDrill(r.drillId); } },
              } : {})}>
              <span className="jrow-sw" style={{ background: JURIS_COLORS[i % JURIS_COLORS.length] }} />
              <span className="jrow-name">
                {r.label}
                {go && <span className="jrow-go">{exploreLabel} <ArrowUpRight size={12} strokeWidth={2.5} /></span>}
              </span>
              <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * r.rate))}</span>
              <span className="jrow-share">{((r.rate / total) * 100).toFixed(0)}%</span>
            </div>
          );
        })}
        <div className="jrow total">
          <span className="jrow-sw" />
          <span className="jrow-name">{totalLabel}</span>
          <span className="jrow-amt">{usd(Math.round((homeValue / 1000) * total))}</span>
          <span className="jrow-share">100%</span>
        </div>
      </div>
    </>
  );
}

/* ---------- methodology ---------- */

// Shared methodology + open-data section. The reconcile-against-printed-totals
// point is the core trust signal.
export function Methodology({ b, chrome }) {
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
