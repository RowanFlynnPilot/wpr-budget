import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot, ComposedChart, Bar,
} from "recharts";
import { ChevronDown } from "lucide-react";
import { useLang, useStrings } from "../i18n";
import { usd, compact, pct, deptSpend } from "../format";
import {
  ENTITY_LOGOS, SectionHead, Stat, Delta, Balance, Spark, Highlights, SubNav, SponsorSlot,
  Methodology, HomeValueCalc, DivisorToggle, useScrollSpy, useAnchorOnMount, useHomeValue,
} from "../ui";
import ChromeBar from "../ChromeBar";
import demographics from "../demographics.json";

const SECTIONS = ["where", "departments", "trends", "bill", "funds", "debt", "methodology"];

// Marathon County body — the original "Follow the Money" ledger: General Fund
// spending/revenue, the per-department levy ledger, the levy/mill-rate history,
// the homeowner tax-bill calculator, other funds, and outstanding debt.
export default function Ledger({ b, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const [flow, setFlow] = useState("expenditures");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");
  const [open, setOpen] = useState(null);
  const [deptView, setDeptView] = useState("amount");
  const [homeValue, setHomeValue] = useHomeValue();
  const [divisor, setDivisor] = useState("total");
  useAnchorOnMount();
  const active = useScrollSpy(SECTIONS, chrome.activeId);

  // Per-resident / per-household view of the GF bars (curated 2020 Census
  // denominators in src/demographics.json).
  const demo = demographics[chrome.activeId];
  const perDiv = divisor === "resident" ? demo.population : divisor === "household" ? demo.households : 1;
  const showVal = (n) => (divisor === "total" ? compact(n) : usd(Math.round(n / perDiv)));

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

  return (
    <div className="ftm">
      {/* WPR brand chrome bar — shared suite chrome */}
      <ChromeBar {...chrome} year={b.meta.budget_year} />

      {/* masthead */}
      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">{t("common.publicLedger")}</span>
            <span className="dot">·</span>
            <span>{b.meta.entity}</span>
            <SponsorSlot entityId={chrome.activeId} />
          </div>
          {ENTITY_LOGOS[chrome.activeId] && (
            <img className="masthead-logo" src={ENTITY_LOGOS[chrome.activeId]} alt={b.meta.entity} />
          )}
        </div>
        <h1>Follow the Money</h1>
        <p className="dek">{t("co.dek", b.meta.entity, new Date(b.meta.adopted + "T00:00").toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "long", day: "numeric", year: "numeric" }))}</p>

        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.total_expenditures)} sub={budgetPctChange != null ? <Delta value={budgetPctChange} /> : null} />
          <Stat icon="🏛️" label={t("co.stat.countyLevy")} value={usd(b.meta.tax_levy)} sub={<Delta value={levyPctChange} />} />
          <Stat icon="🏠" label={t("stat.millRate")} value={"$" + b.meta.tax_rate.toFixed(2)} sub={<Delta value={ratePctChange} />} />
        </div>
      </header>

      <Highlights items={changed} />

      <SubNav sections={SECTIONS} active={active} entityId={chrome.activeId} />

      {/* WHERE IT GOES */}
      <section id="where" className="block">
        <SectionHead kicker={t("kick.generalFund")} title={t("title.whereDollarGoes")}>
          {t("co.where.dek")}
        </SectionHead>

        <div className="toggle" role="group" aria-label="General fund view">
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
                tone={(r.proposed_next >= r.actual_prior) === (flow === "revenues") ? "pos" : "neg"} />
              <div className="bar-val">{showVal(r.proposed_next)}</div>
              <div className="bar-share">{((r.proposed_next / gfTotal) * 100).toFixed(0)}%</div>
              <div className="bar-delta"><Delta value={r.pct_change} invertColor={flow === "expenditures"} /></div>
            </div>
          ))}
        </div>
        <p className="note">{t("co.where.note", flow)}</p>
        {divisor !== "total" && (
          <p className="note">{t("pc.note", demo.population.toLocaleString("en-US"), demo.households.toLocaleString("en-US"), demo.basis)}</p>
        )}
      </section>

      {/* DEPARTMENTS */}
      <section id="departments" className="block">
        <SectionHead kicker={t("co.dept.kick")} title={t("co.dept.title")}>
          {t("co.dept.dek")}
        </SectionHead>

        <div className="ledger">
          <div className="ledger-head">
            <button aria-pressed={sortKey === "department"} className={sortKey === "department" ? "sorted" : ""} onClick={() => setSort("department")}>{t("co.dept.colDepartment")}</button>
            <button aria-pressed={sortKey === "spend"} className={sortKey === "spend" ? "sorted" : ""} onClick={() => setSort("spend")}>{t("co.dept.colSpend")}</button>
            <button aria-pressed={sortKey === "personnel"} className={"hide-sm " + (sortKey === "personnel" ? "sorted" : "")} onClick={() => setSort("personnel")}>{t("co.dept.colPersonnel")}</button>
            <button aria-pressed={sortKey === "levy"} className={sortKey === "levy" ? "sorted" : ""} onClick={() => setSort("levy")}>{t("co.dept.colLevy")}</button>
            <button aria-pressed={sortKey === "change"} className={"hide-sm " + (sortKey === "change" ? "sorted" : "")} onClick={() => setSort("change")}>{t("co.dept.colVs")}</button>
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
              <YAxis yAxisId="rate" orientation="right" domain={["dataMin - 0.25", "dataMax + 0.25"]} tick={{ fill: "var(--accent)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v.toFixed(1)} width={42} />
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

        <HomeValueCalc id="homeval-c" label={t("co.bill.homeLabel")} outLabel={t("co.bill.estOut", b.meta.budget_year)}
          outValue={usd(Math.round((homeValue / 1000) * b.meta.tax_rate))} value={homeValue} onChange={setHomeValue} />

        <div className="chart-wrap">
          <div className="chart-legend">
            <span><i className="sw sw-rate" /> {t("co.bill.legendRate")}</span>
            <span><i className="sw sw-bill" /> {t("co.bill.legendBill")}</span>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis yAxisId="rate" domain={["dataMin - 0.25", "dataMax + 0.25"]} tick={{ fill: "var(--accent)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + v.toFixed(1)} width={42} />
              <YAxis yAxisId="bill" orientation="right" domain={["dataMin - 25", "dataMax + 25"]} tick={{ fill: "var(--gold)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + Math.round(v)} width={48} />
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
