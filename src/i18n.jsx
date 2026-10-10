import React, { createContext, useContext, useState, useEffect, useMemo } from "react";

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
  "lp.rangeCaption": (lo, hi, n) => `The same home anywhere in Marathon County: from the ${lo} to the ${hi}, across all ${n} cities, villages and towns.`,
  "lp.seasonHead": "Budget season",
  "chg.title": "Changes since the proposal",
  "chg.story": "Read the story",
  "ed.companion.city": (year) => `The Mayor's proposed ${year} budget is out: explore it department by department in WPR's ${year} City budget tool.`,
  "lp.companion.city": (year) => `The City of Wausau's proposed ${year} budget is out: the Mayor's plan, department by department.`,
  "lp.companionCta": "Open the City tool",
  "demo.yourBrand": "Your business here",
  "demo.ribbon": "Sponsor preview: this is how a “Presented by” credit appears on every page. Readers never see this banner.",
  "demo.ask": "Ask about sponsoring",
  "tb.businessQ": "Own a business property?",
  "tb.businessA": "Wisconsin's constitution requires commercial property to be taxed at the same rate as homes, so enter its fair market value and the same math applies. Business equipment and other personal property have not been taxed since 2024. Of the two credits not subtracted here, a business gets only the first-dollar credit; the lottery credit is for an owner's primary home.",
  "nav.say": "Have your say",
  "ed.sayLink": "How to weigh in",
  "say.kick": "Before the vote",
  "say.title": "Have your say",
  "say.dek": (year, vote) => `The ${year} budget isn't final until the County Board votes on ${vote}. Until then, supervisors can still change it, and residents can weigh in.`,
  "say.m.education": "County Board education meeting on the budget",
  "say.m.qa": "County Board questions and answers on the budget",
  "say.m.hearing": "Public hearing: residents can ask questions and raise concerns",
  "say.m.amendments": "Deadline for supervisors' amendments based on the hearing",
  "say.m.committee": "The Human Resources, Finance & Property Committee reviews the amendments",
  "say.m.vote": "The County Board votes on the budget",
  "say.speak.lead": "Speak at the public hearing.",
  "say.speak": (date) => `It is on ${date}; the time and place are on the County Board's agenda:`,
  "say.agendaLink": "County Board agendas",
  "say.contact.lead": "Tell your supervisor.",
  "say.contact": (date) => `Each of the 38 County Board supervisors can propose amendments until ${date}.`,
  "say.findLink": "Find your supervisor",
  "say.membersLink": "supervisors' contact information",
  "say.follow.lead": "Hear how it ends.",
  "say.follow": "Get the vote and the final numbers from Wausau Pilot & Review by email, or follow the meetings yourself:",
  "say.trackerLink": "Meeting Tracker",
  "card.title": "What does your home pay?",
  "card.where": "Where",
  "card.school": "School district",
  "card.value": "Fair market value",
  "card.perYear": "a year in local property taxes, before the lottery and first-dollar credits",
  "card.part.county": "County",
  "card.part.City": "City",
  "card.part.Village": "Village",
  "card.part.Town": "Town",
  "card.part.school": "Schools",
  "card.part.college": "Technical college",
  "card.cta": (n) => `See where every dollar goes, and compare all ${n} municipalities`,
  "card.source": (year) => `Wausau Pilot & Review, from Wisconsin Department of Revenue ${year} tax data`,
  "tb.shareTown": (where) => `Share the ${where}'s bill`,
  "tb.shareCopied": "Link copied",
  "tb.cmp.kick": "Across the county",
  "tb.cmp.title": "Same home, different bill",
  "tb.cmp.dek": (value, n) => `What a ${value} home pays in local property tax in each of Marathon County's ${n} cities, villages and towns, before the lottery and first-dollar credits.`,
  "tb.cmp.range": (lo, loPlace, hi, hiPlace, diff) => `From ${lo} in the ${loPlace} to ${hi} in the ${hiPlace}: ${diff} a year apart, for the same home.`,
  "tb.cmp.placeSchool": (where, sd) => `${where}, ${sd} schools`,
  "tb.cmp.yours": "your pick",
  "tb.cmp.showAll": (n) => `Show all ${n}`,
  "tb.cmp.showFewer": "Show fewer",
  "tb.cmp.note": "Where a municipality spans more than one school district, its bar shows the largest district and the thin line beneath it the range across its districts; yours shows the district you chose. Pick any row to see its whole bill.",
  "lp.compareCta": (n) => `Compare all ${n}`,
  "wc.levyChange": "Change in the tax levy",
  "wc.riseRecord": (from) => `the largest rise in records back to ${from}`,
  "wc.riseSince": (year) => `the largest rise since ${year}`,
  "wc.lowRecord": (from) => `the lowest in records back to ${from}`,
  "wc.lowSince": (year) => `the lowest since ${year}`,
  "wc.typicalBill": "County tax on a typical home",
  "wc.typicalOn": (v) => `on a ${v} home`,
  "wc.biggestGfIncrease": "Biggest general-fund increase",
  "wc.perStudent": "General fund per student",
  "about.kicker": "About this project",
  "about.dek": "A free public ledger of the money behind local government in Marathon County. Wausau Pilot & Review built it so anyone can see where their property taxes go \u2014 and see it before the votes that decide them.",
  "about.stat.tax": (year) => `in property taxes on Marathon County's ${year} tax bills`,
  "about.stat.munis": "cities, villages and towns, each with its complete tax bill",
  "about.stat.budgets": "in three local budgets, explained line by line",
  "about.stat.langs": "languages: English, Spanish and Hmong",
  "about.for.title": "What it's for",
  "about.for.bill.lead": "See your whole bill.",
  "about.for.bill": "Pick any city, village or town in Marathon County and a home's value to see what the county, the municipality, the school district and the technical college each collect.",
  "about.for.season.lead": "Follow decisions while they're open.",
  "about.for.season": "When a government proposes next year's budget, it appears here before the public hearing and the vote, labeled as a proposal.",
  "about.for.season.now": (entity, year, date) => `${entity}'s ${year} proposal is up now; the public hearing is ${date}.`,
  "about.for.check.lead": "Check it yourself.",
  "about.for.check": "Every page links to the official document its numbers come from, and the data downloads free as JSON or a spreadsheet.",
  "about.check.title": "How we check every number",
  "about.check.1": "Every table is read from the government's own budget book or the state's certified tax data, and every row is checked against the totals printed there. If anything fails to add up, the update stops instead of publishing.",
  "about.check.2": "Before any update goes live, automated checks run on everything the site shows: for every county department, spending must equal its tax levy plus its own revenue; a tax bill must compute for every municipality and school district; and every page must exist in all three languages.",
  "about.check.3": "The tax-bill math reproduces the Wisconsin Department of Revenue's own published tax rate, to within a cent per $1,000, for every municipality with a single school district.",
  "about.privacy.title": "Your privacy",
  "about.privacy.local": "The home value you enter and the municipality you pick are remembered only in your own browser, so the calculators remember them next time. No accounts and no cookies.",
  "about.privacy.counted": "We count visits and a few anonymous actions \u2014 which municipality's bill readers look up, language changes, shares and downloads \u2014 with Plausible, a privacy-first analytics service, so we know what readers use. A home's value is never recorded.",
  "about.reuse.title": "Use it and share it",
  "about.reuse.body": "The data is free to reuse; please credit Wausau Pilot & Review. To put the tool on your own website, or to ask about the data,",
  "about.reuse.link": "contact us.",
  "about.sponsor.title": "Sponsor Follow the Money",
  "about.sponsor.body": "Local businesses and organizations can sponsor the tool, credited as \u201cPresented by\u201d on its pages. Wausau Pilot & Review is editorially independent: sponsors have no say in the numbers or the reporting.",
  "about.sponsor.ask": "Ask about sponsorship:",
  "about.credits": "Built and maintained by Wausau Pilot & Review, a nonprofit newsroom in Wausau. Sources: Marathon County, the City of Wausau, the Wausau School District, the Wisconsin Department of Revenue and the Wisconsin Department of Public Instruction.",
  "about.link": "About this project",
  "support.title": "Built by Wausau Pilot & Review",
  "support.body": "Wausau Pilot & Review is a nonprofit newsroom. Reader support keeps tools like this free for everyone, and updated as each budget is proposed, amended and adopted.",
  "support.donate": "Support our journalism",
  "support.newsletter": "Get local news by email",
  "support.sponsor": "Sponsor this tool",
  "app.renderError": "Something went wrong showing this page. Try another view, or reload.",
  "gloss.title": "What these words mean",
  "gloss.levy": "Tax levy",
  "gloss.levy.def": "The total amount a government raises from property taxes in a year. It is split among property owners in proportion to their property's value.",
  "gloss.millRate": "Mill rate",
  "gloss.millRate.def": "The tax per $1,000 of property value — the levy divided by the total value of taxable property. A $3.49 rate means $349 a year on a $100,000 home.",
  "gloss.fmv": "Fair market value",
  "gloss.fmv.def": "What the state estimates your property would sell for (\u201cEst. Fair Mkt.\u201d on your tax bill). Rates in this tool are per $1,000 of it; local \u201cassessed\u201d values differ from place to place.",
  "gloss.generalFund": "General fund",
  "gloss.generalFund.def": "A government's main operating account, for day-to-day services such as police, roads and administration. Other funds are set aside for specific purposes, like debt payments or a landfill.",
  "gloss.levyLimit": "Levy limit",
  "gloss.levyLimit.def": "Wisconsin caps how much a city or county can raise its levy each year, mostly to the value of new construction. Debt payments and voter-approved referendums can go above it.",
  "gloss.tif": "TIF (tax increment financing)",
  "gloss.tif.def": "A development tool: the property-tax growth inside a district pays for that district's improvements until it closes, instead of going to the general budget.",
  "gloss.credit": "School levy credit",
  "gloss.credit.def": "State money that lowers every property-tax bill. The tax bills in this tool are shown after it (\u201cnet\u201d); the separate lottery and first-dollar credits are not subtracted.",
  "chart.showTable": "Show as table",
  "chart.hideTable": "Hide table",
  "col.year": "Year",
  "col.schoolYear": "School year",
  "col.total": "Total",
  "col.fte": (dept) => `${dept} (FTE)`,
  "app.loading": "Loading the ledger…",
  "app.error": "Could not load the budget data",
  "aria.gfView": "General fund view",
  "aria.deptCompareView": "Department comparison view",
  "aria.chooseDept": "Choose a department",
  "aria.salaryDetail": "Salary and benefit detail",
  "aria.amountBasis": "Show amounts as",
  "aria.sortedAsc": "sorted ascending",
  "aria.sortedDesc": "sorted descending",
  "aria.flowCity": (total, dept) => `Money-flow diagram: General Fund revenue sources flowing into the ${total} general fund and out to departments. Largest department: ${dept}.`,
  "aria.flowSchool": (total, source) => `Money-flow diagram: General Fund revenue sources flowing into the ${total} general fund and out to spending. Largest source: ${source}.`,
  "tip.millRate": "Mill rate",
  "tip.avgBill": "Avg. bill",
  "tip.levy": "Levy",
  "c.dev.district": (n) => `District ${n}`,
  "chrome.share": "Share",
  "chrome.copied": "Copied",
  "chrome.shareAria": "Share this page",
  "chrome.copiedAria": "Link copied",
  "chrome.chooseBudget": "Choose budget",
  "chrome.language": "Language",
  "chrome.fyMeta": (year, status) => `FY${year} ${status === "proposed" ? "Proposed" : "Adopted"} Budget`,
  "common.publicLedger": "The Public Ledger",
  "common.yourTaxBill": "Your Tax Bill",
  "sponsor.presentedBy": "Presented by",
  "beta.title": "The Hmong translation is machine-drafted and in beta, awaiting review by Hmong speakers.",
  "beta.body": "Some wording may be wrong — tell Wausau Pilot & Review what to fix:",

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
  "wc.headProposed": (year) => `What's proposed for ${year}`,
  "wc.schoolLevy": "School tax levy",
  "wc.millRate": "Mill rate",
  "wc.totalBudget": "Total budget",
  "wc.totalBudgetAllFunds": "Total budget · all funds",
  "wc.biggestLevyIncrease": "Biggest levy increase",
  "wc.enrollment": "Enrollment",
  "wc.enrollNote": (chg, since) =>
    (chg < 0 ? "down " : chg > 0 ? "up " : "flat, ") +
    (chg ? Math.abs(chg).toLocaleString() + " since " + since : "five years"),

  // shared methodology
  "method.kicker": "How We Built This",
  "method.title": "Methodology & open data",
  "method.intro": (entity, year, kindNoun, status) => (status === "proposed"
    ? `Every figure on this page is pulled straight from ${entity}'s ${year} PROPOSED budget — the Administrator's recommended budget as presented to the County Board, not yet adopted — and checked against the budget's own printed totals. Nothing here is hand-typed or estimated.`
    : `Every figure on this page is pulled straight from ${entity}'s official adopted ${year} budget — the same document the ${kindNoun} publishes — and checked against the budget's own printed totals. Nothing here is hand-typed or estimated.`),
  "method.kind.county": "county",
  "method.kind.city": "city",
  "method.kind.school": "district",
  "method.step.source": (year, entity, status) => (status === "proposed" ? `The ${entity} Administrator's Proposed ${year} Annual Budget (PDF), as presented to the County Board — not yet adopted.` : `The official Adopted ${year} Annual Budget (PDF), published by ${entity}.`),
  "method.step.sourceLabel": "Source.",
  "method.step.extraction": "An open-source script reads the budget's tables directly from the PDF — no manual transcription.",
  "method.step.extractionLabel": "Extraction.",
  "method.step.verification": "Each table is reconciled line-by-line against the budget's printed totals. If a number doesn't add up, the process stops rather than publish a wrong figure.",
  "method.step.verificationLabel": "Verification.",
  "method.step.updates": "Refreshed when a new budget is proposed and again when it is adopted.",
  "method.step.updatesLabel": "Updates.",
  "method.dlJson": "Download the full data (JSON)",
  "method.dlCsv": "Download spending (CSV)",
  "method.reuse": "This data is free to reuse. Built and maintained by Wausau Pilot & Review as part of its civic transparency work.",
  "method.corrections": "Spot an error, or have a question about these numbers?",
  "method.correctionsLink": "Contact Wausau Pilot & Review",
  "suite.linkLead": "See the decisions behind the budget.",
  "suite.linkBody": (status) => (status === "proposed"
    ? "This proposal is being debated now, in public meetings, before the board votes — follow them in WPR's Central Wisconsin Meeting Tracker."
    : "This budget was debated and adopted in public meetings — follow them in WPR's Central Wisconsin Meeting Tracker."),
  "calc.estProperty": "Estimated annual property tax",
  "calc.fmvHint": "On your tax bill as “Est. Fair Mkt.” — not the assessed value.",

  // per-resident / per-household divisor toggle (County + City "Where It Goes")
  "pc.total": "Total dollars",
  "pc.perResident": "Per resident",
  "pc.perHousehold": "Per household",
  "pc.note": (pop, hh, basis) =>
    `Per-resident and per-household figures divide each amount by the area's ${basis} count: ${pop} residents, ${hh} households.`,

  // shared footer
  "foot.amended": "Figures are as adopted and may be amended during the year.",
  "foot.proposedAmend": (vote) => `These are the Administrator's proposed figures; the County Board can amend them before its ${vote} vote.`,
  "ed.proposedTag": "Proposed — not yet adopted",
  "ed.proposedBody": (year, hearing, vote) => `This is the County Administrator's proposed ${year} budget. The County Board holds a public hearing on ${hearing} and votes on ${vote}; supervisors can amend it until then.`,
  "ed.backToAdopted": (year) => `See the adopted ${year} budget`,
  "ed.pointer": (year, hearing) => `The proposed ${year} budget is out — public hearing ${hearing}. See what's proposed`,
  "foot.sourceLabel": "Source:",

  // shared section building blocks
  "btn.spending": "Spending",
  "btn.revenue": "Revenue",
  "btn.byDepartment": "By department",
  "lbl.principal": "Principal",
  "lbl.interest": "Interest",
  "kick.generalFund": "The General Fund",
  "kick.followMoney": "Follow the Money",
  "kick.wholePicture": "The Whole Picture",
  "kick.shiftingPriorities": "Shifting Priorities",
  "kick.bottomLine": "The Bottom Line",
  "title.whereDollarGoes": "Where every dollar goes",
  "title.howGfFlows": "How the general fund flows",
  "title.taxbillMeaning": "What it means for your tax bill",
  "title.outstandingDebt": "Outstanding debt",
  "stat.totalBudget": "Total budget",
  "stat.millRate": "Mill rate",
  "stat.proposed": (label) => `Proposed ${label}`,

  // School body
  "s.dek": (entity) => `Every dollar in the ${entity}'s budget — where it comes from, where it goes, and what it means for your tax bill. Adopted by the Board of Education.`,
  "s.stat.allFundsNet": "all funds, net",
  "s.stat.schoolLevy": "School tax levy",
  "s.stat.levyFlat": (prior) => `unchanged from ${prior}`,
  "s.stat.vsPrior": (chg, prior) => `${chg} vs. ${prior}`,
  "wc.levyFlatNote": (prior) => `held flat to the dollar — same total as ${prior}`,
  "wc.rateVsNote": (chg, base, prior) => `${chg} from $${base} in ${prior}`,
  "s.foot.levyFlat": (amt, prior, cur) =>
    `The total tax levy is the same figure both years by design: ${amt} in ${prior} and again in ${cur}. The district's budget book ("Proposed Tax Levy" page) prints the change as $0 (0.00%) — debt-service levy was shifted into the general fund, leaving the total unchanged.`,
  "s.where.dek": (gf) => `The general fund — ${gf} — pays for the district's day-to-day operations. Schools don't budget salaries building-by-building, so the honest view is by object: toggle between what the money buys and where it comes from.`,
  "s.where.showPeople": (showing) => `${showing ? "Hide" : "Show"} what salaries & benefits buy`,
  "s.where.noteSpend": (share) => `Change shown vs. the prior-year budget. People — salaries and benefits — are ${share}% of the general fund; teacher salaries alone are its single largest cost.`,
  "s.where.noteRev": "Change shown vs. the prior-year budget. State aid, not the local levy, is the district's largest revenue source.",
  "s.flow.dek": "Every general-fund dollar, traced from where it comes from, through the fund, to what it pays for. Hover any ribbon to follow the money.",
  "s.flow.note": "General Fund revenue sources (left) into the fund (center) and out to spending by object (right). Hover a flow for its amount.",
  "s.allfunds.title": "All funds, by purpose",
  "s.allfunds.dek": (gross) => `Beyond the general fund, the district's ${gross} all-funds budget covers special education, debt service, food service, capital projects and community programs — each a separate legal fund.`,
  "s.allfunds.note": "Spending by fund, change shown vs. the prior-year budget. Interfund transfers mean fund totals overlap; the all-funds figure above is net of them.",
  "s.students.kick": "The Students",
  "s.students.title": "Enrollment & spending per student",
  "s.students.dek": (now, year, chg, then, per) =>
    `The district enrolls ${now} students in ${year}` +
    (chg < 0 ? `, down ${Math.abs(chg).toLocaleString()} from ${then} five years ago` : chg > 0 ? `, up ${chg.toLocaleString()} over five years` : ", flat over five years") +
    `. That works out to about ${per} of general-fund spending per student.`,
  "s.students.note": (y0, y1, perGF, perAll) => `Districtwide certified enrollment (headcount), ${y0}–${y1}. Source: Wisconsin DPI WISEdash. Per-student figures use this enrollment: ${perGF} from the general fund, or ${perAll} counting all funds (net of transfers). The spending line divides each year's adopted general-fund budget, from that year's budget book, by that year's enrollment; a statewide comparison will be added when DPI's per-member finance data is available.`,
  "s.students.studentsLabel": "students",
  "s.students.legendEnroll": "Students enrolled",
  "s.students.legendPerStudent": "General-fund spending per student",
  "s.students.tipPerStudent": "per student",
  "s.overtime.title": "The mill rate over half a century",
  "s.overtime.dek": (peak, mill, growth, firstYr, lastVal, lastYr) => `The school tax rate has fallen from a peak of $${peak} per $1,000 to $${mill} today — even as the levy itself has grown — because the district's equalized property base has grown far faster: roughly ${growth}× since ${firstYr}, to ${lastVal} in ${lastYr}.`,
  "s.overtime.legendRate": "Mill rate (left)",
  "s.overtime.legendVal": "Equalized value (right)",
  "s.overtime.tipRate": "Mill rate",
  "s.overtime.tipVal": "Equalized value",
  "s.overtime.note": (y0, y1, vy0, vy1) => `Equalized school mill rate (${y0}–${y1}) against the district's equalized property value (${vy0}–${vy1}). As the tax base climbs, the same levy needs a smaller rate.`,
  "s.overtime.calloutTitle": (cents) => `Why the rate fell ${cents}¢ this year`,
  "s.taxbill.dek": (rate) => `The school district is one line on your property-tax bill, at $${rate} per $1,000 of value. Enter your home's value to see your estimated school taxes and which district fund each dollar supports.`,
  "s.taxbill.homeLabel": "Your home's fair market value",
  "s.taxbill.estOut": "Estimated annual school tax, before the state school levy credit",
  "s.taxbill.totalRow": "Your school taxes",
  "s.taxbill.note": (fiscal, rate) => `Estimated from the ${fiscal} school mill rate of $${rate} per $1,000 of equalized value. This is only the school district's share — your full bill also includes the county, your municipality, and the technical college. Actual bills vary with credits and exemptions.`,
  "s.debt.kick": "What the District Owes",
  "s.debt.dek": (principal, interest) => `The district carries ${principal} in outstanding principal — largely the voter-approved 2022 referendum — with ${interest} in interest still to come. Here is how it is scheduled to be paid down.`,
  "s.debt.note": (y0, total0, yN) => `Annual principal + interest on existing debt. The ${y0} payment is ${total0}; the schedule runs through ${yN}.`,
  "s.foot.source": (entity, fiscal) => `${entity} ${fiscal} Annual Budget.`,
  "s.foot.builtBy": "Built and maintained by Wausau Pilot & Review; fund, levy, mill-rate and debt figures extracted directly from the district's published budget document and reconciled against its printed totals.",

  // City body
  "c.dek": (entity) => `Every dollar in the ${entity}'s budget — where it comes from, where it goes, and what it means for your tax bill. Adopted by the Common Council.`,
  "c.stat.allFunds": "all funds",
  "c.stat.cityLevy": "City tax levy",
  "c.stat.cityShare": "City share of tax bill",
  "c.stat.cityShareSub": (total) => `of $${total} total rate`,
  "c.where.dek": (gf) => `The general fund — ${gf} — pays for day-to-day city services. Toggle to see what it spends by department, and where that money comes from.`,
  "c.where.noteDept": (prior) => `Change shown vs. the ${prior} adopted budget. Police and Fire together are the largest share of city spending.`,
  "c.where.noteRev": (prior) => `Change shown vs. the ${prior} adopted budget. Property taxes are the city's single largest revenue source.`,
  "c.flow.dek": "Every general-fund dollar, traced from where it comes from, through the fund, to what it pays for. Hover any ribbon to follow the money.",
  "c.flow.note": "General Fund revenue sources (left) into the fund (center) and out to departments (right). The largest five of each are named; the rest are grouped. Hover a flow for its amount.",
  "c.allfunds.title": "All funds, by category",
  "c.allfunds.dek": (total) => `Beyond the general fund, the city's ${total} all-funds budget covers capital projects, debt service, enterprise and special-revenue funds. Here it is by type of spending.`,
  "c.allfunds.note": (prior) => `Change shown vs. the ${prior} adopted budget, all funds.`,
  "c.overtime.title": "The levy over time",
  "c.overtime.dek": (first, firstYr, last, lastYr, pct) => `The city's property-tax levy has risen from ${first} in ${firstYr} to ${last} in ${lastYr} — up ${pct}%.`,
  "c.overtime.note": (y0, y1) => `Actual property-tax levy as adopted, ${y0}–${y1}.`,
  "c.overtime.calloutTitle": "The city is at its levy ceiling",
  "c.overtime.calloutBody": (exception, year, since, atLeast) => `Every year since ${atLeast ? "at least " : ""}${since}, Wausau's levy has sat above the basic state limit — ${exception} over in ${year}, allowed only through the debt-service exemption. The federal ARPA and SAFER grants that paid for 15 first-responder positions have since run out — the "ticking time bomb" of the mayor's 2026 budget message — and in April 2026 voters approved a $1.45 million levy increase above the limit to keep 12 firefighter/paramedic positions.`,
  "c.workforce.kick": "The People",
  "c.workforce.title": "The city's workforce over time",
  "c.workforce.dek": (now, then, year) => `The city budgets ${now} full-time-equivalent positions in ${year}, up from ${then} a decade ago. Pick a department to see how its staffing has changed.`,
  "c.workforce.note": (dept, now, year, change, sinceYear) =>
    `${dept}: ${now} budgeted FTE in ${year}` +
    (change === 0 ? ", unchanged" : change > 0 ? `, up ${change.toFixed(2).replace(/\.?0+$/, "")}` : `, down ${Math.abs(change).toFixed(2).replace(/\.?0+$/, "")}`) +
    (change !== 0 ? ` since ${sinceYear}` : "") +
    ". Elected alderpersons are excluded from the workforce total.",
  "c.taxbill.dek": (share) => `The city is only one line on your property-tax bill — ${share}% of it. Enter your home's value to see your estimated annual bill and exactly where each dollar goes.`,
  "c.taxbill.homeLabel": "Your home's fair market value",
  "c.taxbill.totalRow": "Your total bill",
  "c.taxbill.note": (year, total) => `Estimated from the ${year} tax rates — the latest all four governments have set — of $${total} per $1,000 of fair market value, computed from the Wisconsin Department of Revenue's certified levies and values. School taxes are net of the state school levy credit; the lottery and first-dollar credits most homeowners also receive (worth a few hundred dollars) are not subtracted.`,
  "c.dev.kick": "Betting on Growth",
  "c.dev.title": "Tax increment districts",
  "c.dev.dek": (count) => `The city runs ${count} active tax increment districts (TIDs) — areas where the growth in property value is captured to repay public investment in development. Here is how much each district's value grew last year.`,
  "c.dev.note": (year, decrease) => `Valuation growth, ${year}. The budget also includes the developer incentive payments above, and a net TID levy decrease of ${decrease}.`,
  "c.dev.noteClosure2026": "That decrease reflects the closure of District 6.",
  "c.debt.kick": "What the City Owes",
  "c.debt.dek": (outstanding, pct) => `The city carries ${outstanding} in general-obligation debt — ${pct}% of its legal borrowing limit. Here is how it is scheduled to be paid down.`,
  "c.debt.note": (y0, total0, yN) => `Annual principal + interest on existing general-obligation debt. The ${y0} payment is ${total0}; the schedule runs through ${yN}.`,
  "c.foot.source": (entity, year) => `${entity} Adopted ${year} Budget.`,
  "c.foot.builtBy": "Built and maintained by Wausau Pilot & Review; department, fund, levy, tax-rate and debt figures extracted directly from the city's published budget document and reconciled against its printed totals.",

  // shared department drill-down balance labels
  "bal.whereGoes": "Where it goes",
  "bal.whereFrom": "Where it comes from",
  "bal.operatingExp": "Operating expenditures",
  "bal.personnel": "Personnel",
  "bal.totalSpending": "Total spending",
  "bal.revenueRaised": "Revenue raised",
  "bal.countyLevy": "County tax levy",
  "bal.totalFunding": "Total funding",

  // County body
  "co.dek": (entity, date) => `Every dollar in ${entity}'s budget — where it comes from, where it goes, and what it means for your tax bill. Adopted by the County Board on ${date}.`,
  "co.dekProposed": (entity, date) => `Every dollar in ${entity}'s proposed budget — where it would come from, where it would go, and what it would mean for your tax bill. Presented by the County Administrator on ${date}; not yet adopted.`,
  "co.stat.countyLevy": "County tax levy",
  "co.stat.driver": (prev, fund, change, total) => `Total spending is ${total} vs. ${prev}; the biggest single change is the ${fund} (${change}).`,
  "co.where.dek": "The county's general fund pays for day-to-day government. Toggle to see what it spends — and where the money comes from before the property-tax levy fills the gap.",
  "co.where.pending": (hearing) => `The general fund's breakdown by function isn't in the Administrator's proposed book — the county prints it in the public-hearing notice it publishes ahead of the ${hearing} hearing, and it will appear here then. Meanwhile, the department ledger below shows the proposed general fund, department by department.`,
  "co.where.note": (flow, year, psShare) => (flow === "expenditures"
    ? `Change shown vs. the ${year - 1} adopted budget.${psShare ? ` Public safety alone is ${psShare}% of general-fund spending.` : ""}`
    : `Change shown vs. the ${year - 1} adopted budget. Whatever these sources don't cover is made up by the property-tax levy.`) +
    ` The mini-trend traces each row from ${year - 2} (actual) through ${year - 1} (budget) to ${year} (adopted).`,
  "co.dept.kick": "The Drill-Down",
  "co.dept.title": "Department by department",
  "co.dept.dek": (n) => `${n} departments and cost centers. Each one's total spending equals the tax levy that supports it plus the revenue it raises on its own. Click any row to open the books.`,
  "co.dept.colDepartment": "Department",
  "co.dept.colSpend": "Total spending",
  "co.dept.colPersonnel": "Personnel",
  "co.dept.colLevy": "Tax levy",
  "co.dept.colVs": (prev) => `vs '${String(prev).slice(2)}`,
  "co.dept.detailLevy": (dept) => `The levy supporting ${dept}`,
  "co.dept.unchanged": (prev) => `is unchanged from ${prev}.`,
  "co.dept.rose": (amt, prev) => `is up ${amt} from ${prev}.`,
  "co.dept.fell": (amt, prev) => `is down ${amt} from ${prev}.`,
  "co.dept.returns": "It returns more revenue to the county than it costs to run.",
  "co.trends.title": "How the budget has changed over time",
  "co.trends.dek": (pct, since, rateFell) => `The total tax levy — every dollar the county raises from property taxes — has risen ${pct}% since ${since}${rateFell ? ", even as the mill rate has fallen. Property values simply grew faster than the rate came down." : "."}`,
  "co.trends.legendLevy": "Total county tax levy",
  "co.trends.legendProposed": (year) => `${year} proposed (not yet adopted)`,
  "co.trends.legendRate": "Mill rate (per $1,000 of value)",
  "co.trends.note": (first, firstYr, last, lastYr, pct, r0, r1) => `The levy rose from ${first} in ${firstYr} to ${last} in ${lastYr} — up ${pct}% — while the mill rate fell from $${r0} to $${r1} per $1,000 of value.`,
  "co.trends.subhead": (first, last) => `Department by department, ${first} vs ${last}`,
  "co.trends.amounts": "Amounts",
  "co.trends.change": "Change",
  "co.trends.legendYr": (yr) => `${yr} levy`,
  "co.trends.cmpNote": (first, last, proposedLast) => `County tax levy by department, ${first}–${last}, each year taken from that year's own adopted budget book${proposedLast ? ` (${last}: the Administrator's proposal, not yet adopted)` : ""}. Revenue-returning offices (e.g. the County Treasurer), whose levy is negative, are omitted. In a tax context an increase is shown in red.`,
  "co.trends.proposalBasis": (year) => `The ${year} figures come from that year's budget-book tables, which — as the book itself notes — reflect the Administrator's proposal rather than the board's final amendments.`,
  "co.bill.dek": (since) => `The county's mill rate has fallen nearly every year since ${since}. But because home values climbed faster, the bill on a typical home kept rising anyway. Enter your home's value to see your county tax.`,
  "co.bill.homeLabel": "Your home's fair market value",
  "co.bill.estOut": (year, proposed) => `Your ${year} county property tax${proposed ? " at the proposed rate" : ""}`,
  "co.bill.legendRate": "Mill rate (per $1,000 of value)",
  "co.bill.legendBill": "Avg. bill on a typical home",
  "co.bill.note": (v0, y0, v1, y1, r0, r1) => `A typical home went from about ${v0} in ${y0} to ${v1} in ${y1}, while the mill rate dropped from $${r0} to $${r1}.`,
  "co.funds.kick": "Beyond the General Fund",
  "co.funds.title": "The county's other funds",
  "co.funds.dek": "Highways, the landfill, debt service and employee benefits run on their own dedicated funds.",
  "co.funds.colFund": "Fund",
  "co.funds.colLevy": "Levy support",
  "co.funds.colRevenue": "Revenue",
  "co.funds.colSpending": "Spending",
  "co.funds.none": "none",
  "co.debt.kick": "What the County Owes",
  "co.debt.dek": (count, total, asOf) => `${count} bond and note series — ${total} in principal outstanding as of December 31, ${asOf}.`,
  "co.foot.source": (entity, year, status) => (status === "proposed" ? `${entity} Administrator's Proposed ${year} Annual Budget.` : `${entity} Adopted ${year} Annual Budget.`),
  "co.foot.builtBy": "Built and maintained by Wausau Pilot & Review. Department and fund detail extracted directly from the county's published budget document; column totals reconciled against the county's own figures.",
  "co.foot.levyLabel": "A note on the levy total:",
  "co.foot.levyBody": "the county's budget-summary page reports a 2026 levy of $61.4 million, a 5.99% increase. Its own detailed fund and department tables — which this tool uses, and which the 10-year levy history matches — total $61.2 million, a 5.6% increase. The $200,000 gap traces to the Debt Service Fund ($4.71M on the summary page vs. $4.51M in the detail). We show the self-consistent detail figure throughout.",

  // Tax-bill overview
  "tb.h1": "Where your tax bill goes",
  "tb.dek": "Four kinds of local government tax every home in Marathon County. Three quick steps show your whole bill — and which government gets each dollar.",
  "tb.homeLabel": "Your home's fair market value",
  "tb.estOut": "Estimated annual tax, before lottery & first-dollar credits",
  "tb.muniQ": "Where is your home?",
  "tb.group.City": "Cities",
  "tb.group.Village": "Villages",
  "tb.group.Town": "Towns",
  "tb.splitPart": "(Marathon County part)",
  "tb.collegeAveraged": (where) => `The ${where} is split between two technical college districts. The state's town-level data reports one combined college levy, so the college line here blends the two colleges' rates; your bill shows the one for your school district.`,
  "tb.schoolQ": "Which school district is your home in?",
  "tb.schoolNote": (where) => `The ${where} spans more than one school district, and each has its own school tax rate. Your tax bill names yours.`,
  "tb.explore": "Explore",
  "tb.totalRow": "Your total bill",
  "tb.note": (year, total, where) => `Based on the ${year} tax rates for the ${where} — the bills paid in early ${year + 1} — of $${total} per $1,000 of fair market value. School taxes are net of the state school levy credit; the lottery and first-dollar credits most homeowners also receive (worth a few hundred dollars) are not subtracted, and homes inside a special district (e.g. a sanitary or lake district) pay its tax too. The county, the City of Wausau and the Wausau School District each have their own detailed breakdown in this tool.`,
  "tb.foot.source": (year) => `Wisconsin Department of Revenue, ${year} Town, Village and City Taxes — every Marathon County municipality's certified levies and property values.`,
  "tb.foot.builtBy": "Built and maintained by Wausau Pilot & Review as part of its “Follow the Money” civic-transparency suite; every rate is computed from the state's certified levies and values, which are reconciled against their printed totals.",

  // Landing page
  "lp.home": "Overview",
  "lp.heroDek": "See where every local tax dollar in the Wausau area goes — across your county, your city, and your school district — and what it means for your property-tax bill.",
  "lp.combinedCaption": "Total local property tax on a $200,000 home in the City of Wausau, before state lottery and first-dollar credits — split across four governments.",
  "lp.seeBreakdown": "See the breakdown",
  "lp.season": (name, year, hearing) => `${name}'s proposed ${year} budget is out — public hearing ${hearing}.`,
  "lp.seasonCta": "See what's proposed",
  "lp.explore": "Explore",
  "lp.card.budget": "annual budget",
  "lp.card.typicalBill": "on a $200k home",
  "lp.desc.county": (n) => `${n} departments and cost centers, the tax levy, the mill rate, and the county's other funds.`,
  "lp.desc.city": "General-fund departments, the money-flow, an 11-year workforce, and the property-tax split.",
  "lp.desc.school": "Spending by object, enrollment, half a century of mill rates, and school debt.",
  "lp.desc.taxbill": "Your whole local property-tax bill — for any home in Marathon County, split across every government that taxes it.",
  "lp.credibility": "Every figure comes straight from each government's own budget documents and the state's certified tax data, and is reconciled against their printed totals — open data, free to reuse, refreshed as new budgets are proposed and adopted.",
  "lp.footer": "A civic-transparency project of Wausau Pilot & Review.",
};



// English ships with the app; the other tables load when a reader picks the
// language (cached for the session), so the landing page and the embeds don't
// carry ~2/3 of the suite's text to readers who never switch.
const TABLES = { en: EN };
const LANG_LOADERS = { es: () => import("./strings/es.js"), hmn: () => import("./strings/hmn.js") };
const loadTable = (lang) => (TABLES[lang] ? Promise.resolve() : LANG_LOADERS[lang]().then((m) => { TABLES[lang] = m.default; }));

// ---- context / hook ------------------------------------------------------
const LangContext = createContext({ lang: "en", setLang: () => {} });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGS.some((l) => l.code === saved)) return saved;
    } catch (e) { /* localStorage unavailable */ }
    return "en";
  });
  // A returning Spanish/Hmong reader: hold the first render until the table is
  // in (one small cached chunk) rather than flash the page in English.
  const [ready, setReady] = useState(() => Boolean(TABLES[lang]));
  useEffect(() => { if (!ready) loadTable(lang).then(() => setReady(true)); }, [ready, lang]);
  // Switching: keep the current language on screen until the new table loads.
  const setLang = (l) => {
    try { localStorage.setItem(STORAGE_KEY, l); } catch (e) { /* ignore */ }
    loadTable(l).then(() => setLangState(l));
  };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  if (!ready) return null;
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

// Returns t(key, ...args): looks up the current language, falls back to English,
// and calls the entry if it's a function (interpolation).
export function useStrings() {
  const { lang } = useContext(LangContext);
  // Stable per language, so memos that list `t` in their deps actually hold.
  return useMemo(() => (key, ...args) => {
    const entry = (TABLES[lang] && TABLES[lang][key] !== undefined) ? TABLES[lang][key] : EN[key];
    if (entry === undefined) return key; // surfaces a missing key loudly in the UI
    return typeof entry === "function" ? entry(...args) : entry;
  }, [lang]);
}
