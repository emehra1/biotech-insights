import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { DailyDigest, RunStatus, SourceHealth, WeeklyRollup } from "../../lib/types";

/**
 * The repo IS the database. Digests are committed per day, year-sharded because
 * github.com truncates directory listings at 1,000 entries — a flat directory
 * becomes unbrowsable in under three years.
 *
 * The seen store is what makes "first seen" honest: an item that shows up in a
 * second outlet's feed a week later must not look new, or freshness scoring and
 * watchlist alerts both lie.
 */

export const DATA_DIR = "data";
export const DIGEST_DIR = path.join(DATA_DIR, "digests");
export const WEEKLY_DIR = path.join(DATA_DIR, "weekly");
export const STATE_DIR = path.join(DATA_DIR, "state");
export const SEEN_DIR = path.join(STATE_DIR, "seen");

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function digestPath(date: string): string {
  return path.join(DIGEST_DIR, date.slice(0, 4), `${date}.json`);
}

export function weeklyPath(week: string): string {
  return path.join(WEEKLY_DIR, week.slice(0, 4), `${week}.json`);
}

export function readDigest(date: string): DailyDigest | undefined {
  return readJson<DailyDigest>(digestPath(date));
}

export function writeDigest(digest: DailyDigest): string {
  const file = digestPath(digest.date);
  writeJson(file, digest);
  return file;
}

export function writeWeekly(rollup: WeeklyRollup): string {
  const file = weeklyPath(rollup.week);
  writeJson(file, rollup);
  return file;
}

export function readWeekly(week: string): WeeklyRollup | undefined {
  return readJson<WeeklyRollup>(weeklyPath(week));
}

export function listDigestDates(): string[] {
  if (!existsSync(DIGEST_DIR)) return [];
  const dates: string[] = [];
  for (const year of readdirSync(DIGEST_DIR)) {
    const yearDir = path.join(DIGEST_DIR, year);
    let entries: string[];
    try {
      entries = readdirSync(yearDir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (file.endsWith(".json")) dates.push(file.replace(/\.json$/, ""));
    }
  }
  return dates.sort().reverse();
}

export function listWeeks(): string[] {
  if (!existsSync(WEEKLY_DIR)) return [];
  const weeks: string[] = [];
  for (const year of readdirSync(WEEKLY_DIR)) {
    try {
      for (const file of readdirSync(path.join(WEEKLY_DIR, year))) {
        if (file.endsWith(".json")) weeks.push(file.replace(/\.json$/, ""));
      }
    } catch {
      continue;
    }
  }
  return weeks.sort().reverse();
}

/**
 * Ids an earlier digest actually delivered to the reader.
 *
 * Deliberately NOT the seen store, and the difference is load-bearing. `seen`
 * records every id the pipeline has ever laid eyes on — which is most of them:
 * of 526 items fetched on 2026-08-06, 80 were kept and the rest were stamped
 * seen on their way to being dropped by the score gate or a cap. Penalising
 * those as "repeats" would permanently bury everything a productive source could
 * not fit into its 8 slots on the day it first appeared, which is the opposite
 * of the intent — Europe PMC alone offers 60 papers a day for those 8 slots.
 *
 * A week is the horizon: long enough to stop the same paper running three days
 * straight, short enough that something genuinely worth a second look can get
 * one.
 */
export function recentlyDelivered(date: string, days = 7): Set<string> {
  const ids = new Set<string>();
  for (let back = 1; back <= days; back++) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - back);
    const digest = readDigest(day.toISOString().slice(0, 10));
    if (!digest) continue;
    for (const id of Object.keys(digest.items)) ids.add(id);
  }
  return ids;
}

/* --------------------------------- seen ---------------------------------- */

type SeenShard = Record<string, string>;

export class SeenStore {
  private shards = new Map<string, SeenShard>();
  private dirty = new Set<string>();

  private shardKey(date: string): string {
    return date.slice(0, 7);
  }

  private load(shardKey: string): SeenShard {
    const cached = this.shards.get(shardKey);
    if (cached) return cached;
    const shard = readJson<SeenShard>(path.join(SEEN_DIR, `${shardKey}.json`)) ?? {};
    this.shards.set(shardKey, shard);
    return shard;
  }

  /** Returns the date this id was first seen, recording today if it's new. */
  firstSeen(id: string, today: string): { date: string; isNew: boolean } {
    // Check this month and the previous two, which covers any realistic window.
    const candidates = [0, 1, 2].map((back) => shiftMonth(today, -back));
    for (const shardKey of candidates) {
      const shard = this.load(shardKey);
      const existing = shard[id];
      if (existing) return { date: existing, isNew: false };
    }
    const shardKey = this.shardKey(today);
    const shard = this.load(shardKey);
    shard[id] = today;
    this.dirty.add(shardKey);
    return { date: today, isNew: true };
  }

  flush(): void {
    for (const shardKey of this.dirty) {
      const shard = this.shards.get(shardKey);
      if (!shard) continue;
      const sorted: SeenShard = {};
      for (const key of Object.keys(shard).sort()) {
        const value = shard[key];
        if (value) sorted[key] = value;
      }
      writeJson(path.join(SEEN_DIR, `${shardKey}.json`), sorted);
    }
    this.dirty.clear();
  }
}

function shiftMonth(date: string, delta: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------ source health ----------------------------- */

export interface SourceHistory {
  lastSuccessAt?: string;
  consecutiveFailures: number;
  recentCounts: number[];
}

export type SourceHistoryStore = Record<string, SourceHistory>;

const SOURCE_HISTORY_FILE = path.join(STATE_DIR, "sources.json");

export function readSourceHistory(): SourceHistoryStore {
  return readJson<SourceHistoryStore>(SOURCE_HISTORY_FILE) ?? {};
}

export function writeSourceHistory(health: SourceHealth[], previous: SourceHistoryStore): void {
  const next: SourceHistoryStore = { ...previous };
  for (const entry of health) {
    const history = next[entry.sourceId] ?? { consecutiveFailures: 0, recentCounts: [] };
    const failed = entry.status === "failed";
    next[entry.sourceId] = {
      lastSuccessAt: failed ? history.lastSuccessAt : entry.lastSuccessAt ?? history.lastSuccessAt,
      consecutiveFailures: failed ? history.consecutiveFailures + 1 : 0,
      recentCounts: [...history.recentCounts, entry.itemsKept].slice(-30),
    };
  }
  writeJson(SOURCE_HISTORY_FILE, next);
}

/** Trailing median item count per source — catches silent volume collapse. */
export function trailingMedians(history: SourceHistoryStore): Record<string, number> {
  const medians: Record<string, number> = {};
  for (const [sourceId, entry] of Object.entries(history)) {
    if (entry.recentCounts.length < 3) continue;
    const sorted = [...entry.recentCounts].sort((a, b) => a - b);
    medians[sourceId] = sorted[Math.floor(sorted.length / 2)] ?? 0;
  }
  return medians;
}

export function toHealthMap(health: SourceHealth[]): Record<string, SourceHealth> {
  const map: Record<string, SourceHealth> = {};
  for (const entry of health) map[entry.sourceId] = entry;
  return map;
}

export function healthFromHistory(history: SourceHistoryStore): Record<string, SourceHealth> {
  const map: Record<string, SourceHealth> = {};
  for (const [sourceId, entry] of Object.entries(history)) {
    map[sourceId] = {
      sourceId,
      sourceName: sourceId,
      status: "ok",
      itemsParsed: 0,
      itemsKept: 0,
      parseWarnings: [],
      latencyMs: 0,
      lastSuccessAt: entry.lastSuccessAt,
      consecutiveFailures: entry.consecutiveFailures,
    };
  }
  return map;
}

/* -------------------------------- last run -------------------------------- */

const LAST_RUN_FILE = path.join(STATE_DIR, "last-run.json");

export function writeRunStatus(status: RunStatus): void {
  writeJson(LAST_RUN_FILE, status);
}

export function readRunStatus(): RunStatus | undefined {
  return readJson<RunStatus>(LAST_RUN_FILE);
}

/* ----------------------------- unknown entities --------------------------- */

const UNKNOWN_FILE = path.join(DATA_DIR, "unknown-entities.json");

/**
 * Capitalized phrases that look corporate but aren't in the dictionary, ranked
 * by frequency. Five minutes a week promoting entries from here is the
 * maintenance cost of choosing keyword extraction over a model.
 */
export function writeUnknownEntities(counts: Map<string, number>): void {
  const top = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
    .map(([term, count]) => ({ term, count }));
  writeJson(UNKNOWN_FILE, { generatedAt: new Date().toISOString(), candidates: top });
}
