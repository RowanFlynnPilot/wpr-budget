import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Sankey, Layer,
} from "recharts";
import { useStrings } from "./i18n";
import { usd, compact } from "./format";

// recharts-dependent shared pieces, kept OUT of ui.jsx on purpose: ui.jsx is in
// the eager bundle (the landing page imports it), and anything here would drag
// the ~560 kB recharts chunk into the first load. Only the lazy bodies import
// this module.

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
  return (
    <div className="chart-wrap">
      <div className="sankey-scroll">
        <div className="sankey-inner" role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height={height}>
            <Sankey data={data} nodePadding={28} nodeWidth={12} iterations={64}
              node={<SankeyNode />} link={{ stroke: "#16584a", strokeOpacity: 0.2 }} margin={margin}>
              <Tooltip content={<SankeyTip />} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="note">{note}</p>
    </div>
  );
}

/* ---------- debt retirement chart ---------- */

// Stacked principal/interest retirement schedule (City + School debt sections).
export function DebtChart({ retirement }) {
  const t = useStrings();
  return (
    <>
      <div className="chart-legend">
        <span><i className="sw sw-new" /> {t("lbl.principal")}</span>
        <span><i className="sw sw-old" /> {t("lbl.interest")}</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={retirement} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--sans)" }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
          <YAxis tick={{ fill: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--sans)" }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1e6).toFixed(0) + "M"} width={46} />
          <Tooltip content={<BarTip />} cursor={{ fill: "var(--paper-2)" }} />
          <Bar dataKey="principal" stackId="d" fill="var(--accent)" name={t("lbl.principal")} maxBarSize={26} />
          <Bar dataKey="interest" stackId="d" fill="var(--gold)" fillOpacity={0.82} name={t("lbl.interest")} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
