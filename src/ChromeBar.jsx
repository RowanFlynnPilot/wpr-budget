import React, { useState } from "react";
import { Receipt, Share2, Check, Home, Globe } from "lucide-react";
import { LANGS, useLang, useStrings } from "./i18n";
import { ENTITY_LOGOS, CORRECTIONS_URL, DEMO, SPONSOR_MAILTO } from "./ui";
import logoUrl from "./assets/logo-32.png";
import wordmark from "./wordmark.json";
import { track, currentView } from "./analytics";
import { prefetchProps } from "./views";

// Shared WPR brand chrome bar, with the entity switcher (rendered only when
// the suite has more than one entity) and a share control. Two-tier: brand +
// share/FY on top, the switcher as its own full-width row beneath. On phones
// the controls go compact (icons, "EN") to share the brand's row.
export default function ChromeBar({ entities, activeId, routeId, onSelect, year, status = "adopted" }) {
  const active = entities.find((e) => e.id === activeId);
  const [shared, setShared] = useState(false);
  const t = useStrings();
  const { lang, setLang } = useLang();
  const current = LANGS.find((l) => l.code === lang);

  // Share a canonical deep-link to the ACTIVE view (entity + edition), built from
  // routeId rather than location.href so it stays valid no matter what the
  // in-page scroll has done to the hash. No personal data (e.g. the tax-bill home
  // value) is included.
  const onShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${routeId || "home"}`;
    const title = `Follow the Money${active ? " — " + active.name : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        track("Share", { view: currentView(), method: "native" });
      } else {
        await navigator.clipboard.writeText(url);
        track("Share", { view: currentView(), method: "copy" });
        setShared(true);
        setTimeout(() => setShared(false), 1800);
      }
    } catch (e) { /* user dismissed the share sheet, or clipboard was blocked */ }
  };

  return (
    <>
      <div className="chrome-bar">
        <div className="chrome-bar__left">
          <a className="chrome-bar__brand" href="https://wausaupilotandreview.com"
             target="_blank" rel="noopener noreferrer" aria-label="Wausau Pilot & Review">
            <img className="chrome-bar__logo-img" src={logoUrl} alt="Wausau Pilot &amp; Review" />
            {/* the wordmark as artwork (scripts/fonts.py); the link's label names it (phones drop the logo) */}
            <svg className="chrome-bar__wordmark" viewBox={wordmark.viewBox} style={{ height: wordmark.height_em + "em" }}
              aria-hidden="true" focusable="false"><path d={wordmark.d} /></svg>
          </a>
          {routeId && (
            <button type="button" className="chrome-bar__home" onClick={() => onSelect(null)}>
              <Home size={14} strokeWidth={2.5} aria-hidden="true" />
              <span className="chrome-bar__txt">{t("lp.home")}</span>
            </button>
          )}
        </div>
        <div className="chrome-bar__right">
          {/* The pill shows the language (its code on phones); the real <select>
              lies transparent over it, so tapping opens the native picker. */}
          <span className="chrome-bar__lang">
            <Globe size={14} strokeWidth={2.25} aria-hidden="true" />
            <span className="chrome-bar__lang-long" aria-hidden="true">{current.label}</span>
            <span className="chrome-bar__lang-short" aria-hidden="true">{current.short}</span>
            <select value={lang} aria-label={t("chrome.language")}
              onChange={(e) => { setLang(e.target.value); track("Language", { lang: e.target.value }); }}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </span>
          <button type="button" className="chrome-bar__share" onClick={onShare}
            aria-label={shared ? t("chrome.copiedAria") : t("chrome.shareAria")}>
            {shared ? <Check size={14} strokeWidth={2.5} /> : <Share2 size={14} strokeWidth={2.5} />}
            <span className="chrome-bar__txt">{shared ? t("chrome.copied") : t("chrome.share")}</span>
          </button>
          {year && <span className="chrome-bar__meta">{t("chrome.fyMeta", year, status)}</span>}
        </div>
        {entities.length > 1 && (
          <nav className="chrome-bar__switch" aria-label={t("chrome.chooseBudget")}>
            {entities.map((e) => (
              <button key={e.id} type="button" aria-current={e.id === activeId ? "page" : undefined}
                className={"chrome-bar__ent" + (e.id === activeId ? " on" : "")}
                onClick={() => onSelect(e.id)} {...prefetchProps(e)}>
                {e.kind === "taxbill"
                  ? <Receipt className="chrome-bar__ent-icon" size={18} strokeWidth={2} aria-hidden="true" />
                  : <img src={ENTITY_LOGOS[e.id]} alt="" />}
                <span>{e.kind === "taxbill" ? t("common.yourTaxBill") : e.short}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
      {DEMO && (
        <div className="demo-ribbon" role="note">
          {t("demo.ribbon")} <a href={SPONSOR_MAILTO}>{t("demo.ask")}</a>
        </div>
      )}
      {lang === "hmn" && (
        <div className="beta-banner" role="note">
          <b>{t("beta.title")}</b> <span>{t("beta.body")}</span>{" "}
          <a href={CORRECTIONS_URL} target="_blank" rel="noopener noreferrer">{t("method.correctionsLink")}</a>
        </div>
      )}
    </>
  );
}
