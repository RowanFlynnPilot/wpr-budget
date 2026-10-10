// The tax-bill math in one place, for the UI (billRates in ui.jsx), the CI data
// check (scripts/check-data.mjs) and the build's town share pages
// (scripts/entity-pages.mjs). Plain JS, no React, so Node can import it.
//
// Rates are per $1,000 of FAIR MARKET value (DOR "full" value):
//   county / municipality / college: the levy ÷ the municipality's TIF-out value
//   (TIF increment pays the TIF district, not these levies);
//   school: the district's levy ÷ its value in the municipality, minus the state
//   school levy credit ÷ ALL the municipality's value (TIF increment included).
// Verified against DOR's own published effective rate (extract_dor.py).
export const per1k = (levy, value) => (levy / value) * 1000;

export function billParts(muni, sd) {
  return {
    county: per1k(muni.taxes.county, muni.full_value_ex_tif),
    municipality: per1k(muni.taxes.local, muni.full_value_ex_tif),
    school: per1k(sd.levy, sd.full_value) - per1k(muni.school_levy_credit, muni.full_value),
    college: per1k(muni.taxes.technical_college, muni.full_value_ex_tif),
  };
}

export const billTotal = (muni, sd) => Object.values(billParts(muni, sd)).reduce((s, r) => s + r, 0);

// The state's two per-home credits on the same bills, in dollars: the school
// district's equalized school tax rate (sd.credit_rate, from DOR's credit
// reports) times the year's maximum credit value — or the home's value, if
// less. The lottery & gaming credit is for an owner's primary residence; the
// first-dollar credit for every parcel with a building, businesses included.
// (The third state credit, the school levy credit, is already in the rate.)
export function stateCredits(sd, credits, value, primaryHome = true) {
  const lottery = primaryHome ? sd.credit_rate * Math.min(credits.lottery_max_value, value) : 0;
  const firstDollar = sd.credit_rate * Math.min(credits.first_dollar_max_value, value);
  return { lottery, firstDollar, total: lottery + firstDollar };
}

// What the bill comes to, in dollars: the levies at the bill rate, less the credits.
export const netBill = (muni, sd, credits, value, primaryHome = true) =>
  Math.max(0, (value / 1000) * billTotal(muni, sd) - stateCredits(sd, credits, value, primaryHome).total);

// Where the Tax Bill view keeps the reader's municipality (localStorage only);
// a town share page writes it before opening the view.
export const MUNI_KEY = "wpr-budget-muni";

// A municipality's share-page slug: "town-of-ringle" -> /wpr-budget/tax/town-of-ringle/
export const muniSlug = (m) => `${m.type} of ${m.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
