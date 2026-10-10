import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStrings } from "../i18n";
import { usd } from "../format";
import { track } from "../analytics";
import { billDollars, billParts, muniBills, muniSlug, netBill, stateCredits } from "../taxmath";
import { countyShares, cityShares, schoolShares, itemize } from "../receipt";
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
                <tr className="rc-gov"><th scope="row">{r.label}</th><td>{usd(amount)}</td></tr>
                {detail
                  ? itemize(detail(budgets), amount).map((it) => (
                    <tr className="rc-item" key={it.key || it.label}>
                      <th scope="row">{it.key ? t(it.key) : it.label}</th><td>{usd(it.amount)}</td>
                    </tr>))
                  : r.key !== "college" && <tr className="rc-note"><td colSpan={2}>
                    {t("rc.noDetail", r.key === "school" ? `${school.name} School District` : r.label)}
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
  const { width: W, height: H } = map.meta;
  const pos = ([x, y]) => ({ left: (x / W) * 100 + "%", top: (y / H) * 100 + "%" });
  const name = (m) => `${m.type} of ${m.name}`;
  const sel = map.shapes.find((s) => s.code === mine.m.code);
  // "Wausau", for bearings — unless the pick is Wausau or its label would cover it
  const anchor = map.shapes.find((s) => s.code === WAUSAU_CITY_DOR);
  const nearAnchor = Math.abs(sel.label[0] - anchor.label[0]) < W * 0.15 && Math.abs(sel.label[1] - anchor.label[1]) < H * 0.2;
  const hover = tip && map.shapes.find((s) => s.code === tip.r.m.code);
  const loRow = rows.find((r) => r.bill === lo), hiRow = rows.find((r) => r.bill === hi);
  // what differs: the municipality's own levy (the county's share is the same
  // everywhere, the school share similar) — medians by type, on this home
  const local = (type) => dollars(median(rows.filter((r) => r.m.type === type)
    .map((r) => (homeValue / 1000) * billParts(r.m, r.m.school_districts[0]).municipality)));
  const [sx, sy] = sel.label;
  const below = sy < H * 0.28;
  // the pick's label: centered over its pin, but kept inside the map
  const label = useRef(null);
  useLayoutEffect(() => {
    const place = () => {
      const w = wrap.current.clientWidth, lw = label.current.offsetWidth;
      label.current.style.left = Math.max(0, Math.min(w - lw, (sx / W) * w - lw / 2)) + "px";
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
  return (
    <figure className="cmap">
      <div className="cmap-wrap" ref={wrap} onMouseLeave={() => setTip(null)}>
        <CountyShapes map={map} fill={(code) => shade(byCode.get(code).bill)}
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
        {!nearAnchor && <span className="cmap-anchor" style={pos(anchor.label)} aria-hidden="true">Wausau</span>}
        <span className="cmap-pin" style={pos(sel.label)} aria-hidden="true" />
        <span ref={label} className={"cmap-label" + (below ? " below" : "")} style={{ top: pos(sel.label).top }} aria-hidden="true">
          <em>{t("tb.cmp.yours")}</em>{name(mine.m)} <b>{dollars(mine.bill)}</b>
        </span>
        <div className="cmap-scale" style={{ width: `${((10 * map.meta.units_per_mile) / W) * 100}%` }} aria-hidden="true">
          <i />{t("tb.map.miles", 10)}
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
