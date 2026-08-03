import type { BodyProvenance, DigestSource, Entities, FocusLane } from "../../lib/types";
import { LANE_LEXICONS } from "../config/lanes";
import { isBoilerplateLine } from "../normalize/html";
import { splitSentences, wordCount } from "../normalize/sentences";
import { jaccard, tokenize, truncateWords } from "../normalize/text";

/**
 * Extractive summarization. No model, so no invented prose: we select sentences
 * that already exist, in the order they already appear.
 *
 * Two rules are non-negotiable for readability:
 *  1. Selected sentences are re-sorted into document order. Ranked order reads
 *     like three scrambled fragments.
 *  2. A sentence whose opening pronoun refers to an unselected predecessor is
 *     either repaired or dropped. "It missed the endpoint" with no antecedent is
 *     worse than saying nothing.
 *
 * And when the source only gave us a 200-character dek — which is most news
 * feeds here — we return the dek verbatim rather than pretending to summarize.
 */

export interface SummarizeInput {
  title: string;
  body: string;
  provenance: BodyProvenance;
  lane: FocusLane;
  entities: Entities;
  maxSentences?: number;
  maxChars?: number;
}

export interface SummarizeResult {
  digest: string[];
  source: DigestSource;
}

const RESULT_BEARING =
  /(\d+(\.\d+)?\s?%|\bp\s?[<=>]\s?0?\.\d+|\bHR\b\s?[=:]?\s?\d|\bn\s?=\s?[\d,]+|[$€£]\s?\d|\b\d+(\.\d+)?\s?(months?|weeks?|years?)\b)/i;

const OUTCOME_LANGUAGE =
  /\b(met|missed|failed to|did not meet|achieved|approved|rejected|discontinued|halted)\b/i;

const QUOTE_FLUFF = /^["“']|\b(said|told|added|noted|commented)\b/i;

const LEADING_PRONOUN =
  /^(It|They|This|That|These|Those|He|She|The company|The firm|The drug|The trial|The study|Such)\b/;

/** Structured abstracts label their sections; Results + Conclusions IS the summary. */
const STRUCTURED_SECTION =
  /\b(Background|Objectives?|Methods?|Results?|Findings?|Conclusions?|Interpretation|Discussion)\s*:/gi;

export function summarize(input: SummarizeInput): SummarizeResult {
  const maxSentences = input.maxSentences ?? 3;
  const maxChars = input.maxChars ?? 480;
  const body = input.body.trim();

  // A labelled abstract is checked first, regardless of length: its
  // Results/Conclusions sections are a better summary than anything a sentence
  // scorer produces, and short structured abstracts are common.
  if (input.provenance === "abstract" || input.provenance === "api") {
    const structured = extractStructuredSections(body, maxChars);
    if (structured.length > 0) return { digest: structured, source: "abstract" };
  }

  // Otherwise a dek is a dek. Return it whole and label it honestly.
  if (input.provenance === "dek" || input.provenance === "none" || body.length < 320) {
    return { digest: body ? [truncateWords(body, maxChars)] : [], source: "dek" };
  }

  const sentences = splitSentences(body).filter(
    (sentence) => !isBoilerplateLine(sentence) && wordCount(sentence) >= 6 && wordCount(sentence) <= 60,
  );
  if (sentences.length === 0) {
    return { digest: [truncateWords(body, maxChars)], source: "dek" };
  }
  if (sentences.length <= maxSentences) {
    return { digest: sentences.map((s) => truncateWords(s, maxChars)), source: "extractive" };
  }

  const laneTerms = new Set(LANE_LEXICONS[input.lane].map((t) => t.term));
  const entityStrings = collectEntityStrings(input.entities);
  const titleTokens = new Set(tokenize(input.title));

  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    tokens: new Set(tokenize(sentence)),
    score: scoreSentence(sentence, index, { laneTerms, entityStrings, titleTokens }),
  }));

  // Greedy MMR: relevance minus redundancy against what's already picked.
  const selected: typeof scored = [];
  let usedChars = 0;
  while (selected.length < maxSentences) {
    let best: (typeof scored)[number] | undefined;
    let bestValue = -Infinity;

    for (const candidate of scored) {
      if (selected.includes(candidate)) continue;
      if (usedChars + candidate.sentence.length > maxChars && selected.length > 0) continue;
      const redundancy = selected.reduce(
        (max, chosen) => Math.max(max, jaccard(candidate.tokens, chosen.tokens)),
        0,
      );
      const value = candidate.score - 0.15 * redundancy;
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }

    if (!best) break;
    selected.push(best);
    usedChars += best.sentence.length;
  }

  // Document order, always.
  selected.sort((a, b) => a.index - b.index);

  const selectedIndices = new Set(selected.map((s) => s.index));
  const digest: string[] = [];
  for (const entry of selected) {
    const repaired = repairPronoun(entry.sentence, entry.index, selectedIndices, input);
    if (repaired) digest.push(repaired);
  }

  if (digest.length === 0) {
    return { digest: [truncateWords(sentences[0] ?? body, maxChars)], source: "extractive" };
  }

  return { digest, source: "extractive" };
}

function scoreSentence(
  sentence: string,
  index: number,
  context: { laneTerms: Set<string>; entityStrings: string[]; titleTokens: Set<string> },
): number {
  const lower = sentence.toLowerCase();

  const leadBias = 1 / (1 + 0.35 * index);
  const entityHits = context.entityStrings.filter((entity) => lower.includes(entity)).length;
  const laneHits = [...context.laneTerms].filter((term) => lower.includes(term)).length;
  const titleOverlap = jaccard(new Set(tokenize(sentence)), context.titleTokens);

  let score =
    0.3 * leadBias +
    0.25 * Math.min(1, entityHits / 3) +
    0.25 * (RESULT_BEARING.test(sentence) ? 1 : 0) +
    0.15 * (OUTCOME_LANGUAGE.test(sentence) ? 1 : 0) +
    0.15 * Math.min(1, laneHits / 4) +
    0.05 * titleOverlap;

  if (QUOTE_FLUFF.test(sentence) && !RESULT_BEARING.test(sentence)) score -= 0.2;

  return score;
}

/**
 * A selected sentence starting with a pronoun needs its antecedent. If the
 * previous sentence wasn't selected, substitute the dominant entity when it's
 * unambiguous, otherwise drop the sentence.
 */
function repairPronoun(
  sentence: string,
  index: number,
  selected: Set<number>,
  input: SummarizeInput,
): string | undefined {
  if (index === 0 || selected.has(index - 1)) return sentence;
  const match = LEADING_PRONOUN.exec(sentence);
  if (!match) return sentence;

  const subject =
    input.entities.companies[0]?.canonical ??
    input.entities.drugs.find((d) => d.confidence !== "stem-only")?.text;
  if (!subject) return undefined;

  return `${subject}${sentence.slice(match[0].length)}`;
}

function extractStructuredSections(body: string, maxChars: number): string[] {
  const matches = [...body.matchAll(STRUCTURED_SECTION)];
  if (matches.length < 2) return [];

  const sections = new Map<string, string>();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const next = matches[i + 1];
    if (!match || match.index === undefined) continue;
    const label = (match[1] ?? "").toLowerCase();
    const start = match.index + match[0].length;
    const end = next?.index ?? body.length;
    sections.set(label, body.slice(start, end).trim());
  }

  const wanted = ["results", "result", "findings", "conclusions", "conclusion", "interpretation"];
  const picked: string[] = [];
  for (const key of wanted) {
    const value = sections.get(key);
    if (value && value.length > 30) picked.push(truncateWords(value, Math.floor(maxChars / 2)));
    if (picked.length === 2) break;
  }

  return picked;
}

function collectEntityStrings(entities: Entities): string[] {
  const out: string[] = [];
  for (const drug of entities.drugs) if (drug.confidence !== "stem-only") out.push(drug.canonical);
  for (const company of entities.companies) out.push(company.text.toLowerCase());
  for (const indication of entities.indications) out.push(indication.canonical.toLowerCase());
  for (const target of entities.targets) out.push(target.canonical.toLowerCase());
  return out;
}
