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

// Where the Tax Bill view keeps the reader's municipality (localStorage only);
// a town share page writes it before opening the view.
export const MUNI_KEY = "wpr-budget-muni";

// A municipality's share-page slug: "town-of-ringle" -> /wpr-budget/tax/town-of-ringle/
export const muniSlug = (m) => `${m.type} of ${m.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
