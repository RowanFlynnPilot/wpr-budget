import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, Bar, Area,
} from "recharts";
import { useStrings } from "../i18n";
import { usd, compact } from "../format";
import {
  ENTITY_LOGOS, EditionBanner, SectionHead, Stat, FullOrCompact, SourceLink, ChartFrame, Delta, Highlights, rankLast, rankNote, risesOf, signedCompact, SubNav, SponsorSlot, Methodology,
  HomeValueCalc, TaxSplit, PrimaryHomeToggle, usePrimaryHome, DivisorToggle, useScrollSpy, useAnchorOnMount, useHomeValue,
  SchoolPicker, useSchoolChoice, billRates, WAUSAU_CITY_DOR,
} from "../ui";
import { BarTip, MoneyFlowSankey, DebtChart } from "../charts";
import ChromeBar from "../ChromeBar";
import { netBill, stateCredits } from "../taxmath";
import demographics from "../demographics.json";

// Shorter labels for the Sankey (the full names are too long to fit beside nodes).
const SANKEY_SHORT = {
  "Intergovernmental Grants and Aids": "Intergovernmental",
  "City County Information Technology": "Info Technology",
  "Public Charges for Services": "Public Charges",
  "Intergovernmental Charges for Services": "Intergov. Charges",
  "Other Financing Sources": "Other Financing",
};
const shortName = (n) => SANKEY_SHORT[n] || n;

const SECTIONS = ["where", "flow", "allfunds", "overtime", "workforce", "taxbill", "development", "debt", "methodology"];

// City of Wausau body. A municipality is fund-based with no per-department levy,
// so the sections differ from the County's: spending by GF department and by
// all-funds category, the levy over time, the property-tax-by-jurisdiction
// split, and debt — all from the City's own validated schema.
export default function CityLedger({ b, extra, chrome }) {
  const t = useStrings();
  const [gfFlow, setGfFlow] = useState("departments");
  const [wfDept, setWfDept] = useState(
    () => [...b.personnel.rows].sort((a, c) => c.fte[0] - a.fte[0])[0].department
  );
  const [homeValue, setHomeValue] = useHomeValue();
  const [divisor, setDivisor] = useState("total");
  useAnchorOnMount();
  const active = useScrollSpy(SECTIONS, chrome.routeId);

  // Per-resident / per-household view of the GF bars (curated 2020 Census
  // denominators in src/demographics.json).
  const demo = demographics[chrome.activeId];
  const perDiv = divisor === "resident" ? demo.population : divisor === "household" ? demo.households : 1;
  const showVal = (n) => (divisor === "total" ? compact(n) : usd(Math.round(n / perDiv)));

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
  // The current unbroken run of years with the levy above the basic state limit
  // (exception > 0), counted back from the latest year. If it reaches the start
  // of the book's table, the honest claim is "since at least" that year.
  const overRun = (() => {
    let i = levy.length - 1;
    while (i > 0 && levy[i - 1].exception > 0) i -= 1;
    return { since: levy[i].year, atLeast: i === 0 };
  })();

  // The tax bill for a City of Wausau home, from the DOR taxing-district data
  // (every tax-bill view's one source and basis — see billRates in ui.jsx).
  const [school, setSchool] = useSchoolChoice(WAUSAU_CITY_DOR);
  const taxYear = extra.taxDistricts.meta.tax_year;
  const muni = extra.taxDistricts.municipalities.find((m) => m.code === WAUSAU_CITY_DOR);
  const bill = useMemo(() => billRates(muni, school), [muni, school]);
  const jtotal = bill.total;
  const [primary, setPrimary] = usePrimaryHome();
  const cr = extra.taxDistricts.meta.credits;
  const credits = stateCredits(bill.school, cr, homeValue, primary);
  const splitRows = useMemo(() => [...bill.rows].sort((a, c) => c.rate - a.rate), [bill.rows]);
  // The City's own share of the bill — the City row, not whichever row is largest.
  const cityShare = Math.round((bill.rows.find((r) => r.key === "municipality").rate / jtotal) * 100);

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
  // FTE totals in prose to one decimal, so "354.2 … up from 325.3" reads as a pair
  // (the book prints them to varying precision; the chart and table keep it).
  const fte1 = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const wfNow = wfSel.fte[0];
  const wfThen = wfSel.fte[wfSel.fte.length - 1];
  const wfChange = wfNow - wfThen;

  const tif = b.tif;
  const tifGrowth = useMemo(() => [...tif.valuation_growth].sort((a, c) => c.growth - a.growth), [tif.valuation_growth]);
  const tifMaxGrowth = Math.max(...tifGrowth.map((g) => g.growth));

  // "What changed" carries what the tiles above don't: the levy change in
  // dollars and where it ranks in the city's own levy records, the all-funds
  // change, and the general-fund department that grew most.
  const changed = useMemo(() => {
    const cur = b.expenditure_categories.reduce((s, c) => s + c.current, 0);
    const prior = b.expenditure_categories.reduce((s, c) => s + c.prior, 0);
    const levyPrev = levy[levy.length - 2];
    const gfMover = [...b.general_fund.expenditures].sort((a, c) => (c.proposed - c.prior) - (a.proposed - a.prior))[0];
    return [
      { label: t("wc.levyChange"), value: signedCompact(levyLast.levy - levyPrev.levy),
        note: levyLast.levy > levyPrev.levy ? rankNote(t, rankLast(risesOf(levy, "levy"), (a, c) => a > c), levyFirst.year, "rise") : undefined },
      { label: t("wc.totalBudgetAllFunds"), value: compact(b.meta.total_expenditures), delta: (cur / prior - 1) * 100, neutral: true },
      { label: t("wc.biggestGfIncrease"), value: gfMover.category, note: "+" + usd(gfMover.proposed - gfMover.prior) },
    ];
  }, [t, b.expenditure_categories, b.general_fund, b.meta, levy, levyFirst, levyLast]);

  // Chart summaries: the visible note doubles as each chart's text alternative.
  const levyNote = t("c.overtime.note", levyFirst.year, levyLast.year);
  const wfNote = t("c.workforce.note", wfDept, wfNow, b.meta.budget_year, wfChange, wf.years[wf.years.length - 1]);
  const debtNote = t("c.debt.note", debt.retirement[0].year, compact(debt.retirement[0].total), debt.retirement[debt.retirement.length - 1].year);
  return (
    <div className="ftm">
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      <EditionBanner chrome={chrome} />

      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">{t("common.publicLedger")}</span>
            <span className="dot">·</span>
            <span>Follow the Money</span>
            <SponsorSlot entityId={chrome.activeId} />
          </div>
          {ENTITY_LOGOS[chrome.activeId] && (
            <img className="masthead-logo" src={ENTITY_LOGOS[chrome.activeId]} alt="" />
          )}
        </div>
        <h1>{b.meta.entity}</h1>
        <p className="dek">{t("c.dek", b.meta.entity)}</p>
        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.total_expenditures)} sub={t("c.stat.allFunds")} />
          <Stat icon="🏛️" label={t("c.stat.cityLevy")} value={<FullOrCompact n={b.meta.tax_levy} />} sub={<Delta value={levyPct} />} />
          <Stat icon="🏠" label={t("c.stat.cityShare")} value={cityShare + "%"} sub={t("c.stat.cityShareSub", jtotal.toFixed(2))} />
        </div>
      </header>

      <Highlights items={changed} />

      <SubNav sections={SECTIONS} active={active} routeId={chrome.routeId} />

      {/* WHERE IT GOES — General Fund */}
      <section id="where" className="block">
        <SectionHead kicker={t("kick.generalFund")} title={t("title.whereDollarGoes")}>
          {t("c.where.dek", compact(b.meta.gf_expenditures))}
        </SectionHead>
        <div className="toggle" role="group" aria-label={t("aria.gfView")}>
          <button aria-pressed={gfFlow === "departments"} className={gfFlow === "departments" ? "on" : ""} onClick={() => setGfFlow("departments")}>{t("btn.byDepartment")}</button>
          <button aria-pressed={gfFlow === "revenues"} className={gfFlow === "revenues" ? "on" : ""} onClick={() => setGfFlow("revenues")}>{t("btn.revenue")}</button>
        </div>
        <DivisorToggle divisor={divisor} onChange={setDivisor} />
        <div className="bars">
          {gfRows.map((r, i) => (
            <div className="bar-row no-spark" key={r.category} style={{ animationDelay: `${i * 40}ms` }}>
              <div className="bar-label">{r.category}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.proposed / gfMax) * 100}%` }} /></div>
              <div className="bar-val">{showVal(r.proposed)}</div>
              <div className="bar-share">{((r.proposed / gfTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={r.pct_change} neutral /></div>
            </div>
          ))}
        </div>
        <p className="note">{gfFlow === "departments" ? t("c.where.noteDept", b.meta.budget_year - 1) : t("c.where.noteRev", b.meta.budget_year - 1)}</p>
        {divisor !== "total" && (
          <p className="note">{t("pc.note", demo.population.toLocaleString("en-US"), demo.households.toLocaleString("en-US"), demo.basis)}</p>
        )}
      </section>

      {/* MONEY FLOW — General Fund Sankey */}
      <section id="flow" className="block">
        <SectionHead kicker={t("kick.followMoney")} title={t("title.howGfFlows")}>
          {t("c.flow.dek")}
        </SectionHead>
        <MoneyFlowSankey data={sankey} height={440}
          margin={{ top: 24, right: 162, bottom: 24, left: 186 }}
          ariaLabel={t("aria.flowCity", compact(b.meta.gf_expenditures), sankey.nodes.find((n) => n.col === 2).name)}
          note={t("c.flow.note")} />
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
              <div className="bar-delta"><Delta value={(c.current / c.prior - 1) * 100} neutral /></div>
            </div>
          ))}
        </div>
        <p className="note">{t("c.allfunds.note", b.meta.budget_year - 1)}</p>
      </section>

      {/* OVER TIME — levy */}
      <section id="overtime" className="block">
        <SectionHead kicker={t("kick.shiftingPriorities")} title={t("c.overtime.title")}>
          {t("c.overtime.dek", usd(levyFirst.levy), levyFirst.year, usd(levyLast.levy), levyLast.year, (((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0))}
        </SectionHead>
        <div className="chart-wrap">
          <ChartFrame summary={levyNote} table={{ columns: [{ key: "year", label: t("col.year") }, { key: "levy", label: t("tip.levy"), fmt: usd }], rows: levy }}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={levy} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--gold-ink)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
              <Tooltip content={<BarTip seriesName={t("tip.levy")} />} cursor={{ fill: "var(--paper-2)" }} />
              <Bar dataKey="levy" fill="var(--gold)" fillOpacity={0.82} radius={[2, 2, 0, 0]} maxBarSize={38} />
            </ComposedChart>
          </ResponsiveContainer>
          </ChartFrame>
          <p className="note">{levyNote}</p>
        </div>

        <div className="callout">
          <div className="callout-title">{t("c.overtime.calloutTitle")}</div>
          <p>{t("c.overtime.calloutBody", usd(levyLast.exception), levyLast.year, overRun.since, overRun.atLeast)}</p>
        </div>
      </section>

      {/* WORKFORCE — FTE over time, one department at a time */}
      <section id="workforce" className="block">
        <SectionHead kicker={t("c.workforce.kick")} title={t("c.workforce.title")}>
          {t("c.workforce.dek", fte1(wf.total[0]), fte1(wf.total[wf.total.length - 1]), b.meta.budget_year)}
        </SectionHead>
        <div className="wf-pick" role="group" aria-label={t("aria.chooseDept")}>
          {wfDepts.map((d) => (
            <button key={d.department} type="button" aria-pressed={d.department === wfDept}
              className={"wf-chip" + (d.department === wfDept ? " on" : "")}
              onClick={() => setWfDept(d.department)}>{d.department}</button>
          ))}
        </div>
        <div className="chart-wrap">
          <ChartFrame summary={wfNote} table={{ columns: [{ key: "year", label: t("col.year") }, { key: "fte", label: t("col.fte", wfDept) }], rows: wfSeries }}>
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
          </ChartFrame>
          <p className="note">{wfNote}</p>
        </div>
      </section>

      {/* YOUR TAX BILL — interactive jurisdiction calculator */}
      <section id="taxbill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("title.taxbillMeaning")}>
          {t("c.taxbill.dek", cityShare)}
        </SectionHead>

        <SchoolPicker options={bill.schoolOptions} value={bill.school.code} onChange={setSchool} where={bill.where} />

        <HomeValueCalc id="homeval" label={t("c.taxbill.homeLabel")} outLabel={t("tb.estOut")}
          outValue={usd(Math.round(netBill(muni, bill.school, cr, homeValue, primary)))} value={homeValue} onChange={setHomeValue} />
        <PrimaryHomeToggle value={primary} onChange={setPrimary} />

        <TaxSplit rows={splitRows} total={jtotal} homeValue={homeValue} totalLabel={t("tb.leviedRow")} credits={credits} />
        <p className="note">{t("c.taxbill.note", taxYear, jtotal.toFixed(2), usd(cr.lottery_max_value), usd(cr.first_dollar_max_value))}</p>
      </section>

      {/* DEVELOPMENT — tax increment districts */}
      <section id="development" className="block">
        <SectionHead kicker={t("c.dev.kick")} title={t("c.dev.title")}>
          {t("c.dev.dek", tifGrowth.length)}
        </SectionHead>
        <div className="gbars">
          {tifGrowth.map((g) => (
            <div className="gbar" key={g.tid}>
              <span className="gbar-name">{t("c.dev.district", g.tid)}</span>
              {/* A shrinking district (negative growth) gets no bar, only its signed figure. */}
              <span className="gbar-track"><i style={{ width: `${(Math.max(g.growth, 0) / tifMaxGrowth) * 100}%` }} /></span>
              <span className="gbar-val">{(g.growth > 0 ? "+" : g.growth < 0 ? "−" : "") + Math.abs(g.growth).toFixed(2)}%</span>
            </div>
          ))}
        </div>
        {tif.developer_payments.length > 0 && (
          <div className="tif-pays">
            {tif.developer_payments.map((p) => (
              <div className="tif-pay" key={p.tid}>
                <b>{t("c.dev.district", p.tid)}</b> &middot; {compact(p.amount)} <span>{p.note}</span>
              </div>
            ))}
          </div>
        )}
        <p className="note">
          {t("c.dev.note", b.meta.budget_year - 1, usd(tif.levy_decrease))}
          {/* A fact specific to the FY2026 book's TID levy change. */}
          {b.meta.budget_year === 2026 && " " + t("c.dev.noteClosure2026")}
        </p>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker={t("c.debt.kick")} title={t("title.outstandingDebt")}>
          {t("c.debt.dek", compact(debt.outstanding), debt.pct_of_limit)}
        </SectionHead>
        <div className="chart-wrap">
          <DebtChart retirement={debt.retirement} summary={debtNote} />
          <p className="note">{debtNote}</p>
        </div>
      </section>

      <Methodology b={b} chrome={chrome} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> <SourceLink source={chrome.source}>{t("c.foot.source", b.meta.entity, b.meta.budget_year)}</SourceLink> {t("foot.amended")}</p>
        <p className="muted">{t("c.foot.builtBy")}</p>
      </footer>
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
