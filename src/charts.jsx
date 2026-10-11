import React from "react";
import { useStrings } from "./i18n";
import { ChartFrame, useEdgeFade } from "./ui";
import { usd, compact } from "./format";
import { WithCharts } from "./withCharts";

// The shared chart pieces (City + School + County bodies). Their recharts parts
// render through WithCharts, so this module doesn't pull the library into a
// body's first paint; still kept out of ui.jsx, which only the eager bundle needs.

/* ---------- chart tooltips ---------- */

// Generic bar-chart tooltip. `seriesName` labels a series whose Bar has no
// `name`; multi-series bars use their own names.
export function BarTip({ active, payload, label, seriesName }) {
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

/* ---------- money-flow Sankey ---------- */

// Sankey node: a colored bar with a label (revenue sources on the left, the
// General Fund hub in the middle, departments/objects on the right).
export function SankeyNode({ x, y, width, height, payload }) {
  const col = payload.col;
  const fill = col === 0 ? "#9a7b2e" : col === 1 ? "#16584a" : "#1c1a16";
  if (height <= 0) return null;
  const amt = compact(payload.value);
  if (col === 1) {
    return (
      <g className="recharts-layer">
        <rect x={x} y={y} width={width} height={height} fill={fill} />
        <text x={x + width / 2} y={y - 9} textAnchor="middle" fontSize={13} fontWeight={700}
          fontFamily="Public Sans Variable, system-ui, sans-serif" fill="#1c1a16">{payload.name} {amt}</text>
      </g>
    );
  }
  const left = col === 0;
  // Small revenue/spending lines layout to a near-invisible sliver; floor the bar
  // so it stays visible and always render the label (nodePadding keeps the stacked
  // labels from colliding). The label centers on the drawn bar.
  const barH = Math.max(height, 2.5);
  return (
    <g className="recharts-layer">
      <rect x={x} y={y} width={width} height={barH} fill={fill} fillOpacity={0.9} />
      <text x={left ? x - 8 : x + width + 8} y={y + barH / 2} textAnchor={left ? "end" : "start"}
        dominantBaseline="middle" fontSize={12} fontWeight={600}
        fontFamily="Public Sans Variable, system-ui, sans-serif" fill="#1c1a16">
        {payload.name} <tspan fill="#6b6555" fontWeight={400}>{amt}</tspan>
      </text>
    </g>
  );
}

// recharts nests a link's resolved node objects at payload[0].payload.payload.
function SankeyTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = (payload[0].payload && payload[0].payload.payload) || payload[0].payload || {};
  const isLink = p.source && p.target && typeof p.source === "object";
  return (
    <div className="tip">
      <div className="tip-year">{isLink ? `${p.source.name} → ${p.target.name}` : p.name}</div>
      <div>{usd(p.value)}</div>
    </div>
  );
}

// The shared revenue -> General Fund -> spending diagram (City + School).
export function MoneyFlowSankey({ data, height, margin, ariaLabel, note }) {
  const t = useStrings();
  // Narrow screens scroll the diagram sideways: fade the edge with more, and say so.
  const [ref, more] = useEdgeFade();
  return (
    <div className="chart-wrap">
      {more && <p className="swipe-hint" aria-hidden="true">{t("chart.swipe")}</p>}
      <div className={"sankey-scroll fade-x" + more} ref={ref}>
        <div className="sankey-inner" role="img" aria-label={ariaLabel}>
          <WithCharts height={height}>{(R) => (
            <R.ResponsiveContainer width="100%" height={height}>
              <R.Sankey data={data} nodePadding={28} nodeWidth={12} iterations={64}
                node={<SankeyNode />} link={{ stroke: "#16584a", strokeOpacity: 0.2 }} margin={margin}>
                <R.Tooltip content={<SankeyTip />} />
              </R.Sankey>
            </R.ResponsiveContainer>
          )}</WithCharts>
        </div>
      </div>
      <p className="note">{note}</p>
    </div>
  );
}

/* ---------- debt retirement chart ---------- */

// Stacked principal/interest retirement schedule (City + School debt sections).
export function DebtChart({ retirement, summary }) {
  const t = useStrings();
  return (
    <>
      <div className="chart-legend">
        <span><i className="sw sw-new" /> {t("lbl.principal")}</span>
        <span><i className="sw sw-old" /> {t("lbl.interest")}</span>
      </div>
      <ChartFrame summary={summary} table={{ columns: [
        { key: "year", label: t("col.year") }, { key: "principal", label: t("lbl.principal"), fmt: usd },
        { key: "interest", label: t("lbl.interest"), fmt: usd }, { key: "total", label: t("col.total"), fmt: usd },
      ], rows: retirement }}>
      <WithCharts height={300}>{(R) => (
        <R.ResponsiveContainer width="100%" height={300}>
          <R.BarChart data={retirement} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
            <R.CartesianGrid stroke="var(--rule)" vertical={false} />
            <R.XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
            <R.YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
            <R.Tooltip content={<BarTip />} cursor={{ fill: "var(--paper-2)" }} />
            <R.Bar dataKey="principal" stackId="d" fill="var(--accent)" name={t("lbl.principal")} maxBarSize={26} />
            <R.Bar dataKey="interest" stackId="d" fill="var(--gold)" fillOpacity={0.82} name={t("lbl.interest")} maxBarSize={26} />
          </R.BarChart>
        </R.ResponsiveContainer>
      )}</WithCharts>
      </ChartFrame>
    </>
  );
}
