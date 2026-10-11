import React, { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useLang, useStrings } from "../i18n";
import { usd, compact, pct, deptSpend, fmtDate } from "../format";
import {
  ENTITY_LOGOS, SectionHead, Stat, FullOrCompact, MillRate, SourceLink, ChartFrame, Delta, Balance, Spark, Highlights, HaveYourSay, ChangesLog, rankLast, rankNote, risesOf, signedCompact, SubNav, SponsorSlot, EditionBanner,
  Methodology, HomeValueCalc, DivisorToggle, useScrollSpy, useAnchorOnMount, useHomeValue,
} from "../ui";
import ChromeBar from "../ChromeBar";
import { WithCharts } from "../withCharts";
import demographics from "../demographics.json";

const SECTIONS = ["where", "departments", "trends", "bill", "funds", "debt", "methodology"];
// A proposed edition adds "Have your say" before the methodology.
const SECTIONS_PROPOSED = ["where", "departments", "trends", "bill", "funds", "debt", "say", "methodology"];

// Full dollars, or $26M on the narrowest phones (styles.css .xs-only), where a
// ledger row of full figures is wider than the screen.
const Money = ({ n }) => <><span className="xs-hide">{usd(n)}</span><span className="xs-only">{compact(n)}</span></>;

// Marathon County body — the original "Follow the Money" ledger: General Fund
// spending/revenue, the per-department levy ledger, the levy/mill-rate history,
// the homeowner tax-bill calculator, other funds, and outstanding debt.
//
// Serves both editions of the book (meta.status): the board-adopted budget and,
// during budget season, the Administrator's PROPOSED one — which is labeled as
// such everywhere and carries no General Fund summary (general_fund: null; it
// is printed in the public-hearing notice the proposed book predates).
export default function Ledger({ b, extra, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const proposed = b.meta.status === "proposed";
  const prevYear = b.meta.budget_year - 1;
  const [flow, setFlow] = useState("expenditures");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");
  const [open, setOpen] = useState(null);
  const [deptView, setDeptView] = useState("amount");
  const [homeValue, setHomeValue] = useHomeValue();
  const [divisor, setDivisor] = useState("total");
  useAnchorOnMount();
  const sections = chrome.edition ? SECTIONS_PROPOSED : SECTIONS;
  const active = useScrollSpy(sections, chrome.routeId);

  // Per-resident / per-household view of the GF bars (curated 2020 Census
  // denominators in src/demographics.json).
  const demo = demographics[chrome.activeId];
  const perDiv = divisor === "resident" ? demo.population : divisor === "household" ? demo.households : 1;
  const showVal = (n) => (divisor === "total" ? compact(n) : usd(Math.round(n / perDiv)));

  // Both tabs sorted by amount, largest first. (Empty for a proposed edition.)
  // A PROPOSED book carries no general-fund-by-function summary yet (that comes
  // with the hearing notice), so "Where it goes" shows the whole budget fund by
  // fund instead, against the prior year's book — where the Highway Fund's jump shows.
  const fundRows = useMemo(() => {
    if (b.general_fund) return null;
    const ys = b.history.years.map(String);
    const [cur, prev] = [ys.at(-1), ys.at(-2)];
    return b.history.funds.filter((f) => f.adopted[cur])
      .map((f) => ({ name: f.name, cur: f.adopted[cur], prior: f.adopted[prev] ?? null }))
      .sort((a, c) => c.cur - a.cur);
  }, [b.general_fund, b.history]);
  const gfRows = useMemo(() => (b.general_fund ? [...b.general_fund[flow]] : [])
    .sort((a, c) => c.proposed_next - a.proposed_next), [flow, b.general_fund]);
  const gfTotal = useMemo(() => gfRows.reduce((s, r) => s + r.proposed_next, 0), [gfRows]);
  const gfMax = useMemo(() => Math.max(...gfRows.map((r) => r.proposed_next)), [gfRows]);
  // Public safety's share of GF spending, for the note (computed, not asserted).
  const publicSafetyShare = useMemo(() => {
    const exp = b.general_fund ? b.general_fund.expenditures : [];
    const ps = exp.find((r) => r.category === "Public Safety");
    return ps ? Math.round((ps.proposed_next / exp.reduce((s, r) => s + r.proposed_next, 0)) * 100) : null;
  }, [b.general_fund]);

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
  // Bars scale to the largest series, so the comparison uses the full width.
  const debtMax = useMemo(() => Math.max(...b.debt.map((d) => d.outstanding)), [b.debt]);

  // Screen-reader-only sort state for the active column header.
  const sortHint = (k) => (k === sortKey
    ? <span className="sr-only">{", " + t(sortDir === "asc" ? "aria.sortedAsc" : "aria.sortedDesc")}</span> : null);

  const setSort = (k) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "department" ? "asc" : "desc"); }
  };

  // Mill rate vs the county tax on a typical home: the book's homeowner table,
  // all of it (15 years, longer than the levy history).
  const trend = useMemo(
    () => b.homeowner_impact.map((h) => ({ year: h.year, rate: h.tax_rate, bill: h.tax_amount })),
    [b.homeowner_impact]
  );
  const lastTrend = trend[trend.length - 1];
  // The rate's last peak: "fallen nearly every year since <it>".
  const ratePeakYear = useMemo(() => {
    const top = Math.max(...trend.map((p) => p.rate));
    return trend.filter((p) => p.rate === top).at(-1).year;
  }, [trend]);

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
  const levyRisePct = (((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0);

  // Total-budget YoY change, against the prior year's ADOPTED budget only: a
  // year whose book still printed the Administrator's proposal (basis
  // "proposed" — the 2025 book) isn't "last year's budget", so no change is
  // claimed against it. Dormant until a prior year lands in history.
  const tYears = Object.keys(b.history.totals).map(Number).sort((a, c) => a - c);
  const tLast = String(tYears[tYears.length - 1]);
  const tPrev = tYears.length >= 2 ? String(tYears[tYears.length - 2]) : null;
  const budgetPctChange = tPrev && b.history.totals[tPrev].basis === "adopted"
    ? (b.history.totals[tLast].total_expenditures / b.history.totals[tPrev].total_expenditures - 1) * 100
    : null;
  // What moved the total: the fund whose spending changed most from the prior year.
  const budgetDriver = useMemo(() => {
    if (budgetPctChange == null) return null;
    const moves = b.history.funds
      .map((f) => ({ name: f.name, change: (f.adopted[tLast] || 0) - (f.adopted[tPrev] || 0) }))
      .sort((a, c) => Math.abs(c.change) - Math.abs(a.change));
    return moves[0];
  }, [b.history.funds, budgetPctChange, tLast, tPrev]);

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

  // "What changed" carries what the tiles above don't: the levy change in
  // dollars and where it ranks in the county's own records, what it means for
  // a typical home's county tax, and the department whose levy rose most.
  const changed = useMemo(() => ([
    { label: t("wc.levyChange"), value: signedCompact(levyLast.levy - levyPrev.levy),
      note: levyLast.levy > levyPrev.levy ? rankNote(t, rankLast(risesOf(levyTrend, "levy"), (a, c) => a > c), levyFirst.year, "rise") : undefined },
    { label: t("wc.typicalBill"), value: usd(Math.round(lastTrend.bill)), delta: b.homeowner_impact.at(-1).pct_change_bill,
      note: [t("wc.typicalOn", usd(b.homeowner_impact.at(-1).avg_value)),
        b.homeowner_impact.at(-1).pct_change_bill > 0
          ? rankNote(t, rankLast(b.homeowner_impact.map((h) => ({ label: h.year, v: h.pct_change_bill })), (a, c) => a > c), b.homeowner_impact[0].year, "rise")
          : undefined].filter(Boolean).join(" \u00b7 ") },
    levyMover && levyMover.levy_difference > 0
      ? { label: t("wc.biggestLevyIncrease"), value: levyMover.department, note: "+" + usd(levyMover.levy_difference) }
      : (budgetPctChange != null
        ? { label: t("wc.totalBudget"), value: compact(b.meta.total_expenditures), delta: budgetPctChange, neutral: true }
        : null),
  ]), [t, b.meta, b.homeowner_impact, levyTrend, levyFirst, levyLast, levyPrev, lastTrend, levyMover, budgetPctChange]);

  // Chart summaries: the visible note doubles as each chart's text alternative.
  const trendsNote = t("co.trends.note", usd(levyFirst.levy), levyFirst.year, usd(levyLast.levy), levyLast.year, (((levyLast.levy / levyFirst.levy) - 1) * 100).toFixed(0), levyFirst.rate.toFixed(2), levyLast.rate.toFixed(2));
  const billNote = t("co.bill.note", usd(b.homeowner_impact[0].avg_value), b.homeowner_impact[0].year, usd(b.homeowner_impact[b.homeowner_impact.length - 1].avg_value), lastTrend.year, b.homeowner_impact[0].tax_rate.toFixed(2), lastTrend.rate.toFixed(2));
  return (
    <div className="ftm">
      {/* WPR brand chrome bar — shared suite chrome */}
      <ChromeBar {...chrome} year={b.meta.budget_year} status={b.meta.status} />

      <EditionBanner chrome={chrome} adoptedYear={prevYear} />
      <ChangesLog entries={extra.updates} />

      {/* masthead */}
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
        <p className="dek">{proposed
          ? t("co.dekProposed", b.meta.entity, fmtDate(b.meta.presented, lang))
          : t("co.dek", b.meta.entity, fmtDate(b.meta.adopted, lang))}</p>

        <div className="stat-strip">
          <Stat icon="💰" label={proposed ? t("stat.proposed", t("stat.totalBudget")) : t("stat.totalBudget")} value={compact(b.meta.total_expenditures)} sub={budgetPctChange != null ? <Delta value={budgetPctChange} neutral /> : null} />
          <Stat icon="🏛️" label={proposed ? t("stat.proposed", t("co.stat.countyLevy")) : t("co.stat.countyLevy")} value={<FullOrCompact n={b.meta.tax_levy} />} sub={<Delta value={levyPctChange} />} />
          <Stat icon="🏠" label={proposed ? t("stat.proposed", t("stat.millRate")) : t("stat.millRate")} value={<MillRate rate={b.meta.tax_rate} />} sub={<Delta value={ratePctChange} />} />
        </div>
        {budgetDriver && (
          <p className="stat-note">{t("co.stat.driver", tPrev, budgetDriver.name,
            (budgetDriver.change >= 0 ? "+" : "−") + compact(Math.abs(budgetDriver.change)),
            (budgetDriver.change >= 0 ? "+" : "−") + compact(Math.abs(b.history.totals[tLast].total_expenditures - b.history.totals[tPrev].total_expenditures)))}</p>
        )}
      </header>

      <Highlights items={changed} head={proposed ? t("wc.headProposed", b.meta.budget_year) : undefined} />

      <SubNav sections={sections} active={active} routeId={chrome.routeId} />

      {/* WHERE IT GOES */}
      <section id="where" className="block">
        <SectionHead kicker={t(b.general_fund ? "kick.generalFund" : "co.where.fundsKick")} title={t("title.whereDollarGoes")}>
          {b.general_fund ? t("co.where.dek") : t("co.where.fundsDek", fmtDate(chrome.edition.hearing, lang, false), prevYear)}
        </SectionHead>

        {!b.general_fund ? (() => {
          const top = fundRows[0].cur;
          const total = fundRows.reduce((s, r) => s + r.cur, 0);
          return (<>
            <div className="bars">
              {fundRows.map((r, i) => (
                <div className="bar-row no-spark" key={r.name} style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="bar-label">{r.name}</div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(r.cur / top) * 100}%` }} /></div>
                  <div className="bar-val">{compact(r.cur)}</div>
                  <div className="bar-share">{((r.cur / total) * 100).toFixed(0)}%</div>
                  <div className="bar-delta">{r.prior ? <Delta value={(r.cur / r.prior - 1) * 100} neutral /> : <span className="muted">{t("co.where.newFund")}</span>}</div>
                </div>
              ))}
            </div>
            <p className="note">{t("co.where.fundsNote", prevYear, budgetDriver && budgetDriver.name, budgetDriver && signedCompact(budgetDriver.change))}</p>
          </>);
        })() : (<>
        <div className="toggle" role="group" aria-label={t("aria.gfView")}>
          <button aria-pressed={flow === "expenditures"} className={flow === "expenditures" ? "on" : ""} onClick={() => setFlow("expenditures")}>{t("btn.spending")}</button>
          <button aria-pressed={flow === "revenues"} className={flow === "revenues" ? "on" : ""} onClick={() => setFlow("revenues")}>{t("btn.revenue")}</button>
        </div>
        <DivisorToggle divisor={divisor} onChange={setDivisor} />

        <div className="bars">
          {gfRows.map((r, i) => (
            <div className="bar-row" key={r.category} style={{ animationDelay: `${i * 45}ms` }}>
              <div className="bar-label">{r.category}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(r.proposed_next / gfMax) * 100}%` }} />
              </div>
              <Spark className="hide-sm"
                values={[r.actual_prior, r.budget_current, r.proposed_next]}
                tone="ink-soft" />
              <div className="bar-val">{showVal(r.proposed_next)}</div>
              <div className="bar-share">{((r.proposed_next / gfTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={r.pct_change} neutral /></div>
            </div>
          ))}
        </div>
        <p className="note">{t("co.where.note", flow, b.meta.budget_year, publicSafetyShare)}</p>
        {divisor !== "total" && (
          <p className="note">{t("pc.note", demo.population.toLocaleString("en-US"), demo.households.toLocaleString("en-US"), demo.basis)}</p>
        )}
        </>)}
      </section>

      {/* DEPARTMENTS */}
      <section id="departments" className="block">
        <SectionHead kicker={t("co.dept.kick")} title={t("co.dept.title")}>
          {t("co.dept.dek", b.departments.length)}
        </SectionHead>

        <div className="ledger">
          <div className="ledger-head">
            <button aria-pressed={sortKey === "department"} className={sortKey === "department" ? "sorted" : ""} onClick={() => setSort("department")}>{t("co.dept.colDepartment")}{sortHint("department")}</button>
            <button aria-pressed={sortKey === "spend"} className={sortKey === "spend" ? "sorted" : ""} onClick={() => setSort("spend")}>{t("co.dept.colSpend")}{sortHint("spend")}</button>
            <button aria-pressed={sortKey === "personnel"} className={"hide-sm " + (sortKey === "personnel" ? "sorted" : "")} onClick={() => setSort("personnel")}>{t("co.dept.colPersonnel")}{sortHint("personnel")}</button>
            <button aria-pressed={sortKey === "levy"} className={sortKey === "levy" ? "sorted" : ""} onClick={() => setSort("levy")}>{t("co.dept.colLevy")}{sortHint("levy")}</button>
            <button aria-pressed={sortKey === "change"} className={"hide-sm " + (sortKey === "change" ? "sorted" : "")} onClick={() => setSort("change")}>{t("co.dept.colVs", prevYear)}{sortHint("change")}</button>
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
                  <span className="d-spend"><Money n={spend} /></span>
                  <span className="d-pers hide-sm">{usd(d.personnel_expenditures)}</span>
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
                      {d.levy_difference === 0 ? t("co.dept.unchanged", prevYear) :
                        d.levy_difference > 0
                          ? t("co.dept.rose", usd(d.levy_difference), prevYear)
                          : t("co.dept.fell", usd(Math.abs(d.levy_difference)), prevYear)}
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
          {t("co.trends.dek", levyRisePct, levyFirst.year, levyLast.rate < levyFirst.rate)}
        </SectionHead>

        <div className="chart-wrap">
          {/* Two panels, each from zero, not one chart with two scales: the levy's
              rise and the rate's fall read at their true size. */}
          <ChartFrame summary={trendsNote} table={{ columns: [{ key: "year", label: t("col.year") }, { key: "levy", label: t("tip.levy"), fmt: usd }, { key: "rate", label: t("tip.millRate"), fmt: (v) => "$" + v.toFixed(2) }], rows: levyTrend }}>
          <div className="twin-charts">
            <div>
              <h3 className="twin-title">{t("co.trends.legendLevy")}</h3>
              <WithCharts height={250}>{(R) => (
                <R.ResponsiveContainer width="100%" height={250}>
                  <R.BarChart data={levyTrend} margin={{ top: 8, right: 6, bottom: 4, left: 0 }}>
                    <R.CartesianGrid stroke="var(--rule)" vertical={false} />
                    <R.XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} interval="preserveEnd" minTickGap={14} />
                    <R.YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={44} />
                    <R.Tooltip content={<LevyTip />} cursor={{ fill: "var(--paper-2)" }} />
                    <R.Bar dataKey="levy" fill="var(--gold)" radius={[4, 4, 0, 0]} maxBarSize={30}>
                      {/* A proposed year's bar is drawn faint: not yet a levy anyone owes. */}
                      {levyTrend.map((l) => (
                        <R.Cell key={l.year} fillOpacity={proposed && l.year === b.meta.budget_year ? 0.35 : 0.9} />
                      ))}
                    </R.Bar>
                  </R.BarChart>
                </R.ResponsiveContainer>
              )}</WithCharts>
              {proposed && <div className="chart-legend twin-legend"><span><i className="sw sw-levy sw--proposed" /> {t("co.trends.legendProposed", b.meta.budget_year)}</span></div>}
            </div>
            <div>
              <h3 className="twin-title">{t("co.trends.legendRate")}</h3>
              <WithCharts height={250}>{(R) => (
                <R.ResponsiveContainer width="100%" height={250}>
                  <R.LineChart data={levyTrend} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
                    <R.CartesianGrid stroke="var(--rule)" vertical={false} />
                    <R.XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} interval="preserveEnd" minTickGap={14} />
                    <R.YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v.toFixed(0)} width={34} />
                    <R.Tooltip content={<LevyTip />} cursor={{ stroke: "var(--rule)" }} />
                    <R.Line type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </R.LineChart>
                </R.ResponsiveContainer>
              )}</WithCharts>
            </div>
          </div>
          </ChartFrame>
          <p className="note">{trendsNote}</p>
        </div>

        {deptCompare && (
          <div className="chart-wrap" style={{ marginTop: 44 }}>
            <h3 className="subhead">{t("co.trends.subhead", deptCompare.first, deptCompare.last)}</h3>
            <div className="toggle" role="group" aria-label={t("aria.deptCompareView")}>
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

            <p className="note">{t("co.trends.cmpNote", deptCompare.first, deptCompare.last, proposed)}
              {b.history.totals[deptCompare.first].basis === "proposed" && " " + t("co.trends.proposalBasis", deptCompare.first)}</p>
          </div>
        )}
      </section>

      {/* TAX BILL */}
      <section id="bill" className="block">
        <SectionHead kicker={t("kick.bottomLine")} title={t("title.taxbillMeaning")}>
          {t("co.bill.dek", ratePeakYear)}
        </SectionHead>

        <HomeValueCalc id="homeval-c" label={t("co.bill.homeLabel")} outLabel={t("co.bill.estOut", b.meta.budget_year, proposed)}
          outValue={usd(Math.round((homeValue / 1000) * b.meta.tax_rate))} value={homeValue} onChange={setHomeValue} />

        <div className="chart-wrap">
          <ChartFrame summary={billNote} table={{ columns: [{ key: "year", label: t("col.year") }, { key: "rate", label: t("tip.millRate"), fmt: (v) => "$" + v.toFixed(2) }, { key: "bill", label: t("tip.avgBill"), fmt: (v) => usd(Math.round(v)) }], rows: trend }}>
          <div className="twin-charts">
            <div>
              <h3 className="twin-title">{t("co.bill.legendRate")}</h3>
              <WithCharts height={250}>{(R) => (
                <R.ResponsiveContainer width="100%" height={250}>
                  <R.LineChart data={trend} margin={{ top: 8, right: 20, bottom: 4, left: 0 }}>
                    <R.CartesianGrid stroke="var(--rule)" vertical={false} />
                    <R.XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} interval="preserveEnd" minTickGap={14} />
                    <R.YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v.toFixed(0)} width={34} />
                    <R.Tooltip content={<BillTip />} cursor={{ stroke: "var(--rule)" }} />
                    <R.Line type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  </R.LineChart>
                </R.ResponsiveContainer>
              )}</WithCharts>
            </div>
            <div>
              <h3 className="twin-title">{t("co.bill.legendBill")}</h3>
              <WithCharts height={250}>{(R) => (
                <R.ResponsiveContainer width="100%" height={250}>
                  <R.BarChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <R.CartesianGrid stroke="var(--rule)" vertical={false} />
                    <R.XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} interval="preserveEnd" minTickGap={14} />
                    <R.YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => usd(Math.round(v))} width={56} />
                    <R.Tooltip content={<BillTip />} cursor={{ fill: "var(--paper-2)" }} />
                    <R.Bar dataKey="bill" fill="var(--gold)" radius={[4, 4, 0, 0]} maxBarSize={26}>
                      {trend.map((p) => (
                        <R.Cell key={p.year} fillOpacity={proposed && p.year === b.meta.budget_year ? 0.35 : 0.9} />
                      ))}
                    </R.Bar>
                  </R.BarChart>
                </R.ResponsiveContainer>
              )}</WithCharts>
            </div>
          </div>
          </ChartFrame>
          <p className="note">{billNote}</p>
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
            <div className="fund-row" key={f.fund_no || f.name}>
              {/* fund_no is null for the book's unnumbered levy lines (State Special Charges) */}
              <span className="f-name"><b>{f.name}</b>{f.fund_no && <em>#{f.fund_no}</em>}</span>
              <span>{f.tax_levy ? <Money n={f.tax_levy} /> : <span className="muted">{t("co.funds.none")}</span>}</span>
              <span className="hide-sm">{usd(f.operating_revenues)}</span>
              <span><Money n={f.operating_expenditures + f.personnel_expenditures} /></span>
            </div>
          ))}
        </div>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker={t("co.debt.kick")} title={t("title.outstandingDebt")}>
          {t("co.debt.dek", b.debt.length, usd(debtTotal), prevYear)}
        </SectionHead>
        <div className="debt-list">
          {b.debt.map((d) => (
            <div className="debt-row" key={d.series}>
              <span className="db-bar" style={{ width: `${(d.outstanding / debtMax) * 100}%` }} />
              <span className="db-name">{d.series}</span>
              <span className="db-val">{usd(d.outstanding)}</span>
            </div>
          ))}
        </div>
      </section>

      {chrome.edition && <HaveYourSay chrome={chrome} />}

      <Methodology b={b} chrome={chrome} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> <SourceLink source={chrome.source}>{t("co.foot.source", b.meta.entity, b.meta.budget_year, b.meta.status)}</SourceLink>{" "}
          {proposed ? t("foot.proposedAmend", fmtDate(chrome.edition.vote, lang, false)) : t("foot.amended")}</p>
        <p className="muted">{t("co.foot.builtBy")}</p>
        {/* This footnote documents a discrepancy specific to the FY2026 adopted
            book's summary page; it does not carry over to other editions. */}
        {b.meta.budget_year === 2026 && (
          <p className="muted"><b>{t("co.foot.levyLabel")}</b> {t("co.foot.levyBody")}</p>
        )}
      </footer>
    </div>
  );
}

function BillTip({ active, payload, label }) {
  const t = useStrings();
  if (!active || !payload || !payload.length) return null;
  const rate = payload.find((p) => p.dataKey === "rate");
  const bill = payload.find((p) => p.dataKey === "bill");
  return (
    <div className="tip">
      <div className="tip-year">{label}</div>
      {rate && <div><i className="sw sw-rate" /> {t("tip.millRate")} ${rate.value.toFixed(2)}</div>}
      {bill && <div><i className="sw sw-bill" /> {t("tip.avgBill")} {usd(Math.round(bill.value))}</div>}
    </div>
  );
}

function LevyTip({ active, payload, label }) {
  const t = useStrings();
  if (!active || !payload || !payload.length) return null;
  const levy = payload.find((p) => p.dataKey === "levy");
  const rate = payload.find((p) => p.dataKey === "rate");
  return (
    <div className="tip">
      <div className="tip-year">{label}</div>
      {levy && <div><i className="sw sw-levy" /> {t("tip.levy")} {usd(levy.value)}</div>}
      {rate && <div><i className="sw sw-rate" /> {t("tip.millRate")} ${rate.value.toFixed(2)}</div>}
    </div>
  );
}
