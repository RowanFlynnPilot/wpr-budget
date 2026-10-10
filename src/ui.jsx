import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useLang, useStrings } from "./i18n";
import sponsors from "./sponsors.json";
import RAMP from "./map-ramp.json";
import { usd, compact, pct, downloadCSV, fmtDate } from "./format";
import { consumePendingSection } from "./nav";
import { track, currentView } from "./analytics";
import { billParts, billDollars, netBill, MUNI_KEY } from "./taxmath";
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
export const JURIS_COLORS = ["#16584a", "#7a5f1f", "#a8492f", "#3d5a80"]; // white labels on each: >= 4.5:1

// Companion civic-transparency tool — the budgets adopted here are debated and
// voted in the meetings the tracker covers.
export const MEETING_TRACKER_URL = "https://rowanflynnpilot.github.io/marathon-meetings/";
// Where readers report an error (WPR's contact page) — the Methodology section and the Hmong beta banner link it.
export const CORRECTIONS_URL = "https://wausaupilotandreview.com/contact/";
// WPR's donate, newsletter and sponsorship pages, tagged so WPR's own site
// analytics can credit sign-ups and gifts to this tool.
const fromTool = (url) => `${url}?utm_source=follow-the-money&utm_medium=tool&utm_campaign=support-band`;
export const SUPPORT_URL = fromTool("https://wausaupilotandreview.com/support-our-publication/");
export const NEWSLETTER_URL = fromTool("https://wausaupilotandreview.com/sign-up/");
export const SALES_EMAIL = "weber.chris@wausaupilotandreview.com"; // WPR's one sales address

// The closing band on the landing page, every Methodology section and the About
// page: who built this, and the three ways to keep it going — give, subscribe,
// sponsor. (The sibling City 2027 tool closes with the same band.)
export function SupportBand({ about = true }) {
  const t = useStrings();
  return (
    <aside className="support" aria-labelledby="support-title">
      <h2 id="support-title">{t("support.title")}</h2>
      <p>{t("support.body")}</p>
      <div className="support-actions">
        <a className="support-btn" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("donate")}>{t("support.donate")}</a>
        <a href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("newsletter")}>{t("support.newsletter")}</a>
        <a href="#about/sponsor" onClick={countLink("sponsor")}>{t("support.sponsor")}</a>
        {about && <a href="#about">{t("about.link")}</a>}
      </div>
    </aside>
  );
}

// The view's source document, linked (opens the official PDF / state page).
export function SourceLink({ source, children }) {
  return <a className="source-link" href={source.url} target="_blank" rel="noopener noreferrer" onClick={countLink("source")}>{children}</a>;
}

// onClick for an outbound link: counts which kind of link readers follow
// ("source", "meeting-tracker", "donate" …) from which view.
export const countLink = (to) => () => track("Link", { to, view: currentView() });

/* ---------- hooks ---------- */

// Position the viewport when a body (or the landing page) mounts: a deep-
// linked section jumps straight to its target, anything else starts at the
// top. Instant, not smooth — smooth programmatic scrolls are unreliably
// canceled by chart reflows. The ref guards StrictMode's double-run.
// After the first page load, a view switch also moves keyboard/screen-reader
// focus to the new view's heading (the section's, for a deep link) — otherwise
// focus falls back to <body> and the switch goes unannounced.
let firstView = true;
export function useAnchorOnMount() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const section = consumePendingSection();
    const el = section && document.getElementById(section);
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
    if (!firstView) {
      const heading = (el || document).querySelector(el ? "h2, h3" : "h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
    firstView = false;
  }, []);
}

// Scroll-spy: returns the id of the section near mid-viewport, and mirrors it
// into the URL via replaceState (no history entry, no hashchange) so the
// address bar always holds a valid "#<route>/<section>" deep link (the route
// id carries the edition, e.g. "marathon-county~2027-proposed").
export function useScrollSpy(sectionIds, routeId) {
  const [active, setActive] = useState(sectionIds[0]);
  useEffect(() => {
    const els = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          setActive(e.target.id);
          history.replaceState(null, "", "#" + routeId + "/" + e.target.id);
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

// Color encodes what a change means for taxpayers, and nothing else. On what
// they pay — a levy, a mill rate, a bill — up is red and down is green. On
// spending and revenue (`neutral`), where more is not inherently better or
// worse, the arrow carries the direction in neutral ink.
export function Delta({ value, neutral = false, money = false, exact = false }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  // A directional arrow on "no change" reads as a glitch — render zero neutral.
  if (value === 0) return <span className="delta muted">{money ? "$0" : pct(0)}</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const text = money
    ? sign + (exact ? "$" + Math.abs(value).toLocaleString("en-US") : compact(Math.abs(value)))
    : pct(value);
  return (
    <span className="delta" style={{ color: neutral ? "var(--ink-soft)" : up ? "var(--neg)" : "var(--pos)" }}>
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

// A dollar figure in full on desktop, compact on phones — for stat tiles that sit
// three across on a narrow screen (the full figure is repeated nearby).
export function FullOrCompact({ n }) {
  return <><span className="lg-only">{usd(n)}</span><span className="sm-only">{compact(n)}</span></>;
}

// A mill rate with its unit — "$3.49 / $1,000" — so the number means something
// to a reader who doesn't already know what a mill rate is.
export function MillRate({ rate }) {
  return <>{"$" + rate.toFixed(2)}<span className="stat-unit"> / $1,000</span></>;
}

// The handful of budget words the suite leans on, defined once, in plain
// language, in every Methodology section.
const GLOSSARY = ["levy", "millRate", "fmv", "generalFund", "levyLimit", "tif", "credit"];
export function Glossary() {
  const t = useStrings();
  return (
    <details className="glossary">
      <summary>{t("gloss.title")}</summary>
      <dl>
        {GLOSSARY.map((k) => (
          <div key={k}><dt>{t("gloss." + k)}</dt><dd>{t("gloss." + k + ".def")}</dd></div>
        ))}
      </dl>
    </details>
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
// data-appropriate items: { label, value, delta?, neutral?, money?, exact?, note? }
// (neutral: a spending/revenue figure — see Delta).
// How a series' latest point ranks against the earlier ones, for "What
// changed": { record: true } when it beats every earlier point, { since: label }
// naming the most recent point that matched or beat it, or null when that was
// the point just before (nothing worth saying). points: [{ label, v }], oldest first.
export function rankLast(points, beats) {
  const last = points[points.length - 1];
  const prior = points.slice(0, -1);
  const i = prior.map((p) => !beats(last.v, p.v)).lastIndexOf(true);
  if (i === -1) return { record: true };
  return i === prior.length - 1 ? null : { since: prior[i].label };
}

// rankLast as words: "the largest rise in records back to 2017" / "the lowest since 1999".
export function rankNote(t, rank, from, kind) {
  if (!rank) return undefined;
  return rank.record ? t(`wc.${kind}Record`, from) : t(`wc.${kind}Since`, rank.since);
}

// Year-over-year rises of a [{ year, <key> }] series, for rankLast.
export const risesOf = (series, key) => series.slice(1).map((p, i) => ({ label: p.year, v: p[key] / series[i][key] }));

// A signed compact dollar change: "+$5.0M", "−$120K".
export const signedCompact = (n) => (n >= 0 ? "+" : "\u2212") + compact(Math.abs(n));

export function Highlights({ items, head }) {
  const t = useStrings();
  const shown = (items || []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="whatchanged">
      <div className="wc-head">{head || t("wc.head")}</div>
      <div className="wc-grid">
        {shown.map((it, i) => (
          <div className="wc-item" key={i}>
            <div className="wc-label">{it.label}</div>
            <div className="wc-value">{it.value}</div>
            <div className="wc-meta">
              {it.delta !== undefined && <Delta value={it.delta} neutral={it.neutral} money={it.money} exact={it.exact} />}
              {it.note && <span className="wc-note">{it.note}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Section nav with scroll-spy highlight; links carry "#<route>/<section>" so
// they never destroy the entity (or edition) deep-link.
// For a sideways-scrolling strip (the tab row, the money-flow diagram): which
// edges have more beyond them, as " more-left"/" more-right" classes that the
// .fade-x styles draw as a fade — so a clipped edge reads as "scroll for more",
// not as a mistake. Returns [ref, classes].
export function useEdgeFade() {
  const ref = useRef(null);
  const [cls, setCls] = useState("");
  useEffect(() => {
    const el = ref.current;
    const update = () => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setCls((left ? " more-left" : "") + (right ? " more-right" : ""));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  return [ref, cls];
}

export function SubNav({ sections, active, routeId }) {
  const t = useStrings();
  const [ref, more] = useEdgeFade();
  // Keep the active tab in view when the row scrolls sideways (phones, the
  // nine-tab City bar). Horizontal only: never moves the page.
  useEffect(() => {
    const nav = ref.current;
    const a = nav && nav.querySelector("a.active");
    if (!a || nav.scrollWidth <= nav.clientWidth) return;
    if (a.offsetLeft < nav.scrollLeft || a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: a.offsetLeft - 16, behavior: "instant" });
    }
  }, [active]);
  return (
    <nav className={"subnav fade-x" + more} ref={ref}>
      {sections.map((id) => (
        <a key={id} href={"#" + routeId + "/" + id} className={active === id ? "active" : ""}>{t("nav." + id)}</a>
      ))}
    </nav>
  );
}

// Budget-season edition notice. On a PROPOSED edition: a prominent "not yet
// adopted" band with the hearing/vote dates and a way back to the adopted book.
// On the adopted book of an entity that has a proposed edition out: a slim
// pointer to it. Renders nothing otherwise. Dates are curated in the manifest
// (src/entities.json) from the book's own budget-process timeline.
export function EditionBanner({ chrome, adoptedYear }) {
  const t = useStrings();
  const { lang } = useLang();
  const ent = chrome.entities.find((e) => e.id === chrome.activeId);
  const day = (iso) => fmtDate(iso, lang, false);
  if (chrome.edition) {
    const ed = chrome.edition;
    return (
      <div className="edition edition--proposed" role="note">
        <div className="edition__tag">{t("ed.proposedTag")}</div>
        <p className="edition__body">{t("ed.proposedBody", ed.year, day(ed.hearing), day(ed.vote))}</p>
        <a className="edition__link" href={"#" + chrome.routeId + "/say"}>{t("ed.sayLink")}</a>
        <span className="edition__sep" aria-hidden="true"> · </span>
        <a className="edition__link" href={"#" + ent.id}>{t("ed.backToAdopted", adoptedYear)}</a>
      </div>
    );
  }
  // Next year's proposal covered by a sibling WPR tool (the City's 2027 budget
  // has its own app): point there, on WPR's own page for it.
  if (ent.companion) {
    const c = ent.companion;
    return (
      <a className="edition edition--pointer" href={c.url} target="_blank" rel="noopener noreferrer" onClick={countLink("companion")}>
        <span>{t("ed.companion." + ent.kind, c.year)}</span>
        <ArrowUpRight size={15} strokeWidth={2.5} aria-hidden="true" />
      </a>
    );
  }
  const ed = (ent.editions || [])[0];
  if (!ed) return null;
  return (
    <a className="edition edition--pointer" href={"#" + ent.id + "~" + ed.id}>
      <span>{t("ed.pointer", ed.year, day(ed.hearing))}</span>
      <ArrowUpRight size={15} strokeWidth={2.5} aria-hidden="true" />
    </a>
  );
}

// "Changes since the proposal": what committees and the board have amended
// since the book was presented, logged by hand by WPR's editors in the
// edition's updates file ([{ date, body, summary, url|null }], newest shown
// first). Renders nothing until the file has an entry. Summaries are written in
// English and marked so.
export function ChangesLog({ entries }) {
  const t = useStrings();
  const { lang } = useLang();
  if (!entries || !entries.length) return null;
  const rows = [...entries].sort((a, c) => (a.date < c.date ? 1 : -1));
  return (
    <aside className="changes" aria-labelledby="changes-title">
      <h2 id="changes-title">{t("chg.title")}</h2>
      <ol>
        {rows.map((e, i) => (
          <li key={i}>
            <b>{fmtDate(e.date, lang, false)} · <span lang="en">{e.body}</span></b>{" "}
            <span lang="en">{e.summary}</span>
            {e.url && <> <a href={e.url} target="_blank" rel="noopener noreferrer" onClick={countLink("change-story")}>{t("chg.story")}</a></>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

// "Have your say" — on a PROPOSED edition only: the calendar to the vote (the
// book's own budget-process timeline, curated as the edition's `milestones`),
// and the three ways a resident can act before it: speak at the hearing, reach
// their supervisor before the amendment deadline, get the result. Dates already
// past are checked off by the reader's clock.
export function HaveYourSay({ chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const ent = chrome.entities.find((e) => e.id === chrome.activeId);
  const ed = chrome.edition;
  const go = ent.participate;
  const day = (iso) => fmtDate(iso, lang, false);
  const today = new Date().toISOString().slice(0, 10);
  const amend = ed.milestones.find((m) => m.what === "amendments");
  const out = (href, to, label) => <a href={href} target="_blank" rel="noopener noreferrer" onClick={countLink(to)}>{label}</a>;
  return (
    <section id="say" className="block">
      <SectionHead kicker={t("say.kick")} title={t("say.title")}>{t("say.dek", ed.year, day(ed.vote))}</SectionHead>
      <div className="say">
        <ol className="say-dates">
          {ed.milestones.map((m) => (
            <li key={m.what} className={m.date < today ? "past" : m.what === "hearing" || m.what === "vote" ? "key" : ""}>
              <b>{day(m.date)}</b><span>{t("say.m." + m.what)}</span>
            </li>
          ))}
        </ol>
        <div className="say-acts">
          <p><b>{t("say.speak.lead")}</b> {t("say.speak", day(ed.hearing))} {out(go.agendas, "agendas", t("say.agendaLink"))}</p>
          <p><b>{t("say.contact.lead")}</b> {t("say.contact", day(amend.date))}{" "}
            {out(go.find_supervisor, "find-supervisor", t("say.findLink"))} · {out(go.supervisors, "supervisors", t("say.membersLink"))}</p>
          <p><b>{t("say.follow.lead")}</b> {t("say.follow")}{" "}
            {out(NEWSLETTER_URL, "newsletter", t("support.newsletter"))} · {out(MEETING_TRACKER_URL, "meeting-tracker", t("say.trackerLink"))}</p>
        </div>
      </div>
    </section>
  );
}

// Every chart's accessible twin: the chart itself is one image to assistive
// tech, described by `summary` (the chart's own visible note), and a "Show as
// table" toggle opens the same numbers as a real table — for screen readers,
// keyboard users, and anyone who'd rather read than squint at axes.
// table: { columns: [{ key, label, fmt? }], rows }.
export function ChartFrame({ summary, table, children }) {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const cell = (c, r) => (r[c.key] == null ? "—" : c.fmt ? c.fmt(r[c.key]) : r[c.key]);
  return (
    <div className="chart-frame">
      <div role="img" aria-label={summary}>{children}</div>
      <button type="button" className="table-toggle" aria-expanded={open} onClick={() => { if (!open) track("Chart table", { view: currentView() }); setOpen(!open); }}>
        {t(open ? "chart.hideTable" : "chart.showTable")}
      </button>
      {open && (
        <div className="chart-table-wrap">
          <table className="chart-table">
            <thead><tr>{table.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {table.columns.map((c, j) => (j === 0
                    ? <th key={c.key} scope="row">{cell(c, r)}</th>
                    : <td key={c.key}>{cell(c, r)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
// Sales demo: "?demo" in the URL fills every UNSOLD slot with a "Your business
// here" credit (and ChromeBar shows a ribbon saying it's a preview), so WPR can
// show a prospect their name on the live tool. Sold slots are never replaced;
// readers never see it; Share links drop the query.
export const DEMO = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
export const SPONSOR_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Sponsoring Follow the Money")}`;

export function SponsorSlot({ entityId }) {
  const t = useStrings();
  const s = sponsors.enabled ? (entityId && sponsors.byEntity && sponsors.byEntity[entityId]) || sponsors.title : null;
  if (!s || !s.name) {
    if (!DEMO) return null;
    return (
      <a className="sponsor-slot sponsor-slot--demo" href={SPONSOR_MAILTO}>
        <span className="sponsor-slot__label">{t("sponsor.presentedBy")}</span>
        <span className="sponsor-slot__name">{t("demo.yourBrand")}</span>
      </a>
    );
  }
  const logo = s.logo ? (s.logo.startsWith("http") ? s.logo : import.meta.env.BASE_URL + s.logo) : null;
  const inner = (
    <>
      <span className="sponsor-slot__label">{t("sponsor.presentedBy")}</span>
      {logo ? <img className="sponsor-slot__logo" src={logo} alt={s.name} /> : <span className="sponsor-slot__name">{s.name}</span>}
    </>
  );
  return s.url
    ? <a className="sponsor-slot" href={s.url} target="_blank" rel="noopener noreferrer sponsored"
        onClick={() => track("Sponsor click", { slot: entityId || "landing" })}>{inner}</a>
    : <span className="sponsor-slot">{inner}</span>;
}

/* ---------- per-capita divisor toggle ---------- */

// Total / per-resident / per-household chips for the "Where It Goes" bars
// (County + City; the School body already shows per-student figures).
export function DivisorToggle({ divisor, onChange }) {
  const t = useStrings();
  const opts = [["total", "pc.total"], ["resident", "pc.perResident"], ["household", "pc.perHousehold"]];
  return (
    <div className="toggle" role="group" aria-label={t("aria.amountBasis")} style={{ marginLeft: 10 }}>
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

// ---------- the property-tax bill, for any Marathon County home ----------
//
// Every tax-bill view computes from ONE source — the Wisconsin DOR's Town,
// Village and City Taxes data (public/marathon-tax-districts.json) — on ONE
// basis: per $1,000 of the home's estimated FAIR MARKET value (DOR's "full"
// value; printed on every Wisconsin tax bill as "Est. Fair Mkt."). Assessed
// values aren't comparable across municipalities — assessment ratios here run
// from 0.54 to 1.02 — while the county's and school district's own published
// rates are already per $1,000 of fair market (equalized) value.

export const WAUSAU_CITY_DOR = "37291"; // DOR municipality code: City of Wausau
const SUITE_IDS = { municipality: { "37291": "wausau-city" }, school: { "6223": "wausau-school" } };

// Per-viewer choices, persisted like the home value (localStorage only — never
// in URLs or shares): the municipality and the school district.
function usePersisted(key, initial) {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem(key) || initial; } catch (e) { return initial; }
  });
  const set = (x) => {
    setV(x);
    try { localStorage.setItem(key, x); } catch (e) { /* ignore */ }
  };
  return [v, set];
}
export const useMuniChoice = () => usePersisted(MUNI_KEY, WAUSAU_CITY_DOR);
// For a link that promises a specific municipality's bill (the landing hook).
export function rememberMuni(code) {
  try { localStorage.setItem(MUNI_KEY, code); } catch (e) { /* ignore */ }
}
// The school district is remembered PER municipality — a pick made for one
// town must never pre-select a district on another town's (or the City page's) bill.
const SCHOOLS_KEY = "wpr-budget-schools";
export function useSchoolChoice(muniCode) {
  const [byMuni, setByMuni] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SCHOOLS_KEY)) || {}; } catch (e) { return {}; }
  });
  const set = (code) => {
    const next = { ...byMuni, [muniCode]: code };
    setByMuni(next);
    try { localStorage.setItem(SCHOOLS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  };
  return [byMuni[muniCode] || "", set];
}

// The bill rates for a home in municipality `muni`, school district `code`
// (the municipality's largest district if `code` isn't one of its own); the
// formula itself is billParts in src/taxmath.js.
// A town split between two technical college districts gets their combined
// levy over the whole town (DOR doesn't split it by college) — flagged
// `collegeAveraged` so the view can say so. Rows carry the suite entity to
// drill into, where one exists.
export function billRates(muni, code) {
  const sd = muni.school_districts.find((s) => s.code === code) || muni.school_districts[0];
  const part = billParts(muni, sd);
  const where = `${muni.type} of ${muni.name}`;
  const rows = [
    { key: "county", label: "Marathon County", rate: part.county, drillId: "marathon-county" },
    { key: "municipality", label: where, rate: part.municipality, drillId: SUITE_IDS.municipality[muni.code] || null },
    { key: "school", label: `${sd.name} School District (net)`, rate: part.school, drillId: SUITE_IDS.school[sd.code] || null },
    { key: "college", label: muni.technical_colleges.map((c) => c.name).join(" / "), rate: part.college, drillId: null },
  ];
  return {
    rows,
    total: rows.reduce((s, r) => s + r.rate, 0),
    where,
    school: sd,
    collegeAveraged: muni.technical_colleges.length > 1,
    schoolOptions: muni.school_districts.length > 1 ? muni.school_districts : null,
  };
}

// The cheapest and dearest place in the county for the same home: every
// municipality x school district pairing, by the bill after the state's
// credits, in dollars. Each: { m, sd, bill }.
export function billExtremes(municipalities, credits, value, primaryHome = true) {
  const all = municipalities.flatMap((m) => m.school_districts.map((sd) => ({ m, sd, bill: netBill(m, sd, credits, value, primaryHome) })));
  all.sort((a, c) => a.bill - c.bill);
  return { lo: all[0], hi: all[all.length - 1] };
}

// The county map's shading: one continuous ramp, light (lowest bill) to dark
// (highest) — f in [0, 1]. The stops live in src/map-ramp.json, which the share
// card (scripts/og_cards.py) reads too, so the card and the page shade alike.
export { RAMP };
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function rampColor(f) {
  const x = Math.min(1, Math.max(0, f)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const [a, b] = [rgbOf(RAMP[i]), rgbOf(RAMP[i + 1])];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * (x - i))).join(",")})`;
}

// Marathon County's municipalities as one SVG image (public/marathon-map.json):
// each shape filled by fill(code), the county outline over them, then children.
// shapeProps(shape) adds a shape's handlers where the map is interactive.
export function CountyShapes({ map, fill, label, shapeProps, children }) {
  return (
    <svg viewBox={`0 0 ${map.meta.width} ${map.meta.height}`} role="img" aria-label={label}>
      {map.shapes.map((s) => <path key={s.code} className="cmap-shape" d={s.d} fill={fill(s.code)} {...(shapeProps && shapeProps(s))} />)}
      <path className="cmap-outline" d={map.outline} />
      {children}
    </svg>
  );
}

// Is the home the owner's primary residence? Only then does the lottery &
// gaming credit apply (a business, rental or cabin gets the first-dollar credit
// alone). Remembered like the home value — this browser only, never in a URL.
const PRIMARY_KEY = "wpr-budget-primary";
export function usePrimaryHome() {
  const [v, setV] = useState(() => {
    try { return localStorage.getItem(PRIMARY_KEY) !== "0"; } catch (e) { return true; }
  });
  const set = (x) => {
    setV(x);
    try { localStorage.setItem(PRIMARY_KEY, x ? "1" : "0"); } catch (e) { /* ignore */ }
  };
  return [v, set];
}
export function PrimaryHomeToggle({ value, onChange }) {
  const t = useStrings();
  return (
    <label className="primary-home">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{t("tb.primary")}</span>
    </label>
  );
}
// "Town of Ringle, D.C. Everest Area schools" — the district named only where the place has more than one.
export const placeLabel = (t, { m, sd }) => {
  const where = `${m.type} of ${m.name}`;
  return m.school_districts.length > 1 ? t("tb.cmp.placeSchool", where, sd.name) : where;
};

// "Where is your home?" — every Marathon County municipality, grouped.
// A numbered step marker for the tax-bill flow (1 where, 2 school, 3 value).
const StepNum = ({ n }) => (n ? <span className="step-num" aria-hidden="true">{n}</span> : null);

export function MuniPicker({ municipalities, value, onChange, step }) {
  const t = useStrings();
  return (
    <div className="school-pick">
      <label className="school-pick__q" htmlFor="muni-pick"><StepNum n={step} />{t("tb.muniQ")}</label>
      <select id="muni-pick" className="muni-select" value={value} onChange={(e) => {
        const m = municipalities.find((x) => x.code === e.target.value);
        track("Municipality", { name: `${m.type} of ${m.name}`, via: "picker" });
        onChange(e.target.value);
      }}>
        {["City", "Village", "Town"].map((type) => (
          <optgroup key={type} label={t("tb.group." + type)}>
            {municipalities.filter((m) => m.type === type).map((m) => (
              <option key={m.code} value={m.code}>
                {`${m.type} of ${m.name}`}{m.split_county ? " " + t("tb.splitPart") : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// "Which school district is your home in?" — only where the municipality spans
// more than one (28 of Marathon County's 61 do).
export function SchoolPicker({ options, value, onChange, where, step }) {
  const t = useStrings();
  if (!options) return null;
  return (
    <div className="school-pick">
      <div className="school-pick__q"><StepNum n={step} />{t("tb.schoolQ")}</div>
      <div className="toggle" role="group" aria-label={t("tb.schoolQ")}>
        {options.map((s) => (
          <button key={s.code} type="button" aria-pressed={value === s.code} className={value === s.code ? "on" : ""}
            onClick={() => onChange(s.code)}>{s.name}</button>
        ))}
      </div>
      <p className="note">{t("tb.schoolNote", where)}</p>
    </div>
  );
}

// A dollar amount typed with live thousands separators. Reformatting the value
// ("2500000" -> "2,500,000") would throw the caret to the end; this puts it back
// after the same number of digits, so editing mid-number works. `onValue` gets
// the parsed whole dollars (capped).
export function MoneyInput({ value, onValue, ...rest }) {
  const ref = useRef(null);
  const digitsBefore = useRef(null);
  const text = value.toLocaleString("en-US");
  useLayoutEffect(() => {
    const el = ref.current;
    if (digitsBefore.current == null || document.activeElement !== el) return;
    let pos = 0, seen = 0;
    while (pos < text.length && seen < digitsBefore.current) { if (/\d/.test(text[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
    digitsBefore.current = null;
  }, [text]);
  return (
    <input ref={ref} type="text" inputMode="numeric" autoComplete="off" value={text} {...rest}
      onChange={(e) => {
        digitsBefore.current = e.target.value.slice(0, e.target.selectionStart).replace(/\D/g, "").length;
        onValue(Math.min(parseInt(e.target.value.replace(/\D/g, ""), 10) || 0, 99999999));
      }} />
  );
}

// The "what's your home worth" input + estimated-bill output. Controlled: the
// body owns the value because the tax split below derives from it too.
// Every calculator asks for the same number — the home's estimated FAIR MARKET
// value — because every rate in the suite is per $1,000 of it (see billRates);
// the hint names where it's printed on a Wisconsin tax bill.
export function HomeValueCalc({ id, label, outLabel, outValue, value, onChange, step }) {
  const t = useStrings();
  const counted = useRef(false); // count a reader's first edit per calculator, never the value
  return (
    <div className="calc">
      <div className="calc-input">
        <label htmlFor={id}><StepNum n={step} />{label}</label>
        <div className="calc-field">
          <span>$</span>
          <MoneyInput id={id} value={value} aria-describedby={id + "-hint"}
            onValue={(v) => {
              if (!counted.current) { counted.current = true; track("Home value", { view: currentView() }); }
              onChange(v);
            }} />
        </div>
        <div className="calc-hint" id={id + "-hint"}>{t("calc.fmvHint")}</div>
      </div>
      <div className="calc-out" aria-live="polite" aria-atomic="true">
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
// credits (optional): { lottery, firstDollar } in dollars — drawn after the
// levies' total as the bill draws them, then the bill after credits.
export function TaxSplit({ rows, total, homeValue, totalLabel, exploreLabel, onDrill, credits }) {
  const t = useStrings();
  const [tip, setTip] = useState(null);
  const barRef = useRef(null);
  const bill = billDollars(rows.map((r) => r.rate), homeValue, credits); // whole dollars that add up
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
              <div>{usd(bill.lines[tip.i])} &middot; {share.toFixed(1)}% &middot; ${r.rate.toFixed(2)}/$1k</div>
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
              <span className="jrow-amt">{usd(bill.lines[i])}</span>
              <span className="jrow-share">{((r.rate / total) * 100).toFixed(0)}%</span>
            </div>
          );
        })}
        <div className="jrow total">
          <span className="jrow-sw" />
          <span className="jrow-name">{totalLabel}</span>
          <span className="jrow-amt">{usd(bill.levied)}</span>
          <span className="jrow-share">100%</span>
        </div>
        {credits && (<>
          {[["lottery", "tb.credit.lottery"], ["firstDollar", "tb.credit.first"]].filter(([k]) => credits[k] > 0).map(([k, label]) => (
            <div className="jrow credit" key={k}>
              <span className="jrow-sw" />
              <span className="jrow-name">{t(label)}</span>
              <span className="jrow-amt">{"\u2212" + usd(bill[k])}</span>
              <span className="jrow-share" />
            </div>
          ))}
          <div className="jrow total net">
            <span className="jrow-sw" />
            <span className="jrow-name">{t("tb.netRow")}</span>
            <span className="jrow-amt">{usd(bill.net)}</span>
            <span className="jrow-share" />
          </div>
        </>)}
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
  const jsonUrl = import.meta.env.BASE_URL + chrome.dataFile;
  const kindNoun = t("method.kind." + ent.kind);
  // A school year reads "2025-26", not the calendar year its budget ends in.
  const yearLabel = b.meta.fiscal_label || b.meta.budget_year;
  const csvRows = ent.kind === "city"
    ? b.general_fund.expenditures.map((r) => ({ department: r.category, fund: "General Fund", [`budget_${b.meta.budget_year - 1}`]: r.prior, [`budget_${b.meta.budget_year}`]: r.proposed }))
    : ent.kind === "school"
    ? b.funds.map((f) => ({ fund_no: f.fund_no, fund: f.name, revenues: f.revenues, expenditures: f.expenditures, prior_expenditures: f.prior_expenditures }))
    : b.departments.map((d) => ({ department: d.department, tax_levy: d.tax_levy, operating_revenues: d.operating_revenues, operating_expenditures: d.operating_expenditures, personnel_expenditures: d.personnel_expenditures }));
  return (
    <section id="methodology" className="block">
      <SectionHead kicker={t("method.kicker")} title={t("method.title")}>
        {t("method.intro", b.meta.entity, yearLabel, kindNoun, b.meta.status)}
      </SectionHead>
      <ol className="method">
        <li><b>{t("method.step.sourceLabel")}</b>{" "}
          <SourceLink source={chrome.source}>{t("method.step.source", yearLabel, b.meta.entity, b.meta.status)}</SourceLink></li>
        <li><b>{t("method.step.extractionLabel")}</b> {t("method.step.extraction")}</li>
        <li><b>{t("method.step.verificationLabel")}</b> {t("method.step.verification")}</li>
        <li><b>{t("method.step.updatesLabel")}</b> {t("method.step.updates")}</li>
      </ol>
      <div className="downloads">
        <a className="dl-btn" href={jsonUrl} download onClick={() => track("Download", { view: currentView(), format: "json" })}>{t("method.dlJson")}</a>
        <button type="button" className="dl-btn" onClick={() => { track("Download", { view: currentView(), format: "csv" }); downloadCSV(`${ent.id}-${b.meta.budget_year}-spending.csv`, csvRows); }}>
          {t("method.dlCsv")}
        </button>
      </div>
      <p className="note">{t("method.reuse")}</p>
      <p className="note">{t("method.corrections")}{" "}
        <a href={CORRECTIONS_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("corrections")}>{t("method.correctionsLink")}</a></p>
      <Glossary />
      <a className="suite-link" href={MEETING_TRACKER_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("meeting-tracker")}>
        <span className="suite-link__icon" aria-hidden="true">📋</span>
        <span><b>{t("suite.linkLead")}</b> {t("suite.linkBody", b.meta.status)}</span>
        <ArrowUpRight size={16} strokeWidth={2.5} className="suite-link__arrow" />
      </a>
      <SupportBand />
    </section>
  );
}
