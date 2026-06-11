import React, { useState } from "react";
import { Receipt, Share2, Check, Home } from "lucide-react";
import { LANGS, useLang, useStrings } from "./i18n";
import { ENTITY_LOGOS } from "./ui";
import logoUrl from "./assets/logo-32.png";

// Shared WPR brand chrome bar, with the entity switcher (rendered only when
// the suite has more than one entity) and a share control. Two-tier: brand +
// share/FY on top, the switcher as its own full-width row beneath.
export default function ChromeBar({ entities, activeId, onSelect, year }) {
  const active = entities.find((e) => e.id === activeId);
  const [shared, setShared] = useState(false);
  const t = useStrings();
  const { lang, setLang } = useLang();

  // Share a canonical deep-link to the ACTIVE entity, built from activeId rather
  // than location.href so it stays valid no matter what the in-page scroll has
  // done to the hash. No personal data (e.g. the tax-bill home value) is included.
  const onShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${activeId || "home"}`;
    const title = `Follow the Money${active ? " — " + active.name : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
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
             target="_blank" rel="noopener noreferrer">
            <img className="chrome-bar__logo-img" src={logoUrl} alt="Wausau Pilot &amp; Review" />
            <span className="chrome-bar__wordmark">Wausau Pilot &amp; Review</span>
          </a>
          {activeId && (
            <button type="button" className="chrome-bar__home" onClick={() => onSelect(null)}>
              <Home size={14} strokeWidth={2.5} aria-hidden="true" />
              <span>{t("lp.home")}</span>
            </button>
          )}
        </div>
        <div className="chrome-bar__right">
          <select className="chrome-bar__lang" value={lang} aria-label={t("chrome.language")}
            onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <button type="button" className="chrome-bar__share" onClick={onShare}
            aria-label={shared ? t("chrome.copiedAria") : t("chrome.shareAria")}>
            {shared ? <Check size={14} strokeWidth={2.5} /> : <Share2 size={14} strokeWidth={2.5} />}
            <span>{shared ? t("chrome.copied") : t("chrome.share")}</span>
          </button>
          {year && <span className="chrome-bar__meta">{t("chrome.fyMeta", year)}</span>}
        </div>
        {entities.length > 1 && (
          <nav className="chrome-bar__switch" aria-label={t("chrome.chooseBudget")}>
            {entities.map((e) => (
              <button key={e.id} type="button" aria-current={e.id === activeId ? "page" : undefined}
                className={"chrome-bar__ent" + (e.id === activeId ? " on" : "")}
                onClick={() => onSelect(e.id)}>
                {e.kind === "taxbill"
                  ? <Receipt className="chrome-bar__ent-icon" size={18} strokeWidth={2} aria-hidden="true" />
                  : <img src={ENTITY_LOGOS[e.id]} alt="" />}
                <span>{e.kind === "taxbill" ? t("common.yourTaxBill") : e.short}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
      {lang === "hmn" && (
        <div className="beta-banner" role="note">
          <b>{t("beta.title")}</b> <span>{t("beta.body")}</span>
        </div>
      )}
    </>
  );
}
