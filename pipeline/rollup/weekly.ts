import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { DailyDigest, WeeklyRollup, WeeklyTheme } from "../../lib/types";
import { isoWeek, isoWeekStart } from "../normalize/dates";
import { tokenize } from "../normalize/text";
import { readDigest, DATA_DIR } from "../state/store";

/**
 * Weekly synthesis by aggregation only — no model, so no invented narrative.
 *
 * Themes come from term-frequency lift against a trailing baseline: a term is a
 * theme when it is both unusually frequent AND appears in enough documents.
 * Lift alone surfaces noise; volume alone surfaces "patients" every week.
 *
 * The first few weeks have no baseline, so we say so (`warming-up`) and show
 * only the deterministic tallies rather than pretending to detect trends.
 */

const BASELINE_FILE = path.join(DATA_DIR, "state", "term-baseline.json");

interface Baseline {
  weeksObserved: number;
  /** Exponentially weighted document frequency per term. */
  ewma: Record<string, number>;
}

const STOP_TERMS = new Set([
  "patients", "study", "trial", "data", "results", "treatment", "disease",
  "company", "new", "research", "cells", "cell", "human", "clinical", "drug",
  "therapy", "analysis", "using", "high", "low", "showed", "found", "may",
  "also", "however", "based", "associated", "significant", "expression",
]);

function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
  } catch {
    return { weeksObserved: 0, ewma: {} };
  }
}

function writeBaseline(baseline: Baseline): void {
  mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

function datesInWeek(reference: Date): string[] {
  const start = isoWeekStart(reference);
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  });
}

export interface BuildWeeklyOptions {
  reference: Date;
  updateBaseline?: boolean;
}

export function buildWeekly(options: BuildWeeklyOptions): WeeklyRollup | undefined {
  const week = isoWeek(options.reference);
  const days = datesInWeek(options.reference);
  const digests = days
    .map((date) => readDigest(date))
    .filter((digest): digest is DailyDigest => Boolean(digest));

  if (digests.length === 0) return undefined;

  const items = digests.flatMap((digest) => Object.values(digest.items));
  const total = Math.max(1, items.length);

  /* ------------------------------ tallies ------------------------------- */
  const approvals: WeeklyRollup["tallies"]["approvals"] = [];
  const crls: WeeklyRollup["tallies"]["crls"] = [];
  const readouts = { met: [] as string[], missed: [] as string[], mixed: [] as string[] };
  let maCount = 0;
  let maTotal = 0;
  let maLargest: { itemId: string; usdM: number } | undefined;
  let financingCount = 0;
  let financingTotal = 0;
  const financingByRound: Record<string, number> = {};
  const newPhase3: WeeklyRollup["tallies"]["newPhase3"] = [];

  for (const item of items) {
    if (item.eventTypes.includes("approval")) approvals.push({ itemId: item.id, title: item.title });
    if (item.eventTypes.includes("crl")) crls.push({ itemId: item.id, title: item.title });

    if (item.keyFacts.outcome === "met") readouts.met.push(item.id);
    else if (item.keyFacts.outcome === "missed") readouts.missed.push(item.id);
    else if (item.keyFacts.outcome === "mixed") readouts.mixed.push(item.id);

    const deal = item.keyFacts.deal;
    if (deal?.type === "M&A") {
      maCount++;
      const size = deal.totalUsdM ?? deal.upfrontUsdM ?? 0;
      maTotal += size;
      if (!maLargest || size > maLargest.usdM) maLargest = { itemId: item.id, usdM: size };
    }
    if (deal?.type === "financing" || deal?.type === "IPO") {
      financingCount++;
      financingTotal += deal.totalUsdM ?? deal.upfrontUsdM ?? 0;
      const round = deal.round ?? deal.type;
      financingByRound[round] = (financingByRound[round] ?? 0) + 1;
    }

    if (item.sourceId === "clinicaltrials" && item.keyFacts.nct[0]) {
      newPhase3.push({
        nct: item.keyFacts.nct[0],
        title: item.title,
        sponsor: item.keyFacts.companies[0]?.name,
      });
    }
  }

  /* ------------------------------- themes -------------------------------- */
  const documentFrequency = new Map<string, number>();
  const termItems = new Map<string, Set<string>>();

  for (const item of items) {
    const terms = new Set<string>();
    for (const drug of item.entities.drugs) {
      if (drug.confidence !== "stem-only") terms.add(drug.canonical);
    }
    for (const company of item.entities.companies) terms.add(company.canonical.toLowerCase());
    for (const indication of item.entities.indications) terms.add(indication.canonical.toLowerCase());
    for (const modality of item.entities.modalities) terms.add(modality.canonical.toLowerCase());
    for (const target of item.entities.targets) terms.add(target.canonical.toLowerCase());
    for (const token of tokenize(item.title)) {
      if (token.length > 4 && !STOP_TERMS.has(token)) terms.add(token);
    }

    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      const bucket = termItems.get(term) ?? new Set<string>();
      bucket.add(item.id);
      termItems.set(term, bucket);
    }
  }

  const baseline = readBaseline();
  const smoothing = 3 / total;
  const candidates: WeeklyTheme[] = [];

  for (const [term, docs] of documentFrequency) {
    if (docs < 3) continue;
    const thisWeek = docs / total;
    const priorWeeks = baseline.ewma[term] ?? 0;
    const lift = (thisWeek + smoothing) / (priorWeeks + smoothing);
    if (lift < 1.8) continue;
    candidates.push({
      label: term,
      terms: [term],
      docCount: docs,
      lift: Math.round(lift * 100) / 100,
      // Needs BOTH surprise and volume, or one-off jargon wins.
      score: Math.round(Math.log2(lift) * Math.sqrt(docs) * 100) / 100,
      itemIds: [...(termItems.get(term) ?? [])].slice(0, 8),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const themes = mergeCoOccurring(candidates, termItems).slice(0, 8);

  /* ----------------------------- baseline update -------------------------- */
  if (options.updateBaseline !== false) {
    const alpha = 0.25;
    const nextEwma: Record<string, number> = { ...baseline.ewma };
    for (const [term, docs] of documentFrequency) {
      const observed = docs / total;
      nextEwma[term] = alpha * observed + (1 - alpha) * (nextEwma[term] ?? 0);
    }
    // Compare a week to history, never to itself: update AFTER computing lift.
    writeBaseline({ weeksObserved: baseline.weeksObserved + 1, ewma: nextEwma });
  }

  const degradedSources = [
    ...new Set(
      digests.flatMap((digest) =>
        digest.health
          .filter((entry) => entry.status === "degraded" || entry.status === "failed")
          .map((entry) => entry.sourceName),
      ),
    ),
  ];

  const topClusters = digests
    .flatMap((digest) => digest.clusters)
    .filter((cluster) => cluster.publisherCount > 1)
    .sort((a, b) => b.publisherCount - a.publisherCount)
    .slice(0, 5)
    .map((cluster) => ({
      clusterId: cluster.id,
      leadItemId: cluster.leadId,
      publisherCount: cluster.publisherCount,
    }));

  const preprintShift = [...documentFrequency.entries()]
    .filter(([term]) => (baseline.ewma[term] ?? 0) > 0)
    .map(([term, docs]) => ({
      term,
      delta: Math.round((docs / total - (baseline.ewma[term] ?? 0)) * 1000) / 10,
    }))
    .filter((entry) => Math.abs(entry.delta) > 1)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);

  const start = isoWeekStart(options.reference);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return {
    schemaVersion: 2,
    week,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    themes: {
      status: baseline.weeksObserved >= 3 ? "ok" : "warming-up",
      weeksObserved: baseline.weeksObserved,
      items: baseline.weeksObserved >= 3 ? themes : [],
    },
    tallies: {
      approvals,
      crls,
      readouts,
      ma: { count: maCount, totalUsdM: Math.round(maTotal), largest: maLargest },
      financings: {
        count: financingCount,
        totalUsdM: Math.round(financingTotal),
        byRound: financingByRound,
      },
      newPhase3: newPhase3.slice(0, 12),
    },
    topClusters,
    preprintShift,
    degradedSources,
    lexiconSuggestions: candidates
      .filter((theme) => /^[a-z][a-z-]{4,}$/.test(theme.label))
      .slice(0, 10)
      .map((theme) => theme.label),
  };
}

/** Fold terms that travel together ("obesity"/"tirzepatide") into one theme. */
function mergeCoOccurring(
  candidates: WeeklyTheme[],
  termItems: Map<string, Set<string>>,
): WeeklyTheme[] {
  const merged: WeeklyTheme[] = [];
  const used = new Set<string>();

  for (const candidate of candidates) {
    if (used.has(candidate.label)) continue;
    const group = { ...candidate, terms: [candidate.label] };
    const base = termItems.get(candidate.label) ?? new Set<string>();

    for (const other of candidates) {
      if (other === candidate || used.has(other.label)) continue;
      const compare = termItems.get(other.label) ?? new Set<string>();
      const shared = [...base].filter((id) => compare.has(id)).length;
      const overlap = shared / Math.max(1, Math.min(base.size, compare.size));
      if (overlap > 0.6) {
        group.terms.push(other.label);
        used.add(other.label);
      }
    }

    used.add(candidate.label);
    merged.push(group);
  }

  return merged;
}

export function weeklyExists(week: string): boolean {
  return existsSync(path.join(DATA_DIR, "weekly", week.slice(0, 4), `${week}.json`));
}
