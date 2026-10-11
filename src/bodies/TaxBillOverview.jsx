import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, ZoomIn, ZoomOut } from "lucide-react";
import { useStrings } from "../i18n";
import { usd } from "../format";
import { track } from "../analytics";
import { billDollars, billParts, muniBills, muniSlug, netBill, stateCredits } from "../taxmath";
import { countyShares, cityShares, schoolShares, itemize } from "../receipt";
import { locate, ringsOf, WAUSAU_AREA } from "../mapgeo";
import {
  SponsorSlot, SourceLink, SectionHead, HomeValueCalc, TaxSplit, MuniPicker, SchoolPicker, billRates, billExtremes, placeLabel,
  PrimaryHomeToggle, useAnchorOnMount, useHomeValue, useMuniChoice, useSchoolChoice, usePrimaryHome, WAUSAU_CITY_DOR,
  CountyShapes, RAMP, rampColor,
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

      <footer className="foot">
        <p><b>{t("foot.sourceLabel")}</b> <SourceLink source={chrome.source}>{t("tb.foot.source", year)}</SourceLink></p>
        <p className="muted">{t("tb.foot.builtBy")}</p>
      </footer>
    </div>
  );
}
