import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ComposedChart, Line, Area, ReferenceLine,
} from "recharts";
import { useLang, useStrings } from "../i18n";
import { usd, compact } from "../format";
import {
  ENTITY_LOGOS, SectionHead, Stat, Delta, Highlights, SubNav, SponsorSlot, Methodology,
  HomeValueCalc, TaxSplit, ChartNotes, resolveNotes, useScrollSpy, useAnchorOnMount, useHomeValue,
} from "../ui";
import { MoneyFlowSankey, DebtChart } from "../charts";
import ChromeBar from "../ChromeBar";

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

export default function SchoolLedger({ b, chrome }) {
  const t = useStrings();
  const { lang } = useLang();
  const overNotes = resolveNotes(chrome, lang, "overtime");
  const enrNotes = resolveNotes(chrome, lang, "students");
  const [gfFlow, setGfFlow] = useState("expenditures");
  const [showPeople, setShowPeople] = useState(false);
  const [homeValue, setHomeValue] = useHomeValue();
  useAnchorOnMount();

  // Enrollment & per-student (Phase 2b — present when the WISEdash enrollment files
  // were folded in). Headcount trend + general-fund spending per student.
  const enr = b.enrollment;
  const sections = useMemo(() => [
    "where", "flow", "allfunds",
    ...(enr ? ["students"] : []),
    "overtime", "taxbill", "debt", "methodology",
  ], [enr]);
  const active = useScrollSpy(sections, chrome.activeId);

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
  const jtotal = b.levy_total.mill_rate;
  const splitRows = useMemo(() => [...b.levy_by_fund]
    .sort((a, c) => c.mill_rate - a.mill_rate)
    .map((r) => ({ key: r.fund, label: r.fund, rate: r.mill_rate })), [b.levy_by_fund]);

  const debt = b.debt;

  // Enrollment trend + per-student general-fund spending for the two fiscal
  // years the budget book reports (current + prior Fund 10). Earlier years
  // would need DPI per-member finance data (Phase 2c) — never divide one
  // year's dollars by another year's heads.
  const enrSeries = useMemo(() => {
    if (!enr) return [];
    const gfFund = b.funds.find((f) => f.fund_no === 10);
    const startYr = parseInt(b.meta.fiscal_label.slice(0, 4), 10);
    const priorLabel = `${startYr - 1}-${String(startYr).slice(2)}`;
    const gfByLabel = { [b.meta.fiscal_label]: gfFund.expenditures, [priorLabel]: gfFund.prior_expenditures };
    return enr.labels.map((label, i) => ({
      label,
      count: enr.counts[i],
      perStudent: gfByLabel[label] ? Math.round(gfByLabel[label] / enr.counts[i]) : null,
    }));
  }, [enr, b.funds, b.meta.fiscal_label]);
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

  return (
    <div className="ftm">
      <ChromeBar {...chrome} year={b.meta.budget_year} />

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
        <p className="dek">{t("s.dek", b.meta.entity)}</p>
        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.net_expenditures)} sub={t("s.stat.allFundsNet")} />
          <Stat icon="🏛️" label={t("s.stat.schoolLevy")} value={usd(b.meta.total_levy)} sub={<Delta value={levyPct} />} />
          <Stat icon="🏠" label={t("stat.millRate")} value={b.meta.mill_rate.toFixed(2)} sub={<Delta value={millPct} invertColor />} />
        </div>
      </header>

      <Highlights items={changed} />

      <SubNav sections={sections} active={active} entityId={chrome.activeId} />

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
        <MoneyFlowSankey data={sankey} height={420}
          margin={{ top: 24, right: 150, bottom: 24, left: 150 }}
          ariaLabel={`Money-flow diagram: General Fund revenue sources flowing into the ${compact(b.meta.gf_expenditures)} general fund and out to spending. Largest source: State Aids.`}
          note={t("s.flow.note")} />
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
          <div className="chart-legend">
            <span><i className="sw" style={{ background: "var(--accent)" }} /> {t("s.students.legendEnroll")}</span>
            <span><i className="sw" style={{ background: "var(--gold)" }} /> {t("s.students.legendPerStudent")}</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={enrSeries} margin={{ top: 8, right: 12, bottom: 4, left: 6 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
              <YAxis yAxisId="enr" domain={["dataMin - 200", "dataMax + 200"]} tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => v.toLocaleString()} />
              <YAxis yAxisId="ps" orientation="right" domain={["dataMin - 400", "dataMax + 400"]} tick={{ fill: "var(--gold)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => "$" + (v / 1000).toFixed(1) + "K"} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const c = payload.find((p) => p.dataKey === "count");
                const ps = payload.find((p) => p.dataKey === "perStudent");
                return (
                  <div className="tip">
                    <div className="tip-year">{label}</div>
                    {c && <div><i className="sw" style={{ background: "var(--accent)" }} /> {c.value.toLocaleString()} {t("s.students.studentsLabel")}</div>}
                    {ps && ps.value != null && <div><i className="sw" style={{ background: "var(--gold)" }} /> {usd(ps.value)} {t("s.students.tipPerStudent")}</div>}
                  </div>
                );
              }} cursor={{ stroke: "var(--rule)" }} />
              <Area yAxisId="enr" type="monotone" dataKey="count" name="Enrollment" stroke="var(--accent)" strokeWidth={2.5}
                fill="var(--accent)" fillOpacity={0.12} dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              <Line yAxisId="ps" type="monotone" dataKey="perStudent" name="Per student" stroke="var(--gold)" strokeWidth={2.5}
                connectNulls dot={{ r: 3.5, fill: "var(--gold)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              {enrNotes.map((a) => (
                <ReferenceLine key={a.x} yAxisId="enr" x={a.x} stroke="var(--ink-soft)" strokeDasharray="3 3" strokeOpacity={0.75}
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

        <HomeValueCalc id="homeval-s" label={t("s.taxbill.homeLabel")} outLabel={t("s.taxbill.estOut")}
          outValue={usd(Math.round((homeValue / 1000) * jtotal))} value={homeValue} onChange={setHomeValue} />

        <TaxSplit rows={splitRows} total={jtotal} homeValue={homeValue} totalLabel={t("s.taxbill.totalRow")} />
        <p className="note">{t("s.taxbill.note", b.meta.fiscal_label, jtotal.toFixed(2))}</p>
      </section>

      {/* DEBT */}
      <section id="debt" className="block">
        <SectionHead kicker={t("s.debt.kick")} title={t("title.outstandingDebt")}>
          {t("s.debt.dek", compact(debt.outstanding_principal), compact(debt.total_interest_remaining))}
        </SectionHead>
        <div className="chart-wrap">
          <DebtChart retirement={debt.retirement} />
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
