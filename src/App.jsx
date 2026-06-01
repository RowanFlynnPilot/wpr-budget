import React, { useState, useMemo, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
  ComposedChart, BarChart, Bar,
} from "recharts";
import { ChevronDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import logoUrl from "./assets/logo-32.png";
import marathonLogo from "./assets/marathon-county.jpg";
import wausauLogo from "./assets/wausau-city.jpg";

// Per-entity logos, keyed by manifest id (used in the chrome-bar switcher and
// the masthead). Square-format marks — shown whole (object-fit:contain), not
// circle-cropped.
const ENTITY_LOGOS = { "marathon-county": marathonLogo, "wausau-city": wausauLogo };

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
        const fromHash = list.find((e) => e.id === window.location.hash.slice(1));
        setActiveId((fromHash || list[0]).id);
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

  const onSelect = (id) => { window.location.hash = id; setActiveId(id); };

  if (err) return (<div className="ftm load"><style>{CSS}</style><p>Could not load budget data &mdash; {err}</p></div>);
  // Gate on data.id === activeId so we never render a body with the previous
  // entity's data during a switch (the bodies assume their own entity's schema).
  if (!entities || !activeId || !data || data.id !== activeId)
    return (<div className="ftm load"><style>{CSS}</style><p>Loading the ledger&hellip;</p></div>);

  const ent = entities.find((e) => e.id === activeId);
  const chrome = { entities, activeId, onSelect };
  const Body = ent.kind === "city" ? CityLedger : Ledger;
  return <Body key={activeId} b={data.payload} chrome={chrome} />;
}

// Shared WPR brand chrome bar, with the entity switcher (rendered only when the
// suite has more than one entity).
function ChromeBar({ entities, activeId, onSelect, year }) {
  const active = entities.find((e) => e.id === activeId);
  return (
    <div className="chrome-bar">
      <div className="chrome-bar__left">
        <a className="chrome-bar__brand" href="https://wausaupilotandreview.com"
           target="_blank" rel="noopener noreferrer">
          <img className="chrome-bar__logo-img" src={logoUrl} alt="Wausau Pilot &amp; Review" />
          <span className="chrome-bar__wordmark">Wausau Pilot &amp; Review</span>
        </a>
        <span className="chrome-bar__divider" />
        {entities.length > 1 ? (
          <span className="chrome-bar__switch" role="tablist" aria-label="Choose budget">
            {entities.map((e) => (
              <button key={e.id} type="button" role="tab" aria-selected={e.id === activeId}
                className={"chrome-bar__ent" + (e.id === activeId ? " on" : "")}
                onClick={() => onSelect(e.id)}>
                <img src={ENTITY_LOGOS[e.id]} alt="" />
                <span>{e.short}</span>
              </button>
            ))}
          </span>
        ) : (
          <span className="chrome-bar__section">{active.short}</span>
        )}
      </div>
      <span className="chrome-bar__meta">FY{year} Adopted Budget</span>
    </div>
  );
}

// Jurisdiction colors for the "your tax bill" split (City / school / county /
// college), sorted by rate descending: accent, gold, rust, slate.
const JURIS_COLORS = ["#16584a", "#9a7b2e", "#a8492f", "#3d5a80"];
// Editorial line palette for the workforce chart (green, gold, rust, slate,
// forest, plum).
const WORKFORCE_COLORS = ["#16584a", "#9a7b2e", "#a8492f", "#3d5a80", "#2f6f4f", "#7a3b6b"];

// City of Wausau body. A municipality is fund-based with no per-department levy,
// so the sections differ from the County's: spending by GF department and by
// all-funds category, the levy over time, the property-tax-by-jurisdiction
// split, and debt — all from the City's own validated schema.
function CityLedger({ b, chrome }) {
  const [gfFlow, setGfFlow] = useState("departments");
  const [active, setActive] = useState("where");

  const gfRows = gfFlow === "departments" ? b.general_fund.expenditures : b.general_fund.revenues;
  const gfTotal = useMemo(() => gfRows.reduce((s, r) => s + r.proposed, 0), [gfRows]);
  const gfMax = useMemo(() => Math.max(...gfRows.map((r) => r.proposed)), [gfRows]);

  const cats = useMemo(() => [...b.expenditure_categories].sort((a, c) => c.current - a.current), [b.expenditure_categories]);
  const catMax = useMemo(() => Math.max(...cats.map((c) => c.current)), [cats]);

  const levy = b.levy_history;
  const levyFirst = levy[0], levyLast = levy[levy.length - 1];
  const levyPct = (levyLast.levy / levy[levy.length - 2].levy - 1) * 100;

  const j = b.tax_by_jurisdiction;
  const ry = j.rate_years[0];
  const jrows = useMemo(() => [...j.rows].sort((a, c) => c.rates[ry] - a.rates[ry]), [j.rows, ry]);
  const jtotal = j.total[ry];
  const cityShare = Math.round((jrows[0].rates[ry] / jtotal) * 100);

  const debt = b.debt;

  // Workforce: the six largest departments by current FTE, as year-ascending
  // chart rows (the source arrays are newest-first).
  const wf = b.personnel;
  const wfTop = useMemo(() => [...wf.rows].sort((a, c) => c.fte[0] - a.fte[0]).slice(0, 6), [wf.rows]);
  const wfData = useMemo(() => wf.years.map((_, i) => {
    const idx = wf.years.length - 1 - i; // ascending position -> newest-first index
    const o = { year: wf.years[idx] };
    wfTop.forEach((d) => { o[d.department] = d.fte[idx] ?? null; });
    return o;
  }), [wf.years, wfTop]);

  const tif = b.tif;
  const tifGrowth = useMemo(() => [...tif.valuation_growth].sort((a, c) => c.growth - a.growth), [tif.valuation_growth]);
  const tifMaxGrowth = Math.max(...tifGrowth.map((g) => g.growth));

  const sections = [
    ["where", "Where It Goes"],
    ["allfunds", "All Funds"],
    ["overtime", "Over Time"],
    ["workforce", "Workforce"],
    ["taxbill", "Your Tax Bill"],
    ["development", "Development"],
    ["debt", "Debt"],
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
        <p className="dek">
          Every dollar in the {b.meta.entity}&rsquo;s {b.meta.budget_year} budget — where it comes from, where it
          goes, and what it means for your tax bill. Adopted by the Common Council.
        </p>
        <div className="stat-strip">
          <Stat icon="💰" label="Total budget" value={compact(b.meta.total_expenditures)} sub="all funds" />
          <Stat icon="🏛️" label="City tax levy" value={compact(b.meta.tax_levy)} sub={<Delta value={levyPct} />} />
          <Stat icon="🏠" label="City share of tax bill" value={cityShare + "%"} sub={"of $" + jtotal.toFixed(2) + " total rate"} />
        </div>
      </header>

      <nav className="subnav">
        {sections.map(([id, label]) => (
          <a key={id} href={"#" + id} className={active === id ? "active" : ""}>{label}</a>
        ))}
      </nav>

      {/* WHERE IT GOES — General Fund */}
      <section id="where" className="block">
        <SectionHead kicker="The General Fund" title="Where every dollar goes">
          The general fund — {compact(b.meta.gf_expenditures)} — pays for day-to-day city services. Toggle to
          see what it spends by department, and where that money comes from.
        </SectionHead>
        <div className="toggle">
          <button className={gfFlow === "departments" ? "on" : ""} onClick={() => setGfFlow("departments")}>By department</button>
          <button className={gfFlow === "revenues" ? "on" : ""} onClick={() => setGfFlow("revenues")}>Revenue</button>
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
        <p className="note">
          {gfFlow === "departments"
            ? "Change shown vs. the 2025 adopted budget. Police and Fire together are the largest share of city spending."
            : "Change shown vs. the 2025 adopted budget. Property taxes are the city's single largest revenue source."}
        </p>
      </section>

      {/* ALL FUNDS — by category */}
      <section id="allfunds" className="block">
        <SectionHead kicker="The Whole Picture" title="All funds, by category">
          Beyond the general fund, the city&rsquo;s {compact(b.meta.total_expenditures)} all-funds budget covers
          capital projects, debt service, enterprise and special-revenue funds. Here it is by type of spending.
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
        <p className="note">Change shown vs. the 2025 adopted budget, all funds.</p>
      </section>

      {/* OVER TIME — levy */}
      <section id="overtime" className="block">
        <SectionHead kicker="Shifting Priorities" title="The levy over time">
          The city&rsquo;s property-tax levy has risen from {compact(levyFirst.levy)} in {levyFirst.year} to{" "}
          {compact(levyLast.levy)} in {levyLast.year} — up {(((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0)}%.
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
          <p className="note">Actual property-tax levy as adopted, {levyFirst.year}&ndash;{levyLast.year}.</p>
        </div>

        <div className="callout">
          <div className="callout-title">The city is at its levy ceiling</div>
          <p>
            For the eleventh year running, Wausau&rsquo;s levy sits above the basic state limit — {compact(levyLast.exception)}{" "}
            over in {levyLast.year}, allowed only through the debt-service exemption. And in 2027, the federal ARPA and
            SAFER grants that pay for 15 first-responder positions expire, leaving an estimated $1.5 million for the
            levy to absorb — the structural gap the mayor&rsquo;s budget message calls a &ldquo;ticking time bomb.&rdquo;
          </p>
        </div>
      </section>

      {/* WORKFORCE — FTE over time */}
      <section id="workforce" className="block">
        <SectionHead kicker="The People" title="The city&rsquo;s workforce over time">
          The city budgets {wf.total[0]} full-time-equivalent positions in {b.meta.budget_year}, up from {wf.total[wf.total.length - 1]}{" "}
          a decade ago. Police and Fire have grown the most — Fire alone added 15 positions since 2022, largely
          grant-funded.
        </SectionHead>
        <div className="chart-wrap">
          <div className="chart-legend">
            {wfTop.map((d, i) => (
              <span key={d.department}><i className="sw" style={{ background: WORKFORCE_COLORS[i % WORKFORCE_COLORS.length] }} />{d.department}</span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={330}>
            <LineChart data={wfData} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={34} />
              <Tooltip content={<WorkforceTip />} />
              {wfTop.map((d, i) => (
                <Line key={d.department} type="monotone" dataKey={d.department} stroke={WORKFORCE_COLORS[i % WORKFORCE_COLORS.length]} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="note">
            Budgeted full-time-equivalent (FTE) positions by department, {wf.years[wf.years.length - 1]}&ndash;{wf.years[0]}.
            The six largest departments are shown; the 11 elected alderpersons are excluded.
          </p>
        </div>
      </section>

      {/* YOUR TAX BILL — jurisdiction split */}
      <section id="taxbill" className="block">
        <SectionHead kicker="The Bottom Line" title="Where your property-tax dollar goes">
          The city is only one line on your tax bill. Of the ${jtotal.toFixed(2)} per $1,000 of value a Wausau
          homeowner paid in {ry}, the city kept just ${jrows[0].rates[ry].toFixed(2)} — {cityShare}%. The rest
          funds the school district, the county, and the technical college.
        </SectionHead>
        <div className="taxbar">
          {jrows.map((r, i) => {
            const share = (r.rates[ry] / jtotal) * 100;
            return (
              <div className="taxbar-seg" key={r.jurisdiction}
                style={{ width: share + "%", background: JURIS_COLORS[i % JURIS_COLORS.length] }}>
                {share > 9 ? Math.round(share) + "%" : ""}
              </div>
            );
          })}
        </div>
        <div className="jrows">
          {jrows.map((r, i) => (
            <div className="jrow" key={r.jurisdiction}>
              <span className="jrow-sw" style={{ background: JURIS_COLORS[i % JURIS_COLORS.length] }} />
              <span className="jrow-name">{r.jurisdiction}</span>
              <span className="jrow-rate">${r.rates[ry].toFixed(2)}</span>
              <span className="jrow-share">{((r.rates[ry] / jtotal) * 100).toFixed(0)}%</span>
            </div>
          ))}
          <div className="jrow total">
            <span className="jrow-sw" />
            <span className="jrow-name">Total tax rate</span>
            <span className="jrow-rate">${jtotal.toFixed(2)}</span>
            <span className="jrow-share">100%</span>
          </div>
        </div>
        <p className="note">
          Rate per $1,000 of equalized value, {ry} (the most recent year all jurisdictions have set). The City
          of Wausau collects the bill on behalf of all four.
        </p>
      </section>

      {/* DEVELOPMENT — tax increment districts */}
      <section id="development" className="block">
        <SectionHead kicker="Betting on Growth" title="Tax increment districts">
          The city runs {tifGrowth.length} active tax increment districts (TIDs) — areas where the growth in property
          value is captured to repay public investment in development. Here is how much each district&rsquo;s value
          grew last year.
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
          Valuation growth, 2025. The budget also includes the developer incentive payments above. A net TID levy
          decrease of {compact(tif.levy_decrease)} this year reflects the closure of District 6.
        </p>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker="What the City Owes" title="Outstanding debt">
          The city carries <b>{compact(debt.outstanding)}</b> in general-obligation debt — {debt.pct_of_limit}% of
          its legal borrowing limit. Here is how it is scheduled to be paid down.
        </SectionHead>
        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-new" /> Principal</span>
            <span><i className="sw sw-old" /> Interest</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={debt.retirement} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
              <Tooltip content={<BarTip />} cursor={{ fill: "var(--paper-2)" }} />
              <Bar dataKey="principal" stackId="d" fill="var(--accent)" name="Principal" maxBarSize={26} />
              <Bar dataKey="interest" stackId="d" fill="var(--gold)" fillOpacity={0.82} name="Interest" maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
          <p className="note">
            Annual principal + interest on existing general-obligation debt. The {debt.retirement[0].year} payment
            is {compact(debt.retirement[0].total)}; the schedule runs through {debt.retirement[debt.retirement.length - 1].year}.
          </p>
        </div>
      </section>

      <footer className="foot">
        <p>
          <b>Source:</b> {b.meta.entity} Adopted {b.meta.budget_year} Budget. Figures are as adopted and may be
          amended during the year.
        </p>
        <p className="muted">Built and maintained by Wausau Pilot &amp; Review; department, fund, levy, tax-rate
          and debt figures extracted directly from the city&rsquo;s published budget document and reconciled
          against its printed totals.</p>
      </footer>
    </div>
  );
}

function Ledger({ b, chrome }) {
  const [flow, setFlow] = useState("expenditures");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");
  const [open, setOpen] = useState(null);
  const [active, setActive] = useState("where");
  const [deptView, setDeptView] = useState("amount");

  const gfRows = b.general_fund[flow];
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

  const sections = [
    ["where", "Where It Goes"],
    ["departments", "Departments"],
    ["trends", "Over Time"],
    ["bill", "Your Tax Bill"],
    ["funds", "Funds"],
    ["debt", "Debt"],
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
        <p className="dek">
          Every dollar in {b.meta.entity}&rsquo;s {b.meta.budget_year} budget — where it comes from, where it
          goes, and what it means for your tax bill. Adopted by the County Board on{" "}
          {new Date(b.meta.adopted + "T00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
        </p>

        <div className="stat-strip">
          <Stat icon="💰" label="Total budget" value={compact(b.meta.total_expenditures)} sub={budgetPctChange != null ? <Delta value={budgetPctChange} /> : null} />
          <Stat icon="🏛️" label="County tax levy" value={compact(b.meta.tax_levy)} sub={<Delta value={levyPctChange} />} />
          <Stat icon="🏠" label="Mill rate" value={"$" + b.meta.tax_rate.toFixed(2)} sub={<Delta value={ratePctChange} />} />
        </div>
      </header>

      <nav className="subnav">
        {sections.map(([id, label]) => (
          <a key={id} href={"#" + id} className={active === id ? "active" : ""}>{label}</a>
        ))}
      </nav>

      {/* WHERE IT GOES */}
      <section id="where" className="block">
        <SectionHead kicker="The General Fund" title="Where every dollar goes">
          The county&rsquo;s general fund pays for day-to-day government. Toggle to see what it spends — and
          where the money comes from before the property-tax levy fills the gap.
        </SectionHead>

        <div className="toggle">
          <button className={flow === "expenditures" ? "on" : ""} onClick={() => setFlow("expenditures")}>Spending</button>
          <button className={flow === "revenues" ? "on" : ""} onClick={() => setFlow("revenues")}>Revenue</button>
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
        <p className="note">
          {flow === "expenditures"
            ? "Change shown vs. the 2025 adopted budget. Public safety alone is roughly two-fifths of general-fund spending."
            : "Change shown vs. the 2025 adopted budget. Whatever these sources don't cover is made up by the property-tax levy."}
          {" "}The mini-trend traces each row from 2024 (actual) through 2025 (budget) to 2026 (adopted).
        </p>
      </section>

      {/* DEPARTMENTS */}
      <section id="departments" className="block">
        <SectionHead kicker="The Drill-Down" title="Department by department">
          Twenty-one departments and agencies. Each one&rsquo;s total spending equals the tax levy that supports
          it plus the revenue it raises on its own. Click any row to open the books.
        </SectionHead>

        <div className="ledger">
          <div className="ledger-head">
            <button className={sortKey === "department" ? "sorted" : ""} onClick={() => setSort("department")}>Department</button>
            <button className={sortKey === "spend" ? "sorted" : ""} onClick={() => setSort("spend")}>Total spending</button>
            <button className={"hide-sm " + (sortKey === "personnel" ? "sorted" : "")} onClick={() => setSort("personnel")}>Personnel</button>
            <button className={sortKey === "levy" ? "sorted" : ""} onClick={() => setSort("levy")}>Tax levy</button>
            <button className={"hide-sm " + (sortKey === "change" ? "sorted" : "")} onClick={() => setSort("change")}>vs &rsquo;25</button>
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
                  <span className="d-levy">{compact(d.tax_levy)}</span>
                  <span className="d-change hide-sm"><Delta value={d.levy_difference} money /></span>
                  <span className="chev-col"><ChevronDown size={16} className="chev" /></span>
                </button>
                {isOpen && (
                  <div className="detail">
                    <div className="detail-grid">
                      <Balance title="Where it goes" rows={[
                        ["Operating expenditures", d.operating_expenditures],
                        ["Personnel", d.personnel_expenditures],
                      ]} total={["Total spending", spend]} />
                      <Balance title="Where it comes from" rows={[
                        ["Revenue raised", d.operating_revenues],
                        ["County tax levy", d.tax_levy],
                      ]} total={["Total funding", d.operating_revenues + d.tax_levy]} />
                    </div>
                    <p className="detail-note">
                      The levy supporting {d.department.replace(/&rsquo;/g, "'")} {d.levy_difference === null ? "is unchanged from 2025." :
                        d.levy_difference >= 0
                          ? `rose ${usd(d.levy_difference)} from 2025.`
                          : `fell ${usd(Math.abs(d.levy_difference))} from 2025.`}
                      {d.tax_levy < 0 && " It returns more revenue to the county than it costs to run."}
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
        <SectionHead kicker="Shifting Priorities" title="How the budget has changed over time">
          The total tax levy — every dollar the county raises from property taxes — has risen by more
          than a quarter since 2017, even as the mill rate has fallen. Property values simply grew faster
          than the rate came down.
        </SectionHead>

        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-levy" /> Total county tax levy</span>
            <span><i className="sw sw-rate" /> Mill rate (per $1,000 of value)</span>
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
          <p className="note">
            The levy rose from {compact(levyFirst.levy)} in {levyFirst.year} to {compact(levyLast.levy)} in{" "}
            {levyLast.year} — up {(((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0)}% — while the mill
            rate fell from ${levyFirst.rate.toFixed(2)} to ${levyLast.rate.toFixed(2)} per $1,000 of value.
          </p>
        </div>

        {deptCompare && (
          <div className="chart-wrap" style={{ marginTop: 44 }}>
            <h3 className="subhead">Department by department, {deptCompare.first} vs {deptCompare.last}</h3>
            <div className="toggle">
              <button className={deptView === "amount" ? "on" : ""} onClick={() => setDeptView("amount")}>Amounts</button>
              <button className={deptView === "change" ? "on" : ""} onClick={() => setDeptView("change")}>Change</button>
            </div>

            {deptView === "amount" ? (
              <>
                <div className="chart-legend">
                  <span><i className="sw sw-old" /> {deptCompare.first} levy</span>
                  <span><i className="sw sw-new" /> {deptCompare.last} levy</span>
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

            <p className="note">
              Adopted county tax levy by department, {deptCompare.first}&ndash;{deptCompare.last}. Each year is taken
              from that year&rsquo;s own adopted budget book. Revenue-returning offices (e.g.&nbsp;the County
              Treasurer), whose levy is negative, are omitted. In a tax context an increase is shown in red.
            </p>
          </div>
        )}
      </section>

      {/* TAX BILL */}
      <section id="bill" className="block">
        <SectionHead kicker="The Bottom Line" title="What it means for your tax bill">
          The county&rsquo;s mill rate has fallen nearly every year since 2017. But because home values climbed
          faster, the bill on a typical home kept rising anyway.
        </SectionHead>

        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-rate" /> Mill rate (per $1,000 of value)</span>
            <span><i className="sw sw-bill" /> Avg. bill on a typical home</span>
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
          <p className="note">
            A typical home went from about {usd(b.homeowner_impact[0].avg_value)} in {b.homeowner_impact[0].year} to{" "}
            {usd(b.homeowner_impact[b.homeowner_impact.length - 1].avg_value)} in {lastTrend.year}, while the mill
            rate dropped from ${b.homeowner_impact[0].tax_rate.toFixed(2)} to ${lastTrend.rate.toFixed(2)}.
          </p>
        </div>
      </section>

      {/* FUNDS */}
      <section id="funds" className="block">
        <SectionHead kicker="Beyond the General Fund" title="The county&rsquo;s other funds">
          Highways, the landfill, debt service and employee benefits run on their own dedicated funds.
        </SectionHead>
        <div className="fund-table">
          <div className="fund-head">
            <span>Fund</span><span>Levy support</span><span className="hide-sm">Revenue</span><span>Spending</span>
          </div>
          {b.funds.map((f) => (
            <div className="fund-row" key={f.fund_no}>
              <span className="f-name"><b>{f.name}</b><em>#{f.fund_no}</em></span>
              <span>{f.tax_levy ? usd(f.tax_levy) : <span className="muted">none</span>}</span>
              <span className="hide-sm">{usd(f.operating_revenues)}</span>
              <span>{usd(f.operating_expenditures + f.personnel_expenditures)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker="What the County Owes" title="Outstanding debt">
          {b.debt.length} bond and note series, totaling <b>{usd(debtTotal)}</b> in long-term obligations.
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

      <footer className="foot">
        <p>
          <b>Source:</b> {b.meta.entity} Adopted {b.meta.budget_year} Annual Budget. Figures are as adopted and
          may be amended during the year.
        </p>
        <p className="muted">
          Built and maintained by Wausau Pilot &amp; Review. Department and fund detail extracted directly from the
          county&rsquo;s published budget document; column totals reconciled against the county&rsquo;s own figures.
        </p>
        <p className="muted">
          <b>A note on the levy total:</b> the county&rsquo;s budget-summary page reports a 2026 levy of $61.4
          million, a 5.99% increase. Its own detailed fund and department tables — which this tool uses, and which
          the 10-year levy history matches — total $61.2 million, a 5.6% increase. The $200,000 gap traces to the
          Debt Service Fund ($4.71M on the summary page vs. $4.51M in the detail). We show the self-consistent
          detail figure throughout.
        </p>
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
        <div key={p.dataKey}><i className="sw" style={{ background: p.color }} /> {p.dataKey} {p.value} FTE</div>
      ))}
    </div>
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
      {levy && <div><i className="sw sw-levy" /> Levy {compact(levy.value)}</div>}
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
.chrome-bar{display:flex; align-items:center; justify-content:space-between; gap:12px;
  margin:0 -24px; padding:10px 24px; background:#0d7377; color:#fff;}
.chrome-bar__brand{display:flex; align-items:center; gap:10px; text-decoration:none; color:#fff;}
.chrome-bar__logo-img{height:30px; width:30px; border-radius:50%; object-fit:cover;
  border:1.5px solid rgba(255,255,255,.5); flex-shrink:0;}
.chrome-bar__wordmark{font-family:'Playfair Display',Georgia,serif; font-weight:900;
  font-size:14px; letter-spacing:.03em; text-transform:uppercase; white-space:nowrap;}
.chrome-bar__left{display:flex; align-items:center; gap:12px; min-width:0;}
.chrome-bar__divider{width:1px; height:18px; background:rgba(255,255,255,.35);}
.chrome-bar__section{font-weight:600; font-size:12px; letter-spacing:.04em;
  text-transform:uppercase; opacity:.9; white-space:nowrap;}
.chrome-bar__switch{display:inline-flex; align-items:center; gap:6px;}
.chrome-bar__ent{display:inline-flex; align-items:center; gap:7px; cursor:pointer;
  background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.28); color:#fff;
  font-family:var(--sans); font-weight:600; font-size:12px; letter-spacing:.02em; line-height:1;
  padding:3px 11px 3px 3px; border-radius:18px; white-space:nowrap;
  transition:background .15s ease, border-color .15s ease, color .15s ease;}
.chrome-bar__ent img{width:24px; height:24px; border-radius:5px; object-fit:contain;
  background:#fff; padding:2px; flex-shrink:0;}
.chrome-bar__ent:hover{background:rgba(255,255,255,.18);}
.chrome-bar__ent.on{background:#fff; color:var(--ink); border-color:#fff;}
.chrome-bar__meta{font-size:11px; letter-spacing:.04em; opacity:.75; white-space:nowrap;}
/* Desktop: let the two entity buttons grow to fill the space between the brand
   and the FY label, for a more prominent switcher. */
@media (min-width:561px){
  .chrome-bar__left{flex:1;}
  .chrome-bar__switch{flex:1; gap:10px;}
  .chrome-bar__ent{flex:1 1 0; justify-content:center; font-size:13px; gap:9px; padding:7px 18px 7px 7px;}
  .chrome-bar__ent img{width:26px; height:26px;}
}
@media (max-width:560px){
  .chrome-bar{flex-wrap:wrap; padding:8px 24px;}
  .chrome-bar__divider,.chrome-bar__section{display:none;}
  .chrome-bar__left{flex-wrap:wrap; gap:8px 10px;}
  .chrome-bar__switch{flex:1 1 100%; gap:8px;}
  .chrome-bar__ent{font-size:11px; padding:3px 10px 3px 3px;}
  .chrome-bar__ent img{width:20px; height:20px;}
  .chrome-bar__meta{width:100%; padding-top:2px;}
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
.stat-value{font-family:var(--serif); font-size:clamp(44px,6vw,62px); font-weight:600; line-height:1;
  margin:12px 0 10px; letter-spacing:-0.02em;}
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
.taxbar{display:flex; height:46px; margin-top:6px; border:1px solid var(--ink); overflow:hidden;}
.taxbar-seg{display:flex; align-items:center; justify-content:center; color:#fff; min-width:0;
  font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; animation:grow .6s both ease-out; transform-origin:left;}
.jrows{margin-top:20px; border-top:2px solid var(--ink);}
.jrow{display:grid; grid-template-columns:16px 1fr 72px 52px; align-items:center; gap:12px;
  padding:11px 2px; border-bottom:1px solid var(--rule); font-size:14px; font-variant-numeric:tabular-nums;}
.jrow-sw{width:12px; height:12px; border-radius:2px;}
.jrow-name{font-weight:500;}
.jrow-rate,.jrow-share{text-align:right;}
.jrow.total{font-weight:700; border-bottom:none; border-top:1px solid var(--ink); margin-top:2px;}

/* callout (e.g. the levy-ceiling note) */
.callout{margin-top:26px; padding:18px 22px; background:var(--paper-2); border-left:3px solid var(--neg);}
.callout-title{font-family:var(--serif); font-size:19px; font-weight:600; letter-spacing:-0.01em; margin-bottom:7px;}
.callout p{font-size:15px; color:#3a362d; line-height:1.55; margin:0; max-width:66ch;}

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

@media(max-width:680px){
  .ftm{padding:0 16px 60px;}
  .hide-sm{display:none !important;}
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
