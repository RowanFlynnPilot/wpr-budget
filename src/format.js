// Shared number/text formatting for the suite. Figures render in US format in
// every language — official numbers stay as published.
export const usd = (n) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US");

export const compact = (n) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M"
    : a >= 1e3 ? "$" + Math.round(a / 1e3) + "K" : "$" + a;
  return n < 0 ? "−" + s : s;
};

export const pct = (n) => (n > 0 ? "+" : "") + n.toFixed(1) + "%";

// Per-department total spending (County schema identity:
// operating + personnel == tax_levy + operating_revenues).
export const deptSpend = (d) => d.operating_expenditures + d.personnel_expenditures;

// Build a CSV from an array of flat objects and trigger a download.
export function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
