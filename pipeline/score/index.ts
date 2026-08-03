import { createHash } from "node:crypto";

import {
  EVENT_LABELS,
  FOCUS_LANES,
  LANE_LABELS,
  type EventType,
  type FocusLane,
  type KeyFacts,
  type ScoreBreakdown,
  type ScoreFactor,
} from "../../lib/types";
import { LANE_LEXICONS } from "../config/lanes";
import weightsConfig from "../config/weights.json";
import { ageHours } from "../normalize/dates";
import { isNonMammalianModel } from "../extract/facts";
import type { NormalizedItem } from "../ingest/types";

/**
 * Explainable scoring. Every term is retained as a ScoreFactor so the UI can
 * answer "why is this ranked here?" — with no model in the loop, that
 * transparency is the trust mechanism, and it's how you spot a bad weight.
 */

export type Weights = typeof weightsConfig;

export const WEIGHTS: Weights = weightsConfig;

export const WEIGHTS_VERSION = (() => {
  const hash = createHash("sha256").update(JSON.stringify(weightsConfig)).digest("hex").slice(0, 8);
  return `${weightsConfig.version}+${hash}`;
})();

export interface ScoreInput {
  item: NormalizedItem;
  facts: KeyFacts;
  events: EventType[];
  publisherCount: number;
  watchHits: { entryId: string; label: string; priority: boolean }[];
  now: Date;
  weights?: Weights;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  lanes: Partial<Record<FocusLane, number>>;
  primaryLane: FocusLane;
}

interface LaneMatch {
  score: number;
  matched: string[];
}

/**
 * Saturating lexicon score.
 *
 * `1 + ln(count)` gives diminishing returns per term so one repeated word can't
 * dominate; `x / (x + K)` squashes the total into 0..1 without a hard cap, so a
 * genuinely on-topic twelve-signal article still outranks a six-signal one.
 * Raw hit counting (the old behavior) did neither, which is why every item
 * landed in every category.
 */
export function laneScore(lane: FocusLane, title: string, body: string, weights: Weights): LaneMatch {
  const titleLower = title.toLowerCase();
  // Length-normalize by only scoring the head of the body.
  const bodyLower = body.slice(0, 1200).toLowerCase();
  const matched: string[] = [];
  let raw = 0;

  for (const { term, weight } of LANE_LEXICONS[lane]) {
    const inTitle = countTerm(titleLower, term);
    const inBody = countTerm(bodyLower, term);
    const count = inTitle + inBody;
    if (count === 0) continue;
    const fieldMultiplier = inTitle > 0 ? 2 : 1;
    raw += weight * fieldMultiplier * (1 + Math.log(count));
    matched.push(term);
  }

  const k = weights.lexiconSaturationK;
  return { score: raw / (raw + k), matched: matched.slice(0, 8) };
}

function countTerm(haystack: string, term: string): number {
  if (!haystack || !term) return 0;
  let count = 0;
  let index = haystack.indexOf(term);
  while (index !== -1) {
    const before = index === 0 ? " " : haystack[index - 1] ?? " ";
    const after = haystack[index + term.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) count++;
    index = haystack.indexOf(term, index + term.length);
  }
  return count;
}

export function scoreItem(input: ScoreInput): ScoreResult {
  const weights = input.weights ?? WEIGHTS;
  const { item, facts, events } = input;
  const text = item.bodyText;

  const factors: ScoreFactor[] = [];
  const penalties: ScoreFactor[] = [];

  /* lanes */
  const laneScores = {} as Record<FocusLane, number>;
  const laneMatches = {} as Record<FocusLane, string[]>;
  for (const lane of FOCUS_LANES) {
    const result = laneScore(lane, item.title, text, weights);
    // The source's own prior nudges, but never decides, the lane.
    const hint = item.laneHints[lane] ?? 0;
    laneScores[lane] = Math.min(1, result.score + hint * 0.25);
    laneMatches[lane] = result.matched;
  }

  const ranked = [...FOCUS_LANES].sort((a, b) => (laneScores[b] ?? 0) - (laneScores[a] ?? 0));
  const primaryLane = ranked[0] ?? "frontier-science";
  const primaryScore = laneScores[primaryLane] ?? 0;

  factors.push({
    key: `lane.${primaryLane}`,
    label: LANE_LABELS[primaryLane],
    raw: primaryScore,
    weight: weights.weights.lexicon,
    contribution: primaryScore * weights.weights.lexicon,
    evidence: laneMatches[primaryLane],
  });

  const secondarySpread = Math.min(
    0.3,
    ranked.slice(1).reduce((sum, lane) => sum + (laneScores[lane] ?? 0), 0),
  );
  if (secondarySpread > 0.02) {
    factors.push({
      key: "laneSpread",
      label: "Cross-topic relevance",
      raw: secondarySpread,
      weight: weights.weights.laneSpread,
      contribution: secondarySpread * weights.weights.laneSpread,
    });
  }

  /* authority */
  factors.push({
    key: "authority",
    label: `Source: ${item.sourceName}`,
    raw: item.authority,
    weight: weights.weights.authority,
    contribution: item.authority * weights.weights.authority,
  });

  /* recency — exponential half-life per lane keeps a big story alive into day
     two and buries day-three filler, which linear decay gets backwards. */
  const halfLife = weights.recencyHalfLifeHours[primaryLane];
  let recency = 0;
  if (item.publishedAt) {
    const hours = ageHours(item.publishedAt, input.now);
    recency = 2 ** (-hours / halfLife);
    factors.push({
      key: "recency",
      label: hours < 24 ? "Published today" : `${Math.round(hours / 24)}d old`,
      raw: recency,
      weight: weights.weights.recency,
      contribution: recency * weights.weights.recency,
    });
  } else {
    penalties.push({
      key: "dateMissing",
      label: "No publication date",
      raw: 1,
      weight: weights.penalties.dateMissing,
      contribution: -weights.penalties.dateMissing,
    });
  }

  /* events */
  let bestEvent: { type: EventType; boost: number } | undefined;
  for (const event of events) {
    const boost = weights.eventBoosts[event as keyof typeof weights.eventBoosts] ?? 0;
    if (!bestEvent || boost > bestEvent.boost) bestEvent = { type: event, boost };
  }
  if (bestEvent && bestEvent.boost > 0) {
    factors.push({
      key: `event.${bestEvent.type}`,
      label: EVENT_LABELS[bestEvent.type],
      raw: bestEvent.boost,
      weight: weights.weights.event,
      contribution: bestEvent.boost * weights.weights.event,
      evidence: outcomeEvidence(facts),
    });
  }

  /* corroboration */
  if (input.publisherCount > 1) {
    const corroboration = Math.min(1, Math.log2(input.publisherCount) / Math.log2(5));
    factors.push({
      key: "corroboration",
      label: `Covered by ${input.publisherCount} outlets`,
      raw: corroboration,
      weight: weights.weights.corroboration,
      contribution: corroboration * weights.weights.corroboration,
    });
  }

  /* watchlist */
  if (input.watchHits.length > 0) {
    const raw = Math.min(1, 0.6 + 0.2 * input.watchHits.length);
    factors.push({
      key: "watchlist",
      label: `Watchlist: ${input.watchHits.map((h) => h.label).join(", ")}`,
      raw,
      weight: weights.weights.watchlist,
      contribution: raw * weights.weights.watchlist,
      evidence: input.watchHits.map((h) => h.entryId),
    });
  }

  /* fact density — a headline with a number in it is usually the useful one */
  const density =
    [
      facts.results.length > 0,
      facts.nct.length > 0,
      facts.deal !== undefined,
      facts.phase !== undefined,
      facts.enrollment !== undefined,
    ].filter(Boolean).length / 3;
  const factDensity = Math.min(1, density);
  if (factDensity > 0) {
    factors.push({
      key: "factDensity",
      label: "Contains hard numbers",
      raw: factDensity,
      weight: weights.weights.factDensity,
      contribution: factDensity * weights.weights.factDensity,
    });
  }

  /* penalties */
  if (item.bodyText.length < 200) {
    penalties.push({
      key: "thinContent",
      label: "Thin source text",
      raw: 1,
      weight: weights.penalties.thinContent,
      contribution: -weights.penalties.thinContent,
    });
  }
  if (events.includes("opinion")) {
    penalties.push({
      key: "opinionRoundup",
      label: "Opinion or roundup",
      raw: 1,
      weight: weights.penalties.opinionRoundup,
      contribution: -weights.penalties.opinionRoundup,
    });
  }
  // Translational distance, applied in every lane. Honest science, but a
  // honeybee or worm study is several steps further out than a mouse study, and
  // a review restates work you have probably already seen.
  if (isNonMammalianModel(`${item.title}. ${text}`)) {
    penalties.push({
      key: "nonMammalianModel",
      label: "Non-mammalian model system",
      raw: 1,
      weight: weights.penalties.nonMammalianModel,
      contribution: -weights.penalties.nonMammalianModel,
    });
  }
  if (facts.evidenceLevel === "review") {
    penalties.push({
      key: "reviewArticle",
      label: "Review, not primary research",
      raw: 1,
      weight: weights.penalties.reviewArticle,
      contribution: -weights.penalties.reviewArticle,
    });
  }
  if (facts.evidenceLevel === "in-vitro") {
    penalties.push({
      key: "inVitroOnly",
      label: "In-vitro only",
      raw: 1,
      weight: weights.penalties.inVitroOnly,
      contribution: -weights.penalties.inVitroOnly,
    });
  }
  if (
    primaryLane === "clinical-regulatory" &&
    (facts.evidenceLevel === "preclinical" || facts.evidenceLevel === "in-vitro")
  ) {
    // The cheapest fix for "why is a mouse study in my clinical feed".
    penalties.push({
      key: "preclinicalInClinicalLane",
      label: `${facts.evidenceLevel} evidence in a clinical lane`,
      raw: 1,
      weight: weights.penalties.preclinicalInClinicalLane,
      contribution: -weights.penalties.preclinicalInClinicalLane,
    });
  }

  const total = clamp(
    factors.reduce((sum, f) => sum + f.contribution, 0) +
      penalties.reduce((sum, p) => sum + p.contribution, 0),
    0,
    100,
  );

  return {
    score: Math.round(total * 10) / 10,
    lanes: laneScores,
    primaryLane,
    breakdown: {
      total: Math.round(total * 10) / 10,
      factors: factors.sort((a, b) => b.contribution - a.contribution),
      penalties,
      laneScores,
      weightsVersion: WEIGHTS_VERSION,
    },
  };
}

function outcomeEvidence(facts: KeyFacts): string[] | undefined {
  if (!facts.outcome) return undefined;
  const first = facts.results[0]?.verbatim ?? facts.regulatory[0]?.verbatim;
  return first ? [first] : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Age cutoff per lane, so a preprint gets a longer shelf life than a readout. */
export function isTooOld(
  publishedAt: Date | undefined,
  lane: FocusLane,
  now: Date,
  weights: Weights = WEIGHTS,
): boolean {
  if (!publishedAt) return false;
  const maxDays = weights.maxAgeDays[lane];
  return ageHours(publishedAt, now) / 24 > maxDays;
}
