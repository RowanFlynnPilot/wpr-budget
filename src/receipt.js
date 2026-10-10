// "Your tax receipt": each government's line on a bill, divided the way its
// own budget spends its property tax. Plain JS (no React), so the CI data check
// can prove every split sums to the whole. Each function returns
// [{ label, key?, share }] with shares summing to 1; `key` marks a line whose
// label is the tool's own words (translated), `label` one the budget prints.

// Marathon County: the levy by fund; the General Fund's part divided among the
// departments with a positive levy, in proportion to it. (Offices that return
// more than they cost — the sales tax in "Non Departmental", the Register of
// Deeds — lower every department's share alike, so they aren't lines.)
export function countyShares(county) {
  const levy = county.meta.tax_levy;
  const gf = county.funds.find((f) => f.name === "General Fund");
  const depts = county.departments.filter((d) => d.tax_levy > 0);
  const deptSum = depts.reduce((s, d) => s + d.tax_levy, 0);
  return [
    ...depts.map((d) => ({ label: d.department, share: (d.tax_levy / deptSum) * (gf.tax_levy / levy) })),
    ...county.funds.filter((f) => f !== gf && f.tax_levy > 0).map((f) => ({ label: f.name, share: f.tax_levy / levy })),
  ];
}

// City of Wausau: the part of the levy the General Fund books as "General
// Property Taxes", divided by general-fund department spending; the rest of
// the levy pays the city's debt and its other funds.
export function cityShares(city) {
  const gfTax = city.general_fund.revenues.find((r) => r.category === "General Property Taxes").proposed;
  const gfShare = gfTax / city.meta.tax_levy;
  const spend = city.general_fund.expenditures;
  const total = spend.reduce((s, e) => s + e.proposed, 0);
  return [
    ...spend.map((e) => ({ label: e.category, share: gfShare * (e.proposed / total) })),
    { key: "rc.cityOther", share: 1 - gfShare },
  ];
}

// Wausau School District: the levy by fund; the General Fund's part divided by
// what it buys (salaries, benefits, other operating costs, transfers).
export function schoolShares(school) {
  const levy = school.levy_total.levy;
  const fund = (re) => school.levy_by_fund.filter((f) => re.test(f.fund)).reduce((s, f) => s + f.levy, 0) / levy;
  const gf = fund(/^General Fund/);
  const objects = school.gf_expenditures.by_object;
  const total = objects.reduce((s, o) => s + o.amount, 0);
  return [
    ...objects.map((o) => ({ label: o.object, share: gf * (o.amount / total) })),
    { key: "rc.schoolDebt", share: fund(/^Debt Service/) },
    { key: "rc.schoolCommunity", share: fund(/^Community Service/) },
  ];
}

// A government's line on the bill (whole dollars), itemized: the `top` largest
// lines, then "everything else" — whose amount is what makes the items add up
// to the line exactly, so the receipt never disagrees with itself by a dollar.
export function itemize(shares, amount, top = 4) {
  const sorted = [...shares].sort((a, c) => c.share - a.share);
  const items = sorted.slice(0, top).map((s) => ({ ...s, amount: Math.round(s.share * amount) }));
  const rest = amount - items.reduce((s, i) => s + i.amount, 0);
  if (sorted.length > top) return [...items, { key: "rc.else", amount: rest }];
  items[0].amount += rest; // no "everything else": the rounding goes to the largest line
  return items;
}
