import React, { createContext, useContext, useState, useEffect } from "react";

// Lightweight i18n for the "Follow the Money" suite. Semantic dotted keys; each
// language provides overrides and falls back to English so nothing ever renders
// blank. Spanish is a full translation; Hmong (Hmoob, White Hmong / RPA) is an
// AI-drafted community translation shipped in BETA — a banner invites corrections,
// and official department/fund/category names stay as published (not translated).
export const LANGS = [
  { code: "en", label: "English", short: "EN" },
  { code: "es", label: "Español", short: "ES" },
  { code: "hmn", label: "Hmoob", short: "HMN" },
];

const STORAGE_KEY = "wpr-budget-lang";

// ---- string tables -------------------------------------------------------
// Keys are grouped by area. Values are strings, or functions for interpolation.
const EN = {
  "chrome.share": "Share",
  "chrome.copied": "Copied",
  "chrome.shareAria": "Share this page",
  "chrome.copiedAria": "Link copied",
  "chrome.chooseBudget": "Choose budget",
  "chrome.language": "Language",
  "chrome.fyMeta": (year) => `FY${year} Adopted Budget`,
  "common.publicLedger": "The Public Ledger",
  "common.yourTaxBill": "Your Tax Bill",
  "beta.title": "Hmong is a community translation, in beta.",
  "beta.body": "Some wording may be rough — tell Wausau Pilot & Review what to fix.",

  // nav / section labels (union across bodies)
  "nav.where": "Where It Goes",
  "nav.flow": "Money Flow",
  "nav.allfunds": "All Funds",
  "nav.overtime": "Over Time",
  "nav.taxbill": "Your Tax Bill",
  "nav.debt": "Debt",
  "nav.methodology": "Methodology",
  "nav.departments": "Departments",
  "nav.trends": "Over Time",
  "nav.workforce": "Workforce",
  "nav.development": "Development",
  "nav.students": "Students",
  "nav.bill": "Your Tax Bill",
  "nav.funds": "Funds",

  // what-changed band
  "wc.head": "What changed this year",
  "wc.countyLevy": "County tax levy",
  "wc.cityLevy": "City tax levy",
  "wc.schoolLevy": "School tax levy",
  "wc.millRate": "Mill rate",
  "wc.totalBudget": "Total budget",
  "wc.totalBudgetAllFunds": "Total budget · all funds",
  "wc.biggestLevyIncrease": "Biggest levy increase",
  "wc.fastestGrowing": "Fastest-growing category",
  "wc.enrollment": "Enrollment",
  "wc.enrollNote": (chg, since) =>
    (chg < 0 ? "down " : chg > 0 ? "up " : "flat, ") +
    (chg ? Math.abs(chg).toLocaleString() + " since " + since : "five years"),

  // shared methodology
  "method.kicker": "How We Built This",
  "method.title": "Methodology & open data",
  "method.intro": (entity, year, kindNoun) =>
    `Every figure on this page is pulled straight from ${entity}'s official adopted ${year} budget — the same document the ${kindNoun} publishes — and checked against the budget's own printed totals. Nothing here is hand-typed or estimated.`,
  "method.kind.county": "county",
  "method.kind.city": "city",
  "method.kind.school": "district",
  "method.step.source": (year, entity) => `The official Adopted ${year} Annual Budget (PDF), published by ${entity}.`,
  "method.step.sourceLabel": "Source.",
  "method.step.extraction": "An open-source script reads the budget's tables directly from the PDF — no manual transcription.",
  "method.step.extractionLabel": "Extraction.",
  "method.step.verification": "Each table is reconciled line-by-line against the budget's printed totals. If a number doesn't add up, the process stops rather than publish a wrong figure.",
  "method.step.verificationLabel": "Verification.",
  "method.step.updates": "Refreshed once a year, when a new budget is adopted.",
  "method.step.updatesLabel": "Updates.",
  "method.dlJson": "Download the full data (JSON)",
  "method.dlCsv": "Download spending (CSV)",
  "method.reuse": "This data is free to reuse. Built and maintained by Wausau Pilot & Review as part of its civic transparency work.",
  "suite.linkLead": "See the decisions behind the budget.",
  "suite.linkBody": "This budget was debated and adopted in public meetings — follow them in WPR's Central Wisconsin Meeting Tracker.",

  // shared calculator
  "calc.estProperty": "Estimated annual property tax",

  // shared footer
  "foot.amended": "Figures are as adopted and may be amended during the year.",
  "foot.sourceLabel": "Source:",
};

const ES = {
  "chrome.share": "Compartir",
  "chrome.copied": "Copiado",
  "chrome.shareAria": "Compartir esta página",
  "chrome.copiedAria": "Enlace copiado",
  "chrome.chooseBudget": "Elegir presupuesto",
  "chrome.language": "Idioma",
  "chrome.fyMeta": (year) => `Presupuesto ${year} adoptado`,
  "common.publicLedger": "El Libro Público",
  "common.yourTaxBill": "Su factura de impuestos",
  "beta.title": "El hmong es una traducción comunitaria, en versión beta.",
  "beta.body": "Algunas frases pueden ser imperfectas — dígale a Wausau Pilot & Review qué corregir.",

  "nav.where": "A dónde va",
  "nav.flow": "Flujo del dinero",
  "nav.allfunds": "Todos los fondos",
  "nav.overtime": "Con el tiempo",
  "nav.taxbill": "Su factura",
  "nav.debt": "Deuda",
  "nav.methodology": "Metodología",
  "nav.departments": "Departamentos",
  "nav.trends": "Con el tiempo",
  "nav.workforce": "Personal",
  "nav.development": "Desarrollo",
  "nav.students": "Estudiantes",
  "nav.bill": "Su factura",
  "nav.funds": "Fondos",

  "wc.head": "Qué cambió este año",
  "wc.countyLevy": "Impuesto del condado",
  "wc.cityLevy": "Impuesto de la ciudad",
  "wc.schoolLevy": "Impuesto escolar",
  "wc.millRate": "Tasa por milaje",
  "wc.totalBudget": "Presupuesto total",
  "wc.totalBudgetAllFunds": "Presupuesto total · todos los fondos",
  "wc.biggestLevyIncrease": "Mayor aumento de impuesto",
  "wc.fastestGrowing": "Categoría de mayor crecimiento",
  "wc.enrollment": "Matrícula",
  "wc.enrollNote": (chg, since) =>
    (chg < 0 ? "baja de " : chg > 0 ? "sube de " : "estable, ") +
    (chg ? Math.abs(chg).toLocaleString() + " desde " + since : "cinco años"),

  "method.kicker": "Cómo lo hicimos",
  "method.title": "Metodología y datos abiertos",
  "method.intro": (entity, year, kindNoun) =>
    `Cada cifra en esta página proviene directamente del presupuesto oficial adoptado de ${year} de ${entity} — el mismo documento que publica ${kindNoun} — y se coteja con los totales impresos del propio presupuesto. Nada aquí se escribe a mano ni se estima.`,
  "method.kind.county": "el condado",
  "method.kind.city": "la ciudad",
  "method.kind.school": "el distrito",
  "method.step.source": (year, entity) => `El Presupuesto Anual oficial adoptado de ${year} (PDF), publicado por ${entity}.`,
  "method.step.sourceLabel": "Fuente.",
  "method.step.extraction": "Un script de código abierto lee las tablas del presupuesto directamente del PDF — sin transcripción manual.",
  "method.step.extractionLabel": "Extracción.",
  "method.step.verification": "Cada tabla se concilia línea por línea con los totales impresos del presupuesto. Si una cifra no cuadra, el proceso se detiene en lugar de publicar un dato erróneo.",
  "method.step.verificationLabel": "Verificación.",
  "method.step.updates": "Se actualiza una vez al año, cuando se adopta un nuevo presupuesto.",
  "method.step.updatesLabel": "Actualizaciones.",
  "method.dlJson": "Descargar todos los datos (JSON)",
  "method.dlCsv": "Descargar gastos (CSV)",
  "method.reuse": "Estos datos son de libre reutilización. Creado y mantenido por Wausau Pilot & Review como parte de su trabajo de transparencia cívica.",
  "suite.linkLead": "Vea las decisiones detrás del presupuesto.",
  "suite.linkBody": "Este presupuesto se debatió y adoptó en reuniones públicas — sígalas en el Rastreador de Reuniones del Centro de Wisconsin de WPR.",

  "calc.estProperty": "Impuesto anual estimado a la propiedad",

  "foot.amended": "Las cifras son las adoptadas y pueden modificarse durante el año.",
  "foot.sourceLabel": "Fuente:",
};

// Hmong (Hmoob Dawb / RPA). BETA — AI-drafted, pending community review.
const HMN = {
  "chrome.share": "Faib",
  "chrome.copied": "Theej tau lawm",
  "chrome.shareAria": "Faib nplooj no",
  "chrome.copiedAria": "Theej qhov txuas lawm",
  "chrome.chooseBudget": "Xaiv daim nyiaj txiag",
  "chrome.language": "Hom Lus",
  "chrome.fyMeta": (year) => `Daim Nyiaj Txiag Xyoo ${year} Pom Zoo`,
  "common.publicLedger": "Phau Ntawv Pej Xeem",
  "common.yourTaxBill": "Koj Daim Nqi Se",
  "beta.title": "Lus Hmoob yog ib qho lus txhais los ntawm zej zog (beta).",
  "beta.body": "Tej zaum cov lus tseem tsis tau zoo — qhia rau Wausau Pilot & Review paub yam yuav tsum kho.",

  "nav.where": "Mus Qhov Twg",
  "nav.flow": "Nyiaj Ntws Mus",
  "nav.allfunds": "Txhua Lub Nyiaj",
  "nav.overtime": "Raws Sij Hawm",
  "nav.taxbill": "Koj Daim Nqi",
  "nav.debt": "Nuj Nqis",
  "nav.methodology": "Txoj Kev Ua",
  "nav.departments": "Tej Chaw Haujlwm",
  "nav.trends": "Raws Sij Hawm",
  "nav.workforce": "Cov Neeg Ua Haujlwm",
  "nav.development": "Kev Loj Hlob",
  "nav.students": "Cov Tub Ntxhais Kawm",
  "nav.bill": "Koj Daim Nqi",
  "nav.funds": "Cov Nyiaj",

  "wc.head": "Xyoo No Hloov Dab Tsi",
  "wc.countyLevy": "Se hauv lub nroog (county)",
  "wc.cityLevy": "Se hauv lub zos (city)",
  "wc.schoolLevy": "Se tsev kawm ntawv",
  "wc.millRate": "Tus nqi se (mill rate)",
  "wc.totalBudget": "Tag nrho daim nyiaj txiag",
  "wc.totalBudgetAllFunds": "Tag nrho · txhua lub nyiaj",
  "wc.biggestLevyIncrease": "Se nce ntau tshaj plaws",
  "wc.fastestGrowing": "Pawg loj hlob ceev tshaj",
  "wc.enrollment": "Cov tub ntxhais kawm",
  "wc.enrollNote": (chg, since) =>
    (chg < 0 ? "poob " : chg > 0 ? "nce " : "tsis hloov, ") +
    (chg ? Math.abs(chg).toLocaleString() + " txij " + since : "tsib xyoos"),

  "method.kicker": "Peb Ua Li Cas",
  "method.title": "Txoj Kev Ua & Cov Ntaub Ntawv Qhib",
  "method.intro": (entity, year, kindNoun) =>
    `Txhua tus lej ntawm nplooj no muab ncaj qha los ntawm ${entity} daim nyiaj txiag pom zoo rau xyoo ${year} — tib daim ntawv uas ${kindNoun} tshaj tawm — thiab kuaj nrog cov lej tag nrho luam tawm hauv daim nyiaj txiag. Tsis muaj dab tsi sau tes lossis kwv yees.`,
  "method.kind.county": "lub nroog",
  "method.kind.city": "lub zos",
  "method.kind.school": "lub tsev kawm ntawv",
  "method.step.source": (year, entity) => `Daim Nyiaj Txiag Txhua Xyoo ${year} (PDF) uas pom zoo lawm, tshaj tawm los ntawm ${entity}.`,
  "method.step.sourceLabel": "Qhov chaw.",
  "method.step.extraction": "Ib qho open-source script nyeem cov rooj nyiaj ncaj qha hauv daim PDF — tsis txhais tes.",
  "method.step.extractionLabel": "Rho tawm.",
  "method.step.verification": "Txhua lub rooj raug kuaj ib kab zuj zus nrog cov lej luam tawm. Yog ib tug lej tsis sib npaug, txoj kev nres es tsis tshaj tawm tus lej yuam kev.",
  "method.step.verificationLabel": "Kuaj xyuas.",
  "method.step.updates": "Hloov kho ib xyoos ib zaug, thaum muaj daim nyiaj txiag tshiab pom zoo.",
  "method.step.updatesLabel": "Hloov tshiab.",
  "method.dlJson": "Rub tag nrho cov ntaub ntawv (JSON)",
  "method.dlCsv": "Rub cov nuj nqis (CSV)",
  "method.reuse": "Cov ntaub ntawv no pub dawb siv dua. Tsim thiab saib xyuas los ntawm Wausau Pilot & Review ua ib feem ntawm nws txoj haujlwm pej xeem nthuav qhia.",
  "suite.linkLead": "Saib cov kev txiav txim tom qab daim nyiaj txiag.",
  "suite.linkBody": "Daim nyiaj txiag no raug sib tham thiab pom zoo hauv cov rooj sib tham pej xeem — taug qab lawv hauv WPR Central Wisconsin Meeting Tracker.",

  "calc.estProperty": "Kwv yees se vaj tse txhua xyoo",

  "foot.amended": "Cov lej yog raws li pom zoo thiab tej zaum yuav hloov thaum nruab xyoo.",
  "foot.sourceLabel": "Qhov chaw:",
};

const TABLES = { en: EN, es: ES, hmn: HMN };

// ---- context / hook ------------------------------------------------------
const LangContext = createContext({ lang: "en", setLang: () => {} });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && TABLES[saved]) return saved;
    } catch (e) { /* localStorage unavailable */ }
    return "en";
  });
  const setLang = (l) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch (e) { /* ignore */ }
  };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

// Returns t(key, ...args): looks up the current language, falls back to English,
// and calls the entry if it's a function (interpolation).
export function useStrings() {
  const { lang } = useContext(LangContext);
  return (key, ...args) => {
    const entry = (TABLES[lang] && TABLES[lang][key] !== undefined) ? TABLES[lang][key] : EN[key];
    if (entry === undefined) return key; // surfaces a missing key loudly in the UI
    return typeof entry === "function" ? entry(...args) : entry;
  };
}
