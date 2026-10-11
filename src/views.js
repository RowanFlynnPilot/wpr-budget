import { fetchData } from "./data";
import { loadCharts } from "./withCharts";

// The four entity bodies, as lazy-load functions: App wraps them in
// React.lazy, and prefetchEntity warms the same chunks.
export const BODY_LOADERS = {
  county: () => import("./bodies/Ledger"),
  city: () => import("./bodies/CityLedger"),
  school: () => import("./bodies/SchoolLedger"),
  taxbill: () => import("./bodies/TaxBillOverview"),
};

// Warm a view before it's opened — its code chunk and data files — on the
// first hover, focus or touch of a link to it, so the click lands without a
// loading screen. Readers who never reach for a link (most embed visitors)
// download nothing extra. A failure is left for the real navigation to report.
const warmed = new Set();
export function prefetchEntity(ent) {
  if (warmed.has(ent.id)) return;
  warmed.add(ent.id);
  BODY_LOADERS[ent.kind]().catch(() => {});
  if (ent.kind !== "taxbill") loadCharts().catch(() => {}); // the Tax Bill view draws no recharts
  for (const f of [ent.data, ...Object.values(ent.with || {})]) fetchData(f).catch(() => {});
}

// Spread onto a link or button that opens `ent`.
export const prefetchProps = (ent) => {
  const go = () => prefetchEntity(ent);
  return { onPointerEnter: go, onFocus: go, onTouchStart: go };
};
