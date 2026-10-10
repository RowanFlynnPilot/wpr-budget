import React, { useMemo, useState } from "react";
import { useStrings } from "../i18n";
import { usd } from "../format";
import { track } from "../analytics";
import { billDollars, muniSlug, netBill, stateCredits } from "../taxmath";
import { countyShares, cityShares, schoolShares, itemize } from "../receipt";
import {
  SponsorSlot, SourceLink, SectionHead, HomeValueCalc, TaxSplit, MuniPicker, SchoolPicker, billRates, billExtremes, placeLabel,
  PrimaryHomeToggle, useAnchorOnMount, useHomeValue, useMuniChoice, useSchoolChoice, usePrimaryHome, WAUSAU_CITY_DOR,
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

// "Same home, different bill": every municipality's bill on the reader's own
// home value, ranked dearest first. A municipality spanning several school
// districts is ranked by its largest district (the thin line under its bar is
// the range across them) — except the reader's own, which shows the district
// they chose. Collapsed: the five dearest, the five cheapest, and the reader's.
// A row is a button: it opens that municipality's bill above.
const RANK_EDGE = 5;
function Ranking({ municipalities, muni, school, homeValue, credits, primary, onPick }) {
  const t = useStrings();
  const [all, setAll] = useState(false);
  // Bills after the state's credits, in dollars, on the reader's own value and
  // primary-home choice (credits are capped, so the order can shift with value).
  const rows = useMemo(() => municipalities.map((m) => {
    const bills = m.school_districts.map((sd) => netBill(m, sd, credits, homeValue, primary));
    const mineSd = m.school_districts.find((sd) => sd.code === school) || m.school_districts[0];
    const bill = m.code === muni.code ? netBill(m, mineSd, credits, homeValue, primary) : bills[0];
    return { m, bill, min: Math.min(...bills), max: Math.max(...bills) };
  }).sort((a, c) => c.bill - a.bill), [municipalities, muni.code, school, credits, homeValue, primary]);
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
        credits={cr} primary={primary}
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
