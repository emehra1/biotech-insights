import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { DailyDigest, RunStatus, WeeklyRollup } from "../types";

/**
 * Build-time data access. Server components only — the committed JSON under
 * data/ is the database, and the browser never sees these functions.
 *
 * Memoized per process because `generateStaticParams` plus a page render per
 * date would otherwise re-read the same files hundreds of times in one build.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DIGEST_DIR = path.join(DATA_DIR, "digests");
const WEEKLY_DIR = path.join(DATA_DIR, "weekly");

const cache = new Map<string, unknown>();

function readJson<T>(file: string): T | undefined {
  const hit = cache.get(file);
  if (hit !== undefined) return hit as T;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as T;
    cache.set(file, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function listShardedIds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const ids: string[] = [];
  for (const year of readdirSync(dir)) {
    try {
      for (const file of readdirSync(path.join(dir, year))) {
        if (file.endsWith(".json")) ids.push(file.replace(/\.json$/, ""));
      }
    } catch {
      continue;
    }
  }
  return ids.sort().reverse();
}

export function listDigestDates(): string[] {
  return listShardedIds(DIGEST_DIR);
}

export function listWeeks(): string[] {
  return listShardedIds(WEEKLY_DIR);
}

export function readDigest(date: string): DailyDigest | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return readJson<DailyDigest>(path.join(DIGEST_DIR, date.slice(0, 4), `${date}.json`));
}

export function readWeekly(week: string): WeeklyRollup | undefined {
  if (!/^\d{4}-W\d{2}$/.test(week)) return undefined;
  return readJson<WeeklyRollup>(path.join(WEEKLY_DIR, week.slice(0, 4), `${week}.json`));
}

export function latestDigest(): DailyDigest | undefined {
  const [latest] = listDigestDates();
  return latest ? readDigest(latest) : undefined;
}

export function latestWeekly(): WeeklyRollup | undefined {
  const [latest] = listWeeks();
  return latest ? readWeekly(latest) : undefined;
}

export function readRunStatus(): RunStatus | undefined {
  return readJson<RunStatus>(path.join(DATA_DIR, "state", "last-run.json"));
}

export function readWatchlistYaml(): string | undefined {
  try {
    return readFileSync(path.join(process.cwd(), "config", "watchlist.yml"), "utf8");
  } catch {
    return undefined;
  }
}

/** Sorted item list for a digest, highest score first. */
export function digestItems(digest: DailyDigest) {
  return Object.values(digest.items).sort((a, b) => b.score - a.score);
}

/** Cross-outlet coverage for an item's cluster, excluding the item itself. */
export function clusterSiblings(digest: DailyDigest, itemId: string) {
  const item = digest.items[itemId];
  if (!item) return [];
  const cluster = digest.clusters.find((c) => c.id === item.clusterId);
  if (!cluster) return [];
  return cluster.memberIds
    .filter((id) => id !== itemId)
    .map((id) => digest.items[id])
    .filter((sibling): sibling is NonNullable<typeof sibling> => Boolean(sibling));
}
