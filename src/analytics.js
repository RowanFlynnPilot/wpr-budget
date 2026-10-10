// Usage counts for funders and sponsors, via Plausible: WPR's suite-wide
// analytics (the prep-sports site reports to the same account). No cookies, no
// personal data, no consent banner; it works inside the WordPress iframe.
//
// OFF until the deploy sets a repo variable (see "Analytics" in CLAUDE.md):
// PLAUSIBLE_SCRIPT_ID for a site made under Plausible's per-site install flow
// (it silently drops events from the legacy script), else PLAUSIBLE_DOMAIN.
// With neither, every call here is a no-op, and local dev never reports.
//
// Pageviews: hash-based routing counts every view switch (#marathon-county,
// #your-tax-bill …) and subnav jump; the scroll-spy's replaceState is not a
// navigation, so reading down a page doesn't inflate them.
// Events (add each as a custom-event goal in Plausible to see it):
//   Municipality {name}   a reader picked a municipality's tax bill
//   Home value   {view}   a reader entered their own home value (the VALUE is never sent)
//   Language     {lang}   Share {view, method}   Download {view, format}
//   Chart table  {view}   Link {to, view}   Sponsor click {slot}   Embed {host}
const DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN || null;
const SCRIPT_ID = import.meta.env.VITE_PLAUSIBLE_SCRIPT_ID || null;
export const analyticsEnabled = Boolean(SCRIPT_ID || DOMAIN);

let loaded = false;
export function initAnalytics() {
  if (!analyticsEnabled || loaded) return;
  loaded = true;
  // The official queue shim: events fired before the script lands are kept.
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  const s = document.createElement("script");
  if (SCRIPT_ID) {
    window.plausible.init = window.plausible.init || function (o) { window.plausible.o = o || {}; };
    s.async = true;
    s.src = `https://plausible.io/js/${SCRIPT_ID}.js`;
    document.head.appendChild(s);
    window.plausible.init({ hashBasedRouting: true });
  } else {
    s.defer = true;
    s.src = "https://plausible.io/js/script.hash.js";
    s.dataset.domain = DOMAIN;
    document.head.appendChild(s);
  }
}

// The view a reader is on: the route token of the hash ("marathon-county~2027-proposed"), or "home".
export const currentView = () => window.location.hash.slice(1).split("/")[0] || "home";

export function track(name, props) {
  if (!analyticsEnabled) return;
  initAnalytics();
  window.plausible(name, props ? { props } : undefined);
}
