import type {
  CompanyMention,
  CompanyRole,
  DrugMention,
  Entities,
  Mention,
  MentionConfidence,
} from "../../lib/types";
import { sentenceAround } from "../normalize/sentences";
import {
  ADC_PAYLOADS,
  AMBIGUOUS_COMPANY_NAMES,
  CODE_PREFIX_BLOCKLIST,
  COMPANIES,
  CORPORATE_CUE,
  CORPORATE_SUFFIXES,
  INDICATIONS,
  INN_FALSE_POSITIVES,
  INN_STEMS,
  MODALITIES,
  SPONSOR_CODES,
  TARGET_CONTEXT,
  TARGET_HOMOGRAPHS,
  TARGET_WHITELIST,
} from "../lexicon";

/**
 * Entity extraction.
 *
 * The rule that makes this usable without an LLM: **an entity needs two
 * independent signals** before it is displayed. The previous implementation
 * accepted any capitalized word, so the headline "Novo Nordisk left praying to
 * Artemis and Hermes" yielded the drugs ["Novo","Nordisk","Artemis","Hermes"].
 * Here, morphology alone only earns `stem-only`, which is counted for
 * clustering but never shown.
 */

export interface ExtractInput {
  title: string;
  body: string;
}

const CANDIDATE_WORD = /\b([A-Za-z][a-zA-Z]{4,24})\b/g;
const DEV_CODE = /\b([A-Z]{2,6})[-‑ ]?(\d{2,6})(?:[-‑]?([A-Za-z]\d{0,3}))?\b/g;

const DRUG_ANCHOR =
  /\b(drug|therapy|therapeutic|treatment|candidate|dose[ds]?|dosing|mg\b|administered|arm|placebo|approved|approval|label|trial|inhibitor|antibody|agonist|antagonist|conjugate|monotherapy|combination|injection|infusion|tablet|capsule|molecule|asset|program)\b/i;

const ANCHOR_WINDOW = 60;

function windowAround(text: string, offset: number, length: number, radius: number): string {
  return text.slice(Math.max(0, offset - radius), Math.min(text.length, offset + length + radius));
}

function addEvidence(mention: Mention, text: string, offset: number): void {
  if (mention.evidence.length >= 2) return;
  const quote = sentenceAround(text, offset).slice(0, 240);
  if (quote) mention.evidence.push({ quote, offset });
}

/* --------------------------------- drugs ---------------------------------- */

interface DrugCandidate {
  canonical: string;
  text: string;
  klass?: string;
  confidence: MentionConfidence;
  count: number;
  inTitle: boolean;
  offsets: number[];
}

export function extractDrugs(input: ExtractInput, knownCompanyWords: Set<string>): DrugMention[] {
  const haystack = `${input.title}. ${input.body}`;
  const titleLower = input.title.toLowerCase();
  const candidates = new Map<string, DrugCandidate>();

  const record = (
    raw: string,
    offset: number,
    confidence: MentionConfidence,
    klass?: string,
  ) => {
    const key = raw.toLowerCase();
    const existing = candidates.get(key);
    if (existing) {
      existing.count++;
      existing.offsets.push(offset);
      // Best signal wins.
      if (rank(confidence) > rank(existing.confidence)) existing.confidence = confidence;
      if (klass && !existing.klass) existing.klass = klass;
      return;
    }
    candidates.set(key, {
      canonical: key,
      text: raw,
      klass,
      confidence,
      count: 1,
      inTitle: titleLower.includes(key),
      offsets: [offset],
    });
  };

  // 1. ADC payload words — extremely high precision, treat as dictionary hits.
  for (const match of haystack.matchAll(ADC_PAYLOADS)) {
    if (match.index === undefined) continue;
    record(match[0], match.index, "dictionary", "antibody-drug conjugate");
  }

  // 2. INN morphology.
  for (const match of haystack.matchAll(CANDIDATE_WORD)) {
    const word = match[1];
    if (!word || match.index === undefined) continue;
    const lower = word.toLowerCase();

    if (INN_FALSE_POSITIVES.has(lower)) continue;
    if (knownCompanyWords.has(lower)) continue; // cross-extractor veto
    // -ase words are enzymes/targets, never drugs.
    if (lower.endsWith("ase")) continue;

    const stem = INN_STEMS.find((s) => lower.length >= s.minLen && s.stem.test(lower));
    if (!stem) continue;

    // An INN is lowercase in running text; a Title-Cased match mid-sentence is
    // usually a brand name, which is also fine. ALL CAPS is not a drug.
    if (word === word.toUpperCase()) continue;

    const anchorWindow = windowAround(haystack, match.index, word.length, ANCHOR_WINDOW);
    const hasAnchor = DRUG_ANCHOR.test(anchorWindow);
    record(word, match.index, hasAnchor ? "stem+anchor" : "stem-only", stem.klass);
  }

  // 3. Development codes (AZD1234, BMS-986278, ARO-APOC3).
  for (const match of haystack.matchAll(DEV_CODE)) {
    const prefix = match[1];
    const digits = match[2];
    if (!prefix || !digits || match.index === undefined) continue;
    if (CODE_PREFIX_BLOCKLIST.has(prefix)) continue;
    if (prefix.length === 2 && !SPONSOR_CODES.has(prefix)) continue;
    // A bare year with no letter fusion is a date, not a code.
    if (/^(19|20)\d{2}$/.test(digits) && !match[3]) continue;

    const before = haystack.slice(Math.max(0, match.index - 12), match.index);
    if (/[$#]\s*$|\b(n|N|p|P)\s*=\s*$|\bphase\s*$|\bQ\s*$|\bgrade\s*$/i.test(before)) continue;

    record(match[0], match.index, "code");
  }

  const out: DrugMention[] = [];
  for (const candidate of candidates.values()) {
    // Promote a repeated or headline mention out of stem-only.
    let confidence = candidate.confidence;
    if (confidence === "stem-only" && (candidate.count >= 2 || candidate.inTitle)) {
      confidence = "stem+anchor";
    }

    const mention: DrugMention = {
      text: candidate.text,
      canonical: candidate.canonical,
      confidence,
      count: candidate.count,
      inTitle: candidate.inTitle,
      evidence: [],
      modality: candidate.klass,
    };
    for (const offset of candidate.offsets.slice(0, 2)) addEvidence(mention, haystack, offset);
    out.push(mention);
  }

  return out.sort(byPriority).slice(0, 8);
}

function rank(confidence: MentionConfidence): number {
  switch (confidence) {
    case "dictionary":
      return 4;
    case "code":
      return 3;
    case "stem+anchor":
      return 2;
    case "contextual":
      return 1;
    default:
      return 0;
  }
}

function byPriority(a: Mention, b: Mention): number {
  const diff = rank(b.confidence) - rank(a.confidence);
  if (diff !== 0) return diff;
  if (a.inTitle !== b.inTitle) return a.inTitle ? -1 : 1;
  return b.count - a.count;
}

/* ------------------------------- companies -------------------------------- */

const ALIAS_INDEX = (() => {
  const index: { alias: string; entry: (typeof COMPANIES)[number] }[] = [];
  for (const entry of COMPANIES) {
    for (const alias of entry.aliases) index.push({ alias, entry });
  }
  // Longest first so "Bristol Myers Squibb" wins over "Bristol Myers".
  return index.sort((a, b) => b.alias.length - a.alias.length);
})();

const SUFFIX_COMPANY = new RegExp(
  `\\b([A-Z][A-Za-z0-9&.'-]+(?:\\s+[A-Z][A-Za-z0-9&.'-]+){0,3})\\s+(${CORPORATE_SUFFIXES.source.replace(/^\\b\(|\)\\b$/g, "")})\\b`,
  "g",
);

export function extractCompanies(input: ExtractInput): CompanyMention[] {
  const haystack = `${input.title}. ${input.body}`;
  const titleLower = input.title.toLowerCase();
  const found = new Map<string, CompanyMention>();

  const push = (
    id: string,
    text: string,
    canonical: string,
    offset: number,
    confidence: MentionConfidence,
    ticker?: string,
  ) => {
    const existing = found.get(id);
    if (existing) {
      existing.count++;
      addEvidence(existing, haystack, offset);
      return;
    }
    const mention: CompanyMention = {
      text,
      canonical,
      companyId: id,
      ticker,
      confidence,
      count: 1,
      inTitle: titleLower.includes(text.toLowerCase()),
      evidence: [],
      role: "mentioned",
    };
    addEvidence(mention, haystack, offset);
    found.set(id, mention);
  };

  // 1. Dictionary aliases, case-sensitive with word boundaries.
  for (const { alias, entry } of ALIAS_INDEX) {
    const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "g");
    for (const match of haystack.matchAll(re)) {
      if (match.index === undefined) continue;
      // Ambiguous single words need a corporate cue nearby.
      if (AMBIGUOUS_COMPANY_NAMES.has(alias.toLowerCase())) {
        const context = windowAround(haystack, match.index, alias.length, 80);
        if (!CORPORATE_CUE.test(context) && !entry.ticker) continue;
      }
      push(entry.id, alias, entry.name, match.index, "dictionary", entry.ticker);
    }
  }

  // 2. Suffix morphology catches the long tail without a dictionary entry.
  for (const match of haystack.matchAll(SUFFIX_COMPANY)) {
    const name = match[0];
    if (!name || match.index === undefined) continue;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if ([...found.values()].some((c) => name.includes(c.text))) continue;
    push(id, name, name, match.index, "contextual");
  }

  return [...found.values()].sort(byPriority).slice(0, 8);
}

/** Crude but useful role assignment; every role ships with its evidence quote. */
export function assignCompanyRoles(
  companies: CompanyMention[],
  text: string,
): CompanyMention[] {
  const maMatch = /\b(acquir\w+|to buy|buyout|merge[sr]?\w*|takeover|tender offer)\b/i.exec(text);
  if (!maMatch || maMatch.index === undefined) return companies;

  const before = text.slice(0, maMatch.index);
  const after = text.slice(maMatch.index);

  let acquirer: CompanyMention | undefined;
  let target: CompanyMention | undefined;
  for (const company of companies) {
    if (before.includes(company.text)) acquirer ??= company;
  }
  for (const company of companies) {
    if (company !== acquirer && after.includes(company.text)) target ??= company;
  }

  return companies.map((company) => {
    if (company === acquirer) return { ...company, role: "acquirer" as CompanyRole };
    if (company === target) return { ...company, role: "target" as CompanyRole };
    return company;
  });
}

/* ------------------------------ indications ------------------------------- */

export function extractIndications(input: ExtractInput): Mention[] {
  const haystack = `${input.title}. ${input.body}`;
  const lower = haystack.toLowerCase();
  const found = new Map<string, Mention>();

  for (const entry of INDICATIONS) {
    let offset = -1;
    let confidence: MentionConfidence | undefined;
    let matchedText = "";

    for (const synonym of entry.synonyms) {
      const index = lower.indexOf(synonym.toLowerCase());
      if (index !== -1) {
        offset = index;
        confidence = "dictionary";
        matchedText = synonym;
        break;
      }
    }

    // Abbreviations are case-SENSITIVE and gated on the full form appearing,
    // because "MS", "PD" and "AD" otherwise match constantly.
    if (!confidence && entry.abbrevs) {
      for (const abbrev of entry.abbrevs) {
        const re = new RegExp(`\\b${escapeRegExp(abbrev)}\\b`);
        const match = re.exec(haystack);
        if (!match || match.index === undefined) continue;
        if (entry.requires && !entry.requires.test(haystack)) continue;
        offset = match.index;
        confidence = "contextual";
        matchedText = abbrev;
        break;
      }
    }

    if (!confidence) continue;

    const mention: Mention = {
      text: matchedText,
      canonical: entry.canonical,
      confidence,
      count: countOccurrences(lower, matchedText.toLowerCase()),
      inTitle: input.title.toLowerCase().includes(matchedText.toLowerCase()),
      evidence: [],
    };
    addEvidence(mention, haystack, offset);
    found.set(entry.id, mention);
  }

  return [...found.values()].sort(byPriority).slice(0, 6);
}

/* ------------------------- modalities and targets ------------------------- */

export function extractModalities(input: ExtractInput): Mention[] {
  const haystack = `${input.title}. ${input.body}`;
  const out: Mention[] = [];

  for (const modality of MODALITIES) {
    const re = new RegExp(modality.patterns.source, modality.patterns.flags);
    const matches = [...haystack.matchAll(re)];
    if (matches.length === 0) continue;
    const first = matches[0];
    const mention: Mention = {
      text: first?.[0] ?? modality.label,
      canonical: modality.label,
      confidence: "dictionary",
      count: matches.length,
      inTitle: new RegExp(modality.patterns.source, modality.patterns.flags).test(input.title),
      evidence: [],
    };
    if (first?.index !== undefined) addEvidence(mention, haystack, first.index);
    out.push(mention);
  }

  return out.sort(byPriority).slice(0, 6);
}

const SYMBOL = /\b([A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,4})?)\b/g;

export function extractTargets(input: ExtractInput): Mention[] {
  const haystack = `${input.title}. ${input.body}`;
  const found = new Map<string, Mention>();

  for (const match of haystack.matchAll(SYMBOL)) {
    const symbol = match[0];
    if (!symbol || match.index === undefined) continue;
    if (found.has(symbol)) {
      const existing = found.get(symbol);
      if (existing) existing.count++;
      continue;
    }

    const whitelisted = TARGET_WHITELIST.has(symbol);
    if (!whitelisted) {
      if (TARGET_HOMOGRAPHS.has(symbol)) continue;
      if (CODE_PREFIX_BLOCKLIST.has(symbol)) continue;
      if (symbol.length < 3) continue;
      const context = windowAround(haystack, match.index, symbol.length, 80);
      if (!TARGET_CONTEXT.test(context)) continue;
    }

    const mention: Mention = {
      text: symbol,
      canonical: symbol,
      confidence: whitelisted ? "dictionary" : "contextual",
      count: 1,
      inTitle: input.title.includes(symbol),
      evidence: [],
    };
    addEvidence(mention, haystack, match.index);
    found.set(symbol, mention);
  }

  return [...found.values()].sort(byPriority).slice(0, 6);
}

/* -------------------------------- assembly -------------------------------- */

export function extractEntities(input: ExtractInput, nctIds: string[]): Entities {
  const companies = extractCompanies(input);
  const companyWords = new Set<string>();
  for (const company of companies) {
    for (const word of company.text.toLowerCase().split(/\s+/)) companyWords.add(word);
  }

  return {
    companies: assignCompanyRoles(companies, `${input.title}. ${input.body}`),
    drugs: extractDrugs(input, companyWords),
    indications: extractIndications(input),
    modalities: extractModalities(input),
    targets: extractTargets(input),
    nctIds,
  };
}

/** Mentions safe to show in the UI — `stem-only` is counted but never displayed. */
export function displayable<T extends Mention>(mentions: T[]): T[] {
  return mentions.filter((m) => m.confidence !== "stem-only");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
