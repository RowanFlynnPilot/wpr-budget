import React, { useEffect, useState } from "react";

// The chart library (recharts, ~113 kB gzipped), loaded on first use instead of
// with a body's code: the County, City and School pages paint their text,
// figures and tables at once, and each chart fills its own fixed-height box when
// the library lands — an empty box of the same height meanwhile, so nothing
// moves. children(R) receives the recharts components (rechartsParts.js).
// Chart-free itself, so any module may import it.
//
// Readers who ask their OS for reduced motion get static charts: the CSS
// animations already honor it, but recharts animates in JS. Its series are
// class components with defaultProps, so one switch, made as the library loads,
// covers every chart in the suite.
let lib = null;
let pending = null;
export function loadCharts() {
  pending = pending || import("./rechartsParts").then((R) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const C of [R.Bar, R.Line, R.Area]) C.defaultProps = { ...C.defaultProps, isAnimationActive: false };
    }
    lib = R;
    return R;
  });
  return pending;
}

export function WithCharts({ height, children }) {
  const [R, setR] = useState(lib);
  const [err, setErr] = useState(null);
  useEffect(() => { if (!R) loadCharts().then(setR, setErr); }, [R]);
  if (err) throw err; // the view's error boundary reports it
  return R ? children(R) : <div className="chart-wait" style={{ height }} aria-hidden="true" />;
}
