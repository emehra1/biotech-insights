import type {
  DealFacts,
  Entities,
  EventType,
  EvidenceLevel,
  KeyFacts,
  RegulatoryFact,
  TrialResult,
} from "../../lib/types";
import { sentenceAround } from "../normalize/sentences";
import { squish } from "../normalize/text";
import { displayable } from "./entities";

/**
 * Fact extraction: the numbers and outcomes that make a headline actionable.
 * Every fact carries the verbatim sentence it came from — with no model in the
 * loop, that quote is the correctness guarantee, and it lets a human adjudicate
 * a mis-parse in two seconds.
 */

const NCT = /\bNCT\s?0?\d{7,8}\b/gi;
const PHASE =
  /\b(?:phase|ph\.?)\s?(1\/2|2\/3|1b\/2|I\/II|II\/III|Ib\/II|[1-4]|I{1,3}V?|IV)\s?([ab])?\b/gi;
const ENROLL =
  /\b(?:n\s?=\s?|enrolled|randomi[sz]ed|treated|dosed)\s?(\d{1,3}(?:,\d{3})*)\s?(?:patients|participants|subjects)?\b/gi;
const ORR =
  /\b(?:ORR|o(?:verall|bjective)\s+response\s+rate)\D{0,25}(\d{1,3}(?:\.\d)?)\s?%/gi;
const MEDIAN =
  /\bmedian\s+(PFS|OS|DOR|EFS|progression-free survival|overall survival|duration of response)\D{0,20}(\d{1,3}(?:\.\d)?)\s?(months?|mo\b|weeks?|years?)/gi;
const HR_RE =
  /\b(?:HR|hazard ratio)\s?(?:of|=|:)?\s?(0?\.\d{1,3}|\d\.\d{1,3})/gi;
const PVAL = /\bp\s?[<=>]\s?(0?\.\d+|\d\.\d+(?:[eE]-?\d+)?)/g;

const HIT =
  /\b(?:met|achieved|hit)\s+(?:its\s+|the\s+)?(?:co-)?primary\s+(?:endpoint|objective)|statistically significant(?:ly)?\s+(?:improv|reduc|increas)/gi;
const MISS =
  /\b(?:missed|failed to (?:meet|achieve)|did not (?:meet|achieve|reach)|fell short of)\s+(?:its\s+|the\s+)?(?:co-)?primary|no statistically significant|\bflopped\b|\bfell flat\b|discontinu(?:ed|ing) the (?:study|trial|program)/gi;

const SAFETY =
  /\bgrade\s?([3-5])\s?(?:\+|or higher)?\s?(?:treatment-related\s?)?(?:adverse events?|AEs?|TRAEs?)\b|\bclinical hold\b|\bboxed warning\b|\bdeaths? (?:in|among) (?:the )?(?:treatment|study) (?:arm|group)/gi;

const APPROVAL =
  /\b(?:FDA|EMA|CHMP|MHRA|PMDA|NMPA|European Commission)\b[^.]{0,90}?\b(approv\w+|authoris\w+|clear\w+|licens\w+)|\b(?:approved|cleared) by the (?:FDA|EMA)\b/gi;
const CRL = /\bcomplete response letter\b|\bCRLs?\b/g;
const FILING =
  /\b(?:BLA|sBLA|NDA|sNDA|MAA|IND|510\(k\)|PMA)\b|\bfiled for (?:approval|marketing)\b|\bsubmitted (?:an? )?(?:BLA|NDA|MAA)\b/g;
const DESIGNATION =
  /\b(?:breakthrough therapy|fast track|orphan drug|RMAT|PRIME|priority review|accelerated approval)(?:\s+designation)?\b/gi;
const ADCOMM = /\b(?:advisory committee|adcomm|ODAC)\b/gi;

const MONEY =
  /(?:US)?([$€£])\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s?(billion|bn|million|mn|[BM])\b/g;
const UPFRONT = /\b(upfront|up front)\b/i;
const MILESTONE = /\bmilestones?\b/i;
const ROUND = /\bSeries\s+([A-J])\b|\bseed (?:round|financing)\b|\bcrossover\b/g;
const IPO_RE =
  /\bIPO\b|initial public offering|priced its[^.]{0,30}offering|Nasdaq debut|listed on (?:the )?(?:Nasdaq|NYSE)/gi;
/**
 * Corporate senses only. "acquired resistance", "acquired immunity" and
 * "licensed to bind" are everywhere in biology abstracts, and an unguarded
 * /acquir\w+/ tagged a bioRxiv paper on CD4 T cells as M&A.
 */
const MA_RE =
  /\b(?:acquires?|acquiring|acquisition of|agreed to acquire|will acquire|to buy|buyout|merger|merge with|takeover|tender offer|definitive (?:merger )?agreement)\b/gi;
const MA_BIOLOGICAL =
  /\bacquired\s+(resistance|immunity|mutations?|deficiency|characteristics|phenotypes?|traits?)\b/i;
const LICENSE_RE =
  /\b(?:licensing (?:agreement|deal|pact)|license agreement|licensed (?:to|from)|exclusive licen[cs]e|out-licens\w+|in-licens\w+|ex-China rights|(?:global|worldwide|ex-US) rights|collaboration (?:and license )?agreement)\b/gi;
const DISTRESS =
  /\b(lay(?:ing)? off|layoffs?|restructur\w+|cut(?:ting)? \d{1,3}% of (?:its )?(?:staff|workforce)|winding down|Chapter 11|discontinu\w+ (?:its )?(?:pipeline|program))\b/gi;
const PERSONNEL =
  /\b(?:names?|appoints?|hires?|steps? down|departs?|resigns?|succeeds?)\b[^.]{0,40}\b(?:CEO|CFO|CSO|CMO|COO|chief executive|chief medical|chief scientific|president)\b/gi;
const OPINION =
  /\b(?:opinion|commentary|editorial|roundup|q&a|interview|viewpoint|perspective|chutes & ladders|newsletter)\b/gi;

const PRECLINICAL =
  /\b(in mice|in mouse|murine|mouse model|rodent|in vitro|cell lines?|organoids?|zebrafish|C\. elegans|Drosophila|preclinical|non-human primates?)\b/i;
/**
 * Non-mammalian model systems. Real science, but several translational steps
 * further out than a mouse study — and without this, a honeybee mitophagy paper
 * outranks the day's biggest M&A story on keyword match alone.
 */
const NON_MAMMALIAN =
  /\b(Apis (?:cerana|mellifera)|honeybees?|Drosophila|fruit fly|C\. elegans|Caenorhabditis|nematodes?|zebrafish|Danio rerio|yeast|S\. cerevisiae|Saccharomyces|Arabidopsis|E\. coli|planaria|killifish|Xenopus)\b/i;
const CLINICAL =
  /\b(patients|participants|randomi[sz]ed|phase\s?[1-4]|enrolled|volunteers|cohort of \d+)\b/i;
const REVIEW = /\b(review|meta-analysis|systematic review|perspective|commentary)\b/i;

function sentenceContaining(text: string, index: number): string {
  return sentenceAround(text, index);
}

function firstMatch(re: RegExp, text: string): RegExpExecArray | null {
  const clone = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return clone.exec(text);
}

export function isNonMammalianModel(text: string): boolean {
  return NON_MAMMALIAN.test(text) && !/\b(patients|clinical trial|phase\s?[1-4])\b/i.test(text);
}

export function detectEvidenceLevel(text: string): EvidenceLevel {
  if (PRECLINICAL.test(text)) {
    return /\b(in vitro|cell lines?|organoids?)\b/i.test(text) && !/\bmice|mouse|murine|rodent\b/i.test(text)
      ? "in-vitro"
      : "preclinical";
  }
  if (CLINICAL.test(text)) return "clinical";
  if (REVIEW.test(text)) return "review";
  return "unknown";
}

export function extractTrialResults(text: string): TrialResult[] {
  const results: TrialResult[] = [];

  for (const match of text.matchAll(ORR)) {
    if (match.index === undefined) continue;
    results.push({
      metric: "ORR",
      value: `${match[1]}%`,
      verbatim: sentenceContaining(text, match.index),
    });
  }
  for (const match of text.matchAll(MEDIAN)) {
    if (match.index === undefined) continue;
    const raw = (match[1] ?? "").toLowerCase();
    const metric = raw.startsWith("pfs") || raw.includes("progression")
      ? "PFS"
      : raw.startsWith("os") || raw.includes("overall")
        ? "OS"
        : raw.startsWith("dor") || raw.includes("duration")
          ? "DOR"
          : "EFS";
    results.push({
      metric,
      value: `${match[2]} ${match[3]}`,
      verbatim: sentenceContaining(text, match.index),
    });
  }
  for (const match of text.matchAll(HR_RE)) {
    if (match.index === undefined) continue;
    results.push({
      metric: "HR",
      value: match[1] ?? "",
      verbatim: sentenceContaining(text, match.index),
    });
  }
  for (const match of text.matchAll(PVAL)) {
    if (match.index === undefined) continue;
    results.push({
      metric: "p",
      value: match[0].replace(/\s+/g, ""),
      verbatim: sentenceContaining(text, match.index),
    });
  }

  return results.slice(0, 6);
}

export function detectOutcome(text: string): KeyFacts["outcome"] {
  const hit = HIT.test(text);
  HIT.lastIndex = 0;
  const miss = MISS.test(text);
  MISS.lastIndex = 0;
  // Never silently pick a side: "met the primary endpoint but the magnitude was
  // not clinically meaningful" is genuinely mixed, and saying so is honest.
  if (hit && miss) return "mixed";
  if (hit) return "met";
  if (miss) return "missed";
  return undefined;
}

export function extractRegulatory(text: string): RegulatoryFact[] {
  const facts: RegulatoryFact[] = [];
  const seen = new Set<string>();

  const push = (agency: string, action: string, index: number) => {
    const key = `${agency}:${action}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ agency, action, verbatim: sentenceContaining(text, index) });
  };

  const approval = firstMatch(APPROVAL, text);
  if (approval?.index !== undefined) {
    const agency = /EMA|CHMP|European/i.test(approval[0]) ? "EMA" : /MHRA/i.test(approval[0]) ? "MHRA" : "FDA";
    push(agency, "approval", approval.index);
  }
  const crl = firstMatch(CRL, text);
  if (crl?.index !== undefined) push("FDA", "complete response letter", crl.index);

  const filing = firstMatch(FILING, text);
  if (filing?.index !== undefined) push("FDA", `filing (${filing[0]})`, filing.index);

  const designation = firstMatch(DESIGNATION, text);
  if (designation?.index !== undefined) push("FDA", designation[0].toLowerCase(), designation.index);

  const adcomm = firstMatch(ADCOMM, text);
  if (adcomm?.index !== undefined) push("FDA", "advisory committee", adcomm.index);

  return facts.slice(0, 4);
}

function toUsdMillions(currency: string, amount: string, unit: string): number {
  const value = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(value)) return 0;
  const multiplier = /^(b|bn|billion)$/i.test(unit) ? 1000 : 1;
  return value * multiplier;
}

export function extractDeal(text: string, hasCompany = true): DealFacts | undefined {
  // A deal needs a corporate actor. Without this gate, a paper that happens to
  // mention "$" or "collaboration" becomes a financing story.
  if (!hasCompany) return undefined;
  if (MA_BIOLOGICAL.test(text) && !/\b(acquires?|acquisition of|agreed to acquire)\b/i.test(text)) {
    return undefined;
  }

  const money = [...text.matchAll(MONEY)];
  const ipo = firstMatch(IPO_RE, text);
  const ma = firstMatch(MA_RE, text);
  const license = firstMatch(LICENSE_RE, text);
  const round = firstMatch(ROUND, text);

  let type: DealFacts["type"] | undefined;
  let anchorIndex = 0;
  if (ma?.index !== undefined) {
    type = "M&A";
    anchorIndex = ma.index;
  } else if (ipo?.index !== undefined) {
    type = "IPO";
    anchorIndex = ipo.index;
  } else if (round?.index !== undefined) {
    type = "financing";
    anchorIndex = round.index;
  } else if (license?.index !== undefined) {
    type = "license";
    anchorIndex = license.index;
  } else if (money.length > 0 && money[0]?.index !== undefined) {
    type = "financing";
    anchorIndex = money[0].index;
  }

  if (!type) return undefined;

  let upfrontUsdM: number | undefined;
  let totalUsdM: number | undefined;
  let currency: string | undefined;

  for (const match of money) {
    if (match.index === undefined) continue;
    const [, symbol, amount, unit] = match;
    if (!symbol || !amount || !unit) continue;
    currency ??= symbol === "$" ? "USD" : symbol === "€" ? "EUR" : "GBP";
    // Only USD gets normalized — never silently FX-convert.
    if (symbol !== "$") continue;
    const value = toUsdMillions(symbol, amount, unit);
    // Milestone language is checked FIRST, in a tight window. In "$250 million
    // upfront and up to $1.2 billion in milestones", a wide window sees
    // "upfront" for both figures and the milestone total is silently lost.
    const near = text.slice(Math.max(0, match.index - 24), match.index + 48);
    if (MILESTONE.test(near)) totalUsdM = Math.max(totalUsdM ?? 0, value);
    else if (UPFRONT.test(near)) upfrontUsdM ??= value;
    else totalUsdM ??= value;
  }

  return {
    type,
    upfrontUsdM,
    totalUsdM,
    round: round?.[1] ? `Series ${round[1]}` : round?.[0]?.includes("seed") ? "seed" : undefined,
    currency,
    verbatim: sentenceContaining(text, anchorIndex),
  };
}

export interface FactContext {
  title: string;
  body: string;
  entities: Entities;
  sourceKind: string;
  authority: number;
  nctIds: string[];
}

export function buildKeyFacts(context: FactContext): KeyFacts {
  const text = `${context.title}. ${context.body}`;

  const phaseMatch = firstMatch(PHASE, text);
  const enrollMatch = firstMatch(ENROLL, text);
  const enrollment = enrollMatch?.[1] ? Number(enrollMatch[1].replace(/,/g, "")) : undefined;

  const indication = displayable(context.entities.indications)[0]?.canonical;

  return {
    companies: displayable(context.entities.companies)
      .slice(0, 4)
      .map((c) => ({ name: c.canonical, role: c.role ?? "mentioned", ticker: c.ticker })),
    drugs: displayable(context.entities.drugs)
      .slice(0, 4)
      .map((d) => ({ name: d.text, inn: d.inn, brand: d.brand, modality: d.modality })),
    indication,
    phase: phaseMatch ? squish(phaseMatch[0]) : undefined,
    nct: [...new Set([...context.nctIds, ...(text.match(NCT) ?? []).map((n) => n.replace(/\s/g, "").toUpperCase())])].slice(0, 3),
    enrollment: Number.isFinite(enrollment) ? enrollment : undefined,
    results: extractTrialResults(text),
    outcome: detectOutcome(text),
    regulatory: extractRegulatory(text),
    deal: extractDeal(text, displayable(context.entities.companies).length > 0),
    evidenceLevel: detectEvidenceLevel(text),
  };
}

export interface EventOptions {
  largeDealThresholdUsdM: { ma: number; license: number; financing: number };
  isMajorJournal: boolean;
  isPreprint: boolean;
}

export function detectEventTypes(
  facts: KeyFacts,
  text: string,
  options: EventOptions,
): EventType[] {
  const events = new Set<EventType>();

  for (const regulatory of facts.regulatory) {
    if (regulatory.action === "approval") events.add("approval");
    else if (regulatory.action.includes("complete response")) events.add("crl");
    else if (regulatory.action.startsWith("filing")) events.add("filing");
    else events.add("designation");
  }

  if (facts.outcome) {
    const isPhase3 = /phase\s?(3|III)/i.test(facts.phase ?? "") || /phase\s?(3|III)/i.test(text);
    events.add(isPhase3 ? "phase3-readout" : "phase-readout");
  }

  SAFETY.lastIndex = 0;
  if (SAFETY.test(text)) events.add("safety-hold");

  const deal = facts.deal;
  if (deal) {
    const size = Math.max(deal.totalUsdM ?? 0, deal.upfrontUsdM ?? 0);
    if (deal.type === "M&A") events.add(size >= options.largeDealThresholdUsdM.ma ? "ma-large" : "ma");
    else if (deal.type === "license")
      events.add(size >= options.largeDealThresholdUsdM.license ? "license-large" : "license");
    else if (deal.type === "IPO") events.add("ipo");
    else events.add(size >= options.largeDealThresholdUsdM.financing ? "financing-large" : "financing");
  }

  DISTRESS.lastIndex = 0;
  if (DISTRESS.test(text)) events.add("distress");
  PERSONNEL.lastIndex = 0;
  if (PERSONNEL.test(text)) events.add("personnel");
  OPINION.lastIndex = 0;
  if (OPINION.test(text)) events.add("opinion");

  if (options.isMajorJournal) events.add("major-journal-primary");
  if (options.isPreprint) events.add("preprint");

  if (/\bphase\s?(3|III)\b[^.]{0,60}\b(initiat|start|begin|dosed the first|first patient)/i.test(text)) {
    events.add("phase3-start");
  }

  return [...events];
}
