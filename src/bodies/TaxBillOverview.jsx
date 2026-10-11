import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, LocateFixed, ZoomIn, ZoomOut } from "lucide-react";
import { useLang, useStrings } from "../i18n";
import { usd, fmtDate } from "../format";
import entities from "../entities.json";
import { track } from "../analytics";
import { billDollars, billParts, muniBills, muniSlug, netBill, stateCredits } from "../taxmath";
import { countyShares, cityShares, schoolShares, itemize } from "../receipt";
import { locate, ringsOf, WAUSAU_AREA } from "../mapgeo";
import {
  SponsorSlot, SourceLink, SectionHead, HomeValueCalc, TaxSplit, MuniPicker, SchoolPicker, billRates, billExtremes, placeLabel,
  PrimaryHomeToggle, useAnchorOnMount, useHomeValue, useMuniChoice, useSchoolChoice, usePrimaryHome, WAUSAU_CITY_DOR,
  CountyShapes, RAMP, rampColor, MoneyInput, NEWSLETTER_URL, countLink,
} from "../ui";
import ChromeBar from "../ChromeBar";

// Cross-entity overview: ANY Marathon County homeowner's complete local
// property-tax bill — pick the municipality (and, where it spans more than one,
// the school district), enter the home's fair market value — split across every
// taxing government, each row clickable through to its entity where the suite
// has one. Sourced from the Wisconsin DOR's Town, Village and City Taxes data
// (b = public/marathon-tax-districts.json): every municipality's actual levies
// and values for the latest certified year, on one basis (see billRates).
// Share this municipality's own page (/tax/<slug>/): its card names the
// place and what a $200,000 home pays there. Never the reader's home value.
function ShareTown({ muni, where }) {
  const t = useStrings();
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${import.meta.env.BASE_URL}tax/${muniSlug(muni)}/`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${where} — Follow the Money`, url });
        track("Share", { view: "your-tax-bill", method: "native", town: where });
      } else {
        await navigator.clipboard.writeText(url);
        track("Share", { view: "your-tax-bill", method: "copy", town: where });
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch (e) { /* dismissed, or the clipboard was blocked */ }
  };
  return (
    <button type="button" className="table-toggle share-town" onClick={share}>
      {copied ? t("tb.shareCopied") : t("tb.shareTown", where)}
    </button>
  );
}

// "Your tax receipt": the bill above, line by line down to what each
// government's share pays for — split the way each one's own budget spends its
// property tax (src/receipt.js). The county is itemized for every home; the
// City of Wausau and the Wausau School District where the home is in them (the
// suite has their budgets); any other municipality or district stays one line.
const DETAIL = {
  "marathon-county": (bud) => countyShares(bud.county),
  "wausau-city": (bud) => cityShares(bud.city),
  "wausau-school": (bud) => schoolShares(bud.school),
};
function Receipt({ rows, homeValue, credits, where, school, year, budgets }) {
  const t = useStrings();
  const bill = billDollars(rows.map((r) => r.rate), homeValue, credits); // the same dollars as the bill above
  return (
    <section id="receipt" className="block">
      <SectionHead kicker={t("rc.kick")} title={t("rc.title")}>{t("rc.dek", usd(bill.net))}</SectionHead>
      <div className="receipt">
        <div className="receipt-head">
          <b>{t("rc.head")}</b>
          <span>{t("rc.meta", where, school.name, usd(homeValue), year)}</span>
        </div>
        <table>
          <caption className="sr-only">{t("rc.title")}</caption>
          {rows.map((r, i) => {
            const amount = bill.lines[i];
            const detail = r.drillId && DETAIL[r.drillId];
            return (
              <tbody key={r.key}>
                <tr className="rc-gov"><th scope="row">{r.label}{r.suffix && " " + t(r.suffix)}</th><td>{usd(amount)}</td></tr>
                {detail
                  ? itemize(detail(budgets), amount).map((it) => (
                    <tr className="rc-item" key={it.key || it.label}>
                      <th scope="row">{it.key ? t(it.key) : it.label}</th><td>{usd(it.amount)}</td>
                    </tr>))
                  : r.key !== "college" && <tr className="rc-note"><td colSpan={2}>
                    {t("rc.noDetail", r.label)}
                  </td></tr>}
              </tbody>
            );
          })}
          <tfoot>
            <tr><th scope="row">{t("tb.leviedRow")}</th><td>{usd(bill.levied)}</td></tr>
            {credits.lottery > 0 && <tr className="rc-credit"><th scope="row">{t("tb.credit.lottery")}</th><td>{"\u2212" + usd(bill.lottery)}</td></tr>}
            <tr className="rc-credit"><th scope="row">{t("tb.credit.first")}</th><td>{"\u2212" + usd(bill.firstDollar)}</td></tr>
            <tr className="rc-total"><th scope="row">{t("rc.pay")}</th><td>{usd(bill.net)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p className="note">{t("rc.note")}</p>
    </section>
  );
}

// "Use my location": the phone's (or browser's) position, matched to a
// municipality HERE, against the map's boundaries (src/mapgeo.js) — never sent
// or stored. The boundaries are generalized and positions have an uncertainty,
// so the neighbors whose line runs within that distance (300 m at least) are
// offered as one-tap switches; the bill names the municipality for certain.
function UseLocation({ map, municipalities, onPick }) {
  const t = useStrings();
  const [st, setSt] = useState(null); // null | { busy } | { code, near, rough } | { error }
  const name = (code) => { const m = municipalities.find((x) => x.code === code); return `${m.type} of ${m.name}`; };
  if (!("geolocation" in navigator)) return null;
  const find = () => {
    setSt({ busy: true });
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const r = locate(map, coords.longitude, coords.latitude, Math.max(coords.accuracy, 300));
      if (!r.code) { setSt({ error: "tb.loc.outside" }); return; }
      track("Municipality", { name: name(r.code), via: "location" });
      onPick(r.code);
      setSt({ code: r.code, near: r.near.slice(0, 3), rough: coords.accuracy > 2000 });
    }, (e) => setSt({ error: e.code === 1 ? "tb.loc.denied" : "tb.loc.failed" }),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 600000 });
  };
  const switchTo = (code) => {
    track("Municipality", { name: name(code), via: "location-near" });
    onPick(code);
    setSt({ ...st, code, near: [st.code, ...st.near.filter((c) => c !== code)] });
  };
  return (
    <div className="loc">
      <button type="button" className="table-toggle loc-btn" onClick={find} disabled={Boolean(st && st.busy)}>
        <LocateFixed size={15} strokeWidth={2.25} aria-hidden="true" />{st && st.busy ? t("tb.loc.finding") : t("tb.loc.use")}
      </button>
      <p className="loc-status" role="status">
        {!st || st.busy ? t("tb.loc.privacy")
          : st.error ? t(st.error)
          : <>
            {t("tb.loc.found", name(st.code))}{st.rough && " " + t("tb.loc.rough")}
            {st.near.length > 0 && <> {t("tb.loc.near")}{" "}
              {st.near.map((c) => <button key={c} type="button" className="loc-alt" onClick={() => switchTo(c)}>{name(c)}</button>)}
            </>}
          </>}
      </p>
    </div>
  );
}

// "Same home, different bill", mapped: every municipality shaded by its bill
// on the reader's home (the Ranking's own figures), on ONE continuous ramp from
// the lowest bill to the highest. Not grouped into bands: two-thirds of the
// bills sit within ~$500 of each other, so any break would split near-identical
// towns and the picture would be the classification's, not the data's. Mouse
// and touch pick a place, like the list below — which is the keyboard and
// screen-reader equivalent (to them the map is one labeled image).
// Boundaries: public/marathon-map.json (scripts/extract_map.py, Census); the
// shading: rampColor (ui.jsx).
const median = (xs) => { const s = [...xs].sort((a, c) => a - c); return s[Math.floor(s.length / 2)]; };

function CountyMap({ map, rows, mine, homeValue, onPick }) {
  const t = useStrings();
  const [tip, setTip] = useState(null); // { r, x, y, w } — px within the map
  const wrap = useRef(null);
  const byCode = useMemo(() => new Map(rows.map((r) => [r.m.code, r])), [rows]);
  const bills = rows.map((r) => r.bill);
  const [lo, hi] = [Math.min(...bills), Math.max(...bills)];
  const shade = (bill) => rampColor((bill - lo) / (hi - lo || 1));
  const dollars = (n) => usd(Math.round(n));
  const { width: W, height: H, units_per_mile: upm } = map.meta;
  const name = (m) => `${m.type} of ${m.name}`;

  // The view: the whole county, or the Wausau area (its core's box, padded and
  // given the map's proportions, so the figure never changes size). The change
  // animates unless the reader has asked for less motion.
  const area = useMemo(() => {
    const pts = map.shapes.filter((s) => WAUSAU_AREA.includes(s.code)).flatMap((s) => ringsOf(s.d).flat());
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    let w = (Math.max(...xs) - Math.min(...xs)) * 1.15, h = (Math.max(...ys) - Math.min(...ys)) * 1.15;
    if (w / h < W / H) w = (h * W) / H; else h = (w * H) / W;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return [Math.min(Math.max(0, cx - w / 2), W - w), Math.min(Math.max(0, cy - h / 2), H - h), w, h];
  }, [map, W, H]);
  const [zoom, setZoom] = useState(false);
  const [view, setView] = useState([0, 0, W, H]);
  const shown = useRef(view);
  shown.current = view;
  useEffect(() => {
    const from = shown.current, to = zoom ? area : [0, 0, W, H];
    if (from.every((v, i) => v === to[i])) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setView(to); return undefined; }
    let raf, t0;
    const step = (now) => {
      t0 = t0 ?? now;
      const f = Math.min(1, (now - t0) / 420);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(2 - 2 * f, 3) / 2;
      setView(from.map((v, i) => v + (to[i] - v) * e));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [zoom, area, W, H]);
  const [vx, vy, vw, vh] = view;
  const frac = ([x, y]) => [(x - vx) / vw, (y - vy) / vh];
  const inView = (q, margin = 0) => frac(q).every((f) => f >= margin && f <= 1 - margin);
  const pos = (q) => ({ left: frac(q)[0] * 100 + "%", top: frac(q)[1] * 100 + "%" });
  // a scale bar that fits the view: the longest of 10, 5, 2, 1 miles under ~a fifth of it
  const miles = [10, 5, 2, 1].find((n) => n * upm <= vw * 0.22) || 1;

  const sel = map.shapes.find((s) => s.code === mine.m.code);
  // Place names for bearings: "Wausau" on the whole county; zoomed in, every
  // city and village in view (towns share their names with them, so they're
  // left to the tooltip) — most populous first, as that's the order the layout
  // effect below keeps them in when two would collide.
  const named = map.shapes
    .filter((s) => s !== sel && (zoom ? s.type !== "Town" : s.code === WAUSAU_CITY_DOR))
    .sort((a, c) => byCode.get(c.code).m.population - byCode.get(a.code).m.population);
  const hover = tip && map.shapes.find((s) => s.code === tip.r.m.code);
  const loRow = rows.find((r) => r.bill === lo), hiRow = rows.find((r) => r.bill === hi);
  // what differs: the municipality's own levy (the county's share is the same
  // everywhere, the school share similar) — medians by type, on this home
  const local = (type) => dollars(median(rows.filter((r) => r.m.type === type)
    .map((r) => (homeValue / 1000) * billParts(r.m, r.m.school_districts[0]).municipality)));
  const selShown = inView(sel.label);
  const below = frac(sel.label)[1] < 0.28;
  // After layout: the pick's label centered over its pin but kept inside the
  // map; then each place name, in order, hidden if it would overlap a label
  // already placed (the pick's always wins).
  const label = useRef(null);
  useLayoutEffect(() => {
    const place = () => {
      const taken = [];
      if (label.current) {
        const w = wrap.current.clientWidth, lw = label.current.offsetWidth;
        label.current.style.left = Math.max(0, Math.min(w - lw, frac(sel.label)[0] * w - lw / 2)) + "px";
        taken.push(label.current.getBoundingClientRect());
      }
      for (const el of wrap.current.querySelectorAll(".cmap-anchor")) {
        const r = el.getBoundingClientRect();
        const hit = taken.some((q) => r.left < q.right + 4 && q.left < r.right + 4 && r.top < q.bottom + 2 && q.top < r.bottom + 2);
        el.style.visibility = hit ? "hidden" : "";
        if (!hit) taken.push(r);
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  return (
    <figure className="cmap">
      <div className="cmap-tools">
        <button type="button" className="table-toggle cmap-zoom" aria-pressed={zoom} onClick={() => { setTip(null); setZoom(!zoom); }}>
          {zoom ? <ZoomOut size={15} strokeWidth={2.25} aria-hidden="true" /> : <ZoomIn size={15} strokeWidth={2.25} aria-hidden="true" />}
          {zoom ? t("tb.map.zoomOut") : t("tb.map.zoomIn")}
        </button>
      </div>
      <div className="cmap-wrap" ref={wrap} onMouseLeave={() => setTip(null)}>
        <CountyShapes map={map} view={view} fill={(code) => shade(byCode.get(code).bill)}
          label={t("tb.map.alt", rows.length, usd(homeValue), dollars(lo), name(loRow.m), dollars(hi), name(hiRow.m))}
          shapeProps={(s) => ({
            onMouseMove: (e) => {
              const b = wrap.current.getBoundingClientRect();
              setTip({ r: byCode.get(s.code), x: e.clientX - b.left, y: e.clientY - b.top, w: b.width });
            },
            onClick: () => { setTip(null); onPick(s.code); },
          })}>
          {hover && hover !== sel && <path className="cmap-hover" d={hover.d} />}
          <path className="cmap-sel" d={sel.d} />
        </CountyShapes>
        {named.filter((s) => inView(s.label, 0.07)).map((s) => (
          <span key={s.code} className="cmap-anchor" style={pos(s.label)} aria-hidden="true">{s.name}</span>
        ))}
        {selShown && <>
          <span className="cmap-pin" style={pos(sel.label)} aria-hidden="true" />
          <span ref={label} className={"cmap-label" + (below ? " below" : "")} style={{ top: pos(sel.label).top }} aria-hidden="true">
            <em>{t("tb.cmp.yours")}</em>{name(mine.m)} <b>{dollars(mine.bill)}</b>
          </span>
        </>}
        <div className="cmap-scale" style={{ width: `${((miles * upm) / vw) * 100}%` }} aria-hidden="true">
          <i /><span>{t("tb.map.miles", miles)}</span>
        </div>
        {tip && (
          <div className="cmap-tip" style={{ left: Math.max(100, Math.min(tip.x, tip.w - 100)), top: tip.y }}>
            <div className="tip-year">{name(tip.r.m)}{tip.r.m.split_county ? " " + t("tb.splitPart") : ""}</div>
            <div>{t("tb.map.perYear", dollars(tip.r.bill))}</div>
            {tip.r.max > tip.r.min && <div className="cmap-tip-range">{t("tb.map.range", dollars(tip.r.min), dollars(tip.r.max))}</div>}
          </div>
        )}
      </div>
      <div className="cmap-legend" aria-hidden="true">
        <div className="cmap-ramp">
          <div className="cmap-ramp-label">{t("tb.map.legend", usd(homeValue))}</div>
          <div className="cmap-ramp-bar" style={{ background: `linear-gradient(90deg, ${RAMP.join(", ")})` }}>
            <i style={{ left: ((mine.bill - lo) / (hi - lo || 1)) * 100 + "%" }} />
          </div>
          <div className="cmap-ramp-ends"><span>{dollars(lo)}</span><span>{dollars(hi)}</span></div>
        </div>
      </div>
      <figcaption className="note">
        {t("tb.map.why", local("Town"), local("Village"), local("City"))} {t("tb.map.how")}{" "}
        <a href={map.meta.source_url} rel="noopener">{t("tb.map.source")}</a>
      </figcaption>
    </figure>
  );
}

// "Same home, different bill": every municipality's bill on the reader's own
// home value, ranked dearest first. A municipality spanning several school
// districts is ranked by its largest district (the thin line under its bar is
// the range across them) — except the reader's own, which shows the district
// they chose. Collapsed: the five dearest, the five cheapest, and the reader's.
// A row is a button: it opens that municipality's bill above.
const RANK_EDGE = 5;
function Ranking({ municipalities, muni, school, homeValue, credits, primary, map, onPick, onChoose }) {
  const t = useStrings();
  const [all, setAll] = useState(false);
  // Bills after the state's credits, in dollars, on the reader's own value and
  // primary-home choice (credits are capped, so the order can shift with value).
  const rows = useMemo(() => muniBills(municipalities, credits, homeValue, primary, { code: muni.code, school }),
    [municipalities, muni.code, school, credits, homeValue, primary]);
  const { lo, hi } = useMemo(() => billExtremes(municipalities, credits, homeValue, primary), [municipalities, credits, homeValue, primary]);
  const top = Math.max(...rows.map((r) => r.max)) || 1;
  const dollars = (n) => usd(Math.round(n));
  const mine = rows.findIndex((r) => r.m.code === muni.code);
  const shown = all ? rows.map((r, i) => i)
    : [...new Set([...rows.keys()].filter((i) => i < RANK_EDGE || i >= rows.length - RANK_EDGE).concat(mine))].sort((a, c) => a - c);
  return (
    <section id="compare" className="block">
      <SectionHead kicker={t("tb.cmp.kick")} title={t("tb.cmp.title")}>
        {t("tb.cmp.dek", usd(homeValue), rows.length)}
      </SectionHead>
      <p className="rank-lede">{t("tb.cmp.range", dollars(lo.bill), placeLabel(t, lo), dollars(hi.bill), placeLabel(t, hi), dollars(hi.bill - lo.bill))}</p>
      <CountyMap map={map} rows={rows} mine={rows[mine]} homeValue={homeValue} onPick={(code) => {
        const { m } = rows.find((r) => r.m.code === code);
        track("Municipality", { name: `${m.type} of ${m.name}`, via: "map" });
        onChoose(code);
      }} />
      <ol className="rank-list">
        {shown.map((i, k) => {
          const r = rows[i];
          const on = i === mine;
          const gap = k > 0 && i - shown[k - 1] > 1;
          return (
            <React.Fragment key={r.m.code}>
              {gap && <li className="rank-gap" aria-hidden="true">⋯</li>}
              <li className={"rank-row" + (on ? " on" : "")}>
                <button type="button" aria-current={on || undefined} onClick={() => {
                  track("Municipality", { name: `${r.m.type} of ${r.m.name}`, via: "ranking" });
                  onPick(r.m.code);
                }}>
                  <span className="rank-n">{i + 1}</span>
                  <span className="rank-name">{r.m.type} of {r.m.name}{r.m.split_county ? " " + t("tb.splitPart") : ""}
                    {on && <em className="rank-yours">{t("tb.cmp.yours")}</em>}</span>
                  <span className="rank-bar" aria-hidden="true">
                    <i style={{ width: (r.bill / top) * 100 + "%" }} />
                    {r.max > r.min && <s style={{ left: (r.min / top) * 100 + "%", width: ((r.max - r.min) / top) * 100 + "%" }} />}
                  </span>
                  <span className="rank-val">{dollars(r.bill)}</span>
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      <button type="button" className="table-toggle" aria-expanded={all} onClick={() => setAll(!all)}>
        {all ? t("tb.cmp.showFewer") : t("tb.cmp.showAll", rows.length)}
      </button>
      <p className="note">{t("tb.cmp.note")}</p>
    </section>
  );
}

// "The same home, across the county line": Marathon County and the eight
// counties around it (public/neighbor-tax-districts.json — the same DOR data,
// year and credits), each municipality's bill on the reader's home in its
// largest school district (muniBills), the reader's own pick as they set it.
// One row per county on one scale: a line from its lowest bill to its highest,
// a dot for its largest place. Sorted by the county's typical (median) bill.
function Neighbors({ nb, municipalities, muni, school, homeValue, credits, primary }) {
  const t = useStrings();
  const dollars = (n) => usd(Math.round(n));
  const counties = useMemo(() => [{ county: "Marathon", municipalities }, ...nb.counties].map((c) => {
    const rows = muniBills(c.municipalities, credits, homeValue, primary,
      c.municipalities === municipalities ? { code: muni.code, school } : null);
    const sorted = [...rows].sort((a, z) => a.bill - z.bill);
    const big = [...c.municipalities].sort((a, z) => z.population - a.population)[0];
    return {
      county: c.county, home: c.municipalities === municipalities, n: rows.length,
      lo: sorted[0], hi: sorted.at(-1), median: sorted[Math.floor(sorted.length / 2)].bill,
      big: rows.find((r) => r.m.code === big.code), mine: rows.find((r) => r.m.code === muni.code),
    };
  }).sort((a, z) => z.median - a.median), [nb, municipalities, muni.code, school, homeValue, credits, primary]);
  const lo = Math.min(...counties.map((c) => c.lo.bill)), hi = Math.max(...counties.map((c) => c.hi.bill));
  const x = (bill) => ((bill - lo) / (hi - lo)) * 100 + "%";
  const place = (r, county) => `${r.m.type} of ${r.m.name}${r.m.split_county ? " " + t("nb.part", county) : ""}`;
  const loC = counties.find((c) => c.lo.bill === lo), hiC = counties.find((c) => c.hi.bill === hi);
  return (
    <section id="neighbors" className="block">
      <SectionHead kicker={t("nb.kick")} title={t("nb.title")}>{t("nb.dek", usd(homeValue))}</SectionHead>
      <p className="rank-lede">{t("nb.lede", dollars(lo), place(loC.lo, loC.county) + ", " + t("nb.county", loC.county),
        dollars(hi), place(hiC.hi, hiC.county) + ", " + t("nb.county", hiC.county))}</p>
      <ol className="nb-list">
        {counties.map((c) => (
          <li key={c.county} className={"nb-row" + (c.home ? " home" : "")}>
            <div className="nb-head">
              <b>{t("nb.county", c.county)}</b>
              <span>{t("nb.typical", dollars(c.median))} · {t("nb.places", c.n)}</span>
            </div>
            <div className="nb-strip" aria-hidden="true">
              <i className="nb-range" style={{ left: x(c.lo.bill), width: `calc(${x(c.hi.bill)} - ${x(c.lo.bill)})` }} />
              <i className="nb-big" style={{ left: x(c.big.bill) }} />
              {c.home && <i className="nb-mine" style={{ left: x(c.mine.bill) }} />}
            </div>
            <div className="nb-ends">
              <span>{dollars(c.lo.bill)} {place(c.lo, c.county)}</span>
              <span>{dollars(c.hi.bill)} {place(c.hi, c.county)}</span>
            </div>
            <div className="nb-big-label">
              <i aria-hidden="true" />{place(c.big, c.county)} <b>{dollars(c.big.bill)}</b>
              {c.home && <> · <em>{t("tb.cmp.yours")}</em> {place(c.mine, c.county)} <b>{dollars(c.mine.bill)}</b></>}
            </div>
          </li>
        ))}
      </ol>
      <p className="note">{t("nb.note", nb.meta.tax_year)}</p>
    </section>
  );
}

// "Is your assessment fair?": the bill is figured on the ASSESSED value, and
// each municipality assesses at its own share of market value (DOR's
// assessment level: 0.54 to 1.02 here). Assessed value ÷ the bill's average
// assessment ratio = the market value the assessment stands for; next to what
// the reader says the home would sell for (the value above), a ratio more than
// 10% over the municipality's average — the band Wisconsin's own assessment
// standard uses — is worth raising at Open Book or the Board of Review. A rough
// check, said so; the assessed value is never stored.
const DOR_GUIDE_URL = "https://www.revenue.wi.gov/DOR%20Publications/pb060.pdf";
const PA115A_URL = "https://www.revenue.wi.gov/DORForms/pa-115a.pdf";
function AssessmentCheck({ muni, where, homeValue, year }) {
  const t = useStrings();
  const [assessed, setAssessed] = useState(0);
  const [ratioText, setRatioText] = useState(null); // null: DOR's level for the municipality
  useEffect(() => setRatioText(null), [muni.code]);
  const ratio = ratioText == null ? muni.assessment_level : Number(ratioText);
  const ok = assessed > 0 && ratio > 0.2 && ratio <= 1.5;
  const pct = (f) => Math.round(f * 100) + "%";
  const mine = assessed / homeValue;
  const verdict = !ok ? null : mine > ratio * 1.1 ? "as.high" : mine < ratio * 0.9 ? "as.low" : "as.fair";
  return (
    <section id="assessment" className="block">
      <SectionHead kicker={t("as.kick")} title={t("as.title")}>{t("as.dek")}</SectionHead>
      <div className="as-inputs">
        <label className="as-field">
          <span>{t("as.assessed")}</span>
          <span className="card-field">$<MoneyInput value={assessed} onValue={setAssessed} aria-describedby="as-out" /></span>
        </label>
        <label className="as-field">
          <span>{t("as.ratio")}</span>
          <input type="text" inputMode="decimal" className="as-ratio" value={ratioText ?? String(muni.assessment_level)}
            onChange={(e) => setRatioText(e.target.value)} />
        </label>
      </div>
      <p className="note as-hint">{t("as.ratioHint", where, String(muni.assessment_level), year)}</p>
      <div id="as-out" className="as-out" aria-live="polite">
        {!ok ? <p>{t("as.prompt")}</p> : <>
          <p>{t("as.implied", usd(assessed), String(ratio), usd(Math.round(assessed / ratio)))}</p>
          <p className={"as-verdict " + verdict.slice(3)}>{t(verdict, pct(mine), pct(ratio), usd(homeValue), where)}</p>
        </>}
      </div>
      <h3 className="as-how">{t("as.how")}</h3>
      <ol className="as-steps">
        <li>{t("as.step1")}</li>
        <li>{t("as.step2")}</li>
        <li>{t("as.step3")}</li>
      </ol>
      <p className="as-links">
        <a href={DOR_GUIDE_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("dor-guide")}>{t("as.guide")}</a>
        <a href={PA115A_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("pa-115a")}>{t("as.form")}</a>
      </p>
      <p className="note">{t("as.dates")} {t("as.note")}</p>
    </section>
  );
}

// "Key dates": what's ahead for a home in the reader's municipality — the
// County budget's hearing and vote (the proposed edition's own dates, while
// they're ahead), the bills, and the installments to the right treasurer: the
// City of Wausau collects its own three (Jan 31, Apr 30, Jul 31); everywhere
// else, the first goes to the municipal treasurer and the last to the County
// Treasurer (Marathon County Treasurer's "Dates to remember"). Each date is its
// next occurrence from today. "Add to calendar" writes an .ics file on the
// device; nothing is sent. The newsletter link is tagged for this section.
const TREASURER_DATES_URL = "https://www.marathoncounty.gov/about-us/departments/county-treasurer/dates-to-remember";
const DATES_SIGNUP_URL = NEWSLETTER_URL + "&utm_content=key-dates";
const nextDate = (month, day, from) => {
  const d = new Date(from.getFullYear(), month - 1, day);
  return d < from ? new Date(from.getFullYear() + 1, month - 1, day) : d;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function KeyDates({ muni, where }) {
  const t = useStrings();
  const { lang } = useLang();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const wausau = muni.code === WAUSAU_CITY_DOR;
  const county = entities.find((e) => e.kind === "county");
  const ed = (county.editions || [])[0];
  const items = [
    ...(ed ? [
      { date: new Date(ed.hearing + "T00:00:00"), what: t("kd.hearing", ed.year) },
      { date: new Date(ed.vote + "T00:00:00"), what: t("kd.vote", ed.year) },
    ] : []),
    { date: nextDate(1, 31, today), what: t("kd.first", wausau ? t("kd.toWausau") : t("kd.toLocal")) },
    ...(wausau ? [{ date: nextDate(4, 30, today), what: t("kd.second") }] : []),
    { date: nextDate(7, 31, today), what: t("kd.final", wausau ? t("kd.toWausau") : t("kd.toCounty")) },
    // no fixed date: placed in the timeline by season, shown by season, left out of the calendar file
    { date: nextDate(12, 31, today), what: t("kd.bills"), when: t("kd.december") },
    { date: nextDate(5, 31, today), what: t("kd.review"), when: t("kd.spring") },
  ].filter((i) => i.date >= today).sort((a, z) => a.date - z.date);
  const calendar = () => {
    track("Download", { view: "your-tax-bill", format: "ics" });
    const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wausau Pilot & Review//Follow the Money//EN", "CALSCALE:GREGORIAN",
      ...items.filter((i) => !i.when).flatMap((i) => {
        const day = iso(i.date).replace(/-/g, "");
        const end = iso(new Date(i.date.getFullYear(), i.date.getMonth(), i.date.getDate() + 1)).replace(/-/g, "");
        return ["BEGIN:VEVENT", `UID:${day}-${i.what.length}@follow-the-money`, `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`,
          `SUMMARY:${i.what.replace(/[,;]/g, (c) => "\\" + c)}`, `DESCRIPTION:${where} · Follow the Money`, "END:VEVENT"];
      }), "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "follow-the-money-tax-dates.ics"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section id="dates" className="block">
      <SectionHead kicker={t("kd.kick")} title={t("kd.title")}>{t("kd.dek", where)}</SectionHead>
      <ol className="kd-list">
        {items.map((i) => (
          <li key={iso(i.date) + i.what} className={i.when ? "kd-loose" : undefined}>
            {i.when ? <span className="kd-when">{i.when}</span> : <time dateTime={iso(i.date)}>{fmtDate(iso(i.date), lang)}</time>}
            <span>{i.what}</span>
          </li>
        ))}
      </ol>
      <p className="note">{t("kd.note")} <a href={TREASURER_DATES_URL} target="_blank" rel="noopener noreferrer">{t("kd.source")}</a></p>
      <div className="kd-actions">
        <button type="button" className="table-toggle kd-ics" onClick={calendar}>
          <CalendarPlus size={15} strokeWidth={2.25} aria-hidden="true" />{t("kd.ics")}
        </button>
        <span className="note">{t("kd.icsNote")}</span>
      </div>
      <div className="kd-alerts">
        <p>{t("kd.alerts")}</p>
        <a className="support-btn" href={DATES_SIGNUP_URL} target="_blank" rel="noopener noreferrer" onClick={countLink("newsletter-dates")}>
          {t("kd.signup")}
        </a>
      </div>
    </section>
  );
}

export default function TaxBillOverview({ b, extra, chrome }) {
  const t = useStrings();
  const [homeValue, setHomeValue] = useHomeValue();
  const [muniCode, setMuniCode] = useMuniChoice();
  useAnchorOnMount();

  const year = b.meta.tax_year;
  // A saved choice from an older data year that no longer exists starts over at Wausau.
  const muni = b.municipalities.find((m) => m.code === muniCode)
    || b.municipalities.find((m) => m.code === WAUSAU_CITY_DOR);
  const [school, setSchool] = useSchoolChoice(muni.code);
  const bill = useMemo(() => billRates(muni, school), [muni, school]);
  const inSuite = (id) => id && chrome.entities.some((e) => e.id === id);
  const splitRows = useMemo(() => bill.rows
    .map((r) => ({ ...r, drillId: inSuite(r.drillId) ? r.drillId : null }))
    .sort((a, c) => c.rate - a.rate), [bill.rows]);
  const total = bill.total;
  // The state's credits on this home (the lottery credit only for a primary home).
  const [primary, setPrimary] = usePrimaryHome();
  const cr = b.meta.credits;
  const credits = stateCredits(bill.school, cr, homeValue, primary);
  const net = netBill(muni, bill.school, cr, homeValue, primary);

  return (
    <div className="ftm">
      <ChromeBar {...chrome} />

      <header className="masthead">
        <div className="masthead-head">
          <div className="kicker-row">
            <span className="pub">{t("common.publicLedger")}</span>
            <span className="dot">·</span>
            <span>{t("common.yourTaxBill")}</span>
            <SponsorSlot entityId={chrome.activeId} />
          </div>
        </div>
        <h1>{t("tb.h1")}</h1>
        <p className="dek">{t("tb.dek")}</p>
      </header>

      {/* The tool first: where -> (school) -> value -> the bill, split. */}
      <section id="bill" className="block tb-steps">
        <MuniPicker municipalities={b.municipalities} value={muni.code} onChange={setMuniCode} step={1} />
        <UseLocation map={extra.map} municipalities={b.municipalities} onPick={setMuniCode} />
        <SchoolPicker options={bill.schoolOptions} value={bill.school.code} onChange={setSchool} where={bill.where} step={2} />

        <HomeValueCalc id="homeval-all" label={t("tb.homeLabel")} outLabel={t("tb.estOut")} step={bill.schoolOptions ? 3 : 2}
          outValue={usd(Math.round(net))} value={homeValue} onChange={setHomeValue} />
        <PrimaryHomeToggle value={primary} onChange={setPrimary} />

        <TaxSplit rows={splitRows} total={total} homeValue={homeValue} credits={credits}
          totalLabel={t("tb.leviedRow")} exploreLabel={t("tb.explore")}
          onDrill={(id) => chrome.onSelect(id)} />
        <p className="note">{t("tb.note", year, total.toFixed(2), bill.where, usd(cr.lottery_max_value), usd(cr.first_dollar_max_value))}</p>
        {bill.collegeAveraged && <p className="note">{t("tb.collegeAveraged", bill.where)}</p>}
        <details className="tb-more">
          <summary>{t("tb.businessQ")}</summary>
          <p>{t("tb.businessA")}</p>
        </details>
        <ShareTown muni={muni} where={bill.where} />
      </section>

      <Receipt rows={splitRows} homeValue={homeValue} credits={credits}
        where={bill.where} school={bill.school} year={year} budgets={extra} />

      <Ranking municipalities={b.municipalities} muni={muni} school={bill.school.code} homeValue={homeValue}
        credits={cr} primary={primary} map={extra.map} onChoose={setMuniCode}
        onPick={(code) => {
          setMuniCode(code);
          document.getElementById("bill").scrollIntoView({ behavior: "instant", block: "start" });
        }} />

      <Neighbors nb={extra.neighbors} municipalities={b.municipalities} muni={muni} school={bill.school.code}
        homeValue={homeValue} credits={cr} primary={primary} />

      <AssessmentCheck muni={muni} where={bill.where} homeValue={homeValue} year={year} />

      <KeyDates muni={muni} where={bill.where} />

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> <SourceLink source={chrome.source}>{t("tb.foot.source", year)}</SourceLink></p>
        <p className="muted">{t("tb.foot.builtBy")}</p>
      </footer>
    </div>
  );
}
