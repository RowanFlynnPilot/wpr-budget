import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, AreaChart, Line, Area, ReferenceLine, BarChart, Bar, LabelList,
} from "recharts";
import { useLang, useStrings } from "../i18n";
import { usd, compact, pct } from "../format";
import {
  ENTITY_LOGOS, SectionHead, Stat, FullOrCompact, MillRate, SourceLink, ChartFrame, Delta, Highlights, rankLast, rankNote, risesOf, signedCompact, SubNav, SponsorSlot, Methodology,
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
  const active = useScrollSpy(sections, chrome.routeId);

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

  // The prior fiscal year's label ("2024-25"), derived from the current one.
  const startYr = parseInt(b.meta.fiscal_label.slice(0, 4), 10);
  const priorFy = `${startYr - 1}-${String(startYr).slice(2)}`;

  // Enrollment trend + per-student general-fund spending: each year's adopted
  // Fund 10 budget (gf_history — one figure per budget book, own-book adopted
  // basis) divided by that year's enrollment. Years without a budget book
  // stay null — never divide one year's dollars by another year's heads.
  const enrSeries = useMemo(() => {
    if (!enr) return [];
    return enr.labels.map((label, i) => ({
      label,
      count: enr.counts[i],
      perStudent: b.gf_history[label] ? Math.round(b.gf_history[label] / enr.counts[i]) : null,
    }));
  }, [enr, b.gf_history]);
  const enrNow = enr ? enr.counts[enr.counts.length - 1] : 0;
  const enrThen = enr ? enr.counts[0] : 0;
  const enrChange = enrNow - enrThen;
  const perStudentGF = enr ? Math.round(b.gf_expenditures.total / enrNow) : 0;
  const perStudentAll = enr ? Math.round(b.meta.net_expenditures / enrNow) : 0;

  // The levy and mill-rate items use words, not arrow icons: this year the
  // district held the total levy flat to the dollar (the book prints the
  // change as $0 / 0.00%), and a directional arrow on that — or a red arrow
  // on a falling mill rate — manufactures alarm. Data-driven: a future year
  // with a real levy change reverts to the normal delta.
  // "What changed" carries what the tiles above don't: where this year's mill
  // rate sits in the district's half-century of rates, general-fund spending
  // per student, and enrollment. (Without enrollment data, the levy instead.)
  const enrPrior = enr && enr.counts.length >= 2 ? enr.counts[enr.counts.length - 2] : null;
  const gfPrior = enrPrior && b.gf_history[enr.labels[enr.labels.length - 2]];
  const changed = useMemo(() => ([
    !enr && (levyPct === 0
      ? { label: t("wc.schoolLevy"), value: usd(b.meta.total_levy), note: t("wc.levyFlatNote", priorFy) }
      : { label: t("wc.schoolLevy"), value: usd(b.meta.total_levy), delta: levyPct }),
    { label: t("wc.millRate"), value: "$" + b.meta.mill_rate.toFixed(2),
      note: rankNote(t, rankLast(b.rate_history.map((r) => ({ label: r.label, v: r.rate })), (a, c) => a < c), b.rate_history[0].label, "low")
        || t("wc.rateVsNote", pct(millPct), bridge.base_rate.toFixed(2), priorFy) },
    enr && { label: t("wc.perStudent"), value: usd(perStudentGF),
      delta: gfPrior ? (perStudentGF / (gfPrior / enrPrior) - 1) * 100 : undefined, neutral: true },
    enr && {
      label: t("wc.enrollment"), value: enrNow.toLocaleString(),
      note: t("wc.enrollNote", enrChange, enr.labels[0]),
    },
  ]), [t, b.meta, b.rate_history, levyPct, millPct, bridge, priorFy, enr, enrNow, enrChange, perStudentGF, gfPrior, enrPrior]);

  // Chart summaries: the visible note doubles as each chart's text alternative.
  // The Students section (and so its note) renders only when enrollment data exists.
  const enrNote = enr && t("s.students.note", enr.labels[0], enr.labels[enr.labels.length - 1], usd(perStudentGF), usd(perStudentAll));
  const overNote = t("s.overtime.note", rate[0].label, rate[rate.length - 1].label, valFirst.year, valLast.year);
  const debtNote = t("s.debt.note", debt.retirement[0].year, compact(debt.retirement[0].total), debt.retirement[debt.retirement.length - 1].year);
  return (
    <div className="ftm">
      <ChromeBar {...chrome} year={b.meta.budget_year} />

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
        <p className="dek">{t("s.dek", b.meta.entity)}</p>
        <div className="stat-strip">
          <Stat icon="💰" label={t("stat.totalBudget")} value={compact(b.meta.net_expenditures)} sub={t("s.stat.allFundsNet")} />
          <Stat icon="🏛️" label={t("s.stat.schoolLevy")} value={<FullOrCompact n={b.meta.total_levy} />}
            sub={levyPct === 0 ? t("s.stat.levyFlat", priorFy) : <Delta value={levyPct} />} />
          <Stat icon="🏠" label={t("stat.millRate")} value={<MillRate rate={b.meta.mill_rate} />}
            sub={t("s.stat.vsPrior", pct(millPct), priorFy)} />
        </div>
      </header>

      <Highlights items={changed} />

      <SubNav sections={sections} active={active} routeId={chrome.routeId} />

      {/* WHERE IT GOES — General Fund by object / by source */}
      <section id="where" className="block">
        <SectionHead kicker={t("kick.generalFund")} title={t("title.whereDollarGoes")}>
          {t("s.where.dek", compact(b.meta.gf_expenditures))}
        </SectionHead>
        <div className="toggle" role="group" aria-label={t("aria.gfView")}>
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
              <div className="bar-delta"><Delta value={(r.amount / r.prior - 1) * 100} neutral /></div>
            </div>
          ))}
        </div>
        {gfFlow === "expenditures" && (
          <>
            {/* A show/hide disclosure, styled like every other one ("Show as table"), not as a selected toggle. */}
            <button type="button" className="table-toggle" aria-expanded={showPeople} onClick={() => setShowPeople((v) => !v)} style={{ marginTop: 14 }}>
              {t("s.where.showPeople", showPeople)}
            </button>
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
          ariaLabel={t("aria.flowSchool", compact(b.meta.gf_expenditures), sankey.nodes.find((n) => n.col === 0).name)}
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
              <div className="bar-delta"><Delta value={(f.expenditures / f.prior_expenditures - 1) * 100} neutral /></div>
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
          {/* Two panels, each from zero, instead of one chart with two truncated
              scales: a ~5% enrollment drop and a ~8% per-student rise read as
              what they are, not as two steep crossing lines. */}
          <ChartFrame summary={enrNote} table={{ columns: [{ key: "label", label: t("col.schoolYear") }, { key: "count", label: t("s.students.legendEnroll"), fmt: (v) => v.toLocaleString("en-US") }, { key: "perStudent", label: t("s.students.legendPerStudent"), fmt: usd }], rows: enrSeries }}>
          <div className="twin-charts">
            {[
              { key: "count", title: t("s.students.legendEnroll"), color: "var(--accent)", fmt: (v) => v.toLocaleString("en-US"), axis: (v) => v.toLocaleString("en-US"), notes: enrNotes },
              { key: "perStudent", title: t("s.students.legendPerStudent"), color: "var(--gold)", fmt: usd, axis: (v) => "$" + Math.round(v / 1000) + "K", notes: [] },
            ].map((panel) => (
              <div key={panel.key}>
                <h3 className="twin-title">{panel.title}</h3>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={enrSeries} margin={{ top: 22, right: 6, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} interval={0} />
                    <YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={46} tickFormatter={panel.axis} />
                    <Tooltip cursor={{ fill: "var(--paper-2)" }} content={({ active, payload, label }) => (active && payload && payload.length && payload[0].value != null ? (
                      <div className="tip"><div className="tip-year">{label}</div>{panel.fmt(payload[0].value)}</div>) : null)} />
                    <Bar dataKey={panel.key} fill={panel.color} radius={[4, 4, 0, 0]} maxBarSize={46}>
                      <LabelList dataKey={panel.key} position="top" content={({ x, y, width, value, index }) => (
                        value != null && (index === enrSeries.length - 1 || enrSeries.findIndex((r) => r[panel.key] != null) === index)
                          ? <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)" fontFamily="var(--sans)">{panel.fmt(value)}</text>
                          : null)} />
                    </Bar>
                    {panel.notes.map((a) => (
                      <ReferenceLine key={a.x} x={a.x} stroke="var(--ink-soft)" strokeDasharray="3 3" strokeOpacity={0.75}
                        label={{ value: a.tag, position: "top", fontSize: 10, fill: "var(--ink-soft)", fontFamily: "var(--sans)" }} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
          </ChartFrame>
          <p className="note">{enrNote}</p>
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
          {/* Two panels, each from zero, rather than two scales on one chart. */}
          <ChartFrame summary={overNote} table={{ columns: [{ key: "year", label: t("col.year") }, { key: "rate", label: t("tip.millRate"), fmt: (v) => "$" + v.toFixed(2) }, { key: "valuation", label: t("s.overtime.tipVal"), fmt: compact }], rows: overTime }}>
          <div className="twin-charts">
            <div>
              <h3 className="twin-title">{t("s.overtime.legendRate")}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={overTime} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="var(--rule)" vertical={false} />
                  <XAxis dataKey="year" ticks={otTicks} tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
                  <YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={34} tickFormatter={(v) => "$" + v} />
                  <Tooltip cursor={{ stroke: "var(--rule)" }} content={({ active, payload }) => (active && payload && payload.length ? (
                    <div className="tip"><div className="tip-year">{payload[0].payload.label}</div>{t("s.overtime.tipRate")} ${payload[0].value.toFixed(2)}</div>) : null)} />
                  <Line type="monotone" dataKey="rate" stroke="var(--accent)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                  {overNotes.map((a) => (
                    <ReferenceLine key={a.x} x={a.x} stroke="var(--ink-soft)" strokeDasharray="3 3" strokeOpacity={0.75}
                      label={{ value: a.tag, position: "insideTopRight", fontSize: 10, fill: "var(--ink-soft)", fontFamily: "var(--sans)" }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h3 className="twin-title">{t("s.overtime.legendVal")}</h3>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={overTime.filter((d) => d.valuation != null)} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="var(--rule)" vertical={false} />
                  <XAxis dataKey="year" ticks={otTicks.filter((y) => overTime.some((d) => d.year === y && d.valuation != null))} tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
                  <YAxis domain={[0, "auto"]} tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => "$" + (v / 1e9).toFixed(0) + "B"} />
                  <Tooltip cursor={{ stroke: "var(--rule)" }} content={({ active, payload }) => (active && payload && payload.length ? (
                    <div className="tip"><div className="tip-year">{payload[0].payload.label}</div>{t("s.overtime.tipVal")} {compact(payload[0].value)}</div>) : null)} />
                  <Area type="monotone" dataKey="valuation" stroke="var(--gold)" strokeWidth={2} fill="var(--gold)" fillOpacity={0.16} dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          </ChartFrame>
          <p className="note">{overNote}</p>
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
          <DebtChart retirement={debt.retirement} summary={debtNote} />
          <p className="note">{debtNote}</p>
        </div>
      </section>

      <Methodology b={b} chrome={chrome} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> <SourceLink source={chrome.source}>{t("s.foot.source", b.meta.entity, b.meta.fiscal_label)}</SourceLink> {t("foot.amended")}</p>
        {levyPct === 0 && (
          <p className="muted">{t("s.foot.levyFlat", usd(b.meta.total_levy), priorFy, b.meta.fiscal_label)}</p>
        )}
        <p className="muted">{t("s.foot.builtBy")}</p>
      </footer>
    </div>
  );
}
