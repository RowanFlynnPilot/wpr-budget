// The recharts components the suite draws with — the one module withCharts.jsx
// loads on demand. Named re-exports keep the chunk tree-shaken to these (a
// dynamic import of "recharts" itself would bring the whole library).
export {
  ResponsiveContainer, BarChart, LineChart, AreaChart, ComposedChart, Sankey,
  Bar, Line, Area, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, LabelList,
} from "recharts";
