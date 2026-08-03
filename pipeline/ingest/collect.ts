import type { SourceHealth } from "../../lib/types";
import { resolveEndpoint, type RunWindow, type SourceDef } from "../config/sources";
import type { HttpCache } from "../net/cache";
import type { HttpClient } from "../net/http";
import { parseFeed } from "./feed";
import { parseClinicalTrials, parseEuropePmc } from "./json-apis";
import type { NormalizedItem } from "./types";

/**
 * Fetch + parse every source. One dead feed must never fail the run, so each
 * source is isolated and degrades into a health record instead of throwing.
 */

export interface CollectOptions {
  window: RunWindow;
  now: Date;
  fromCache?: boolean;
  previousHealth?: Record<string, SourceHealth>;
  /** Trailing median item count per source, used to detect silent breakage. */
  trailingMedian?: Record<string, number>;
  log?: (message: string) => void;
}

export interface CollectResult {
  items: NormalizedItem[];
  health: SourceHealth[];
}

export async function collectSources(
  sources: SourceDef[],
  http: HttpClient,
  cache: HttpCache,
  options: CollectOptions,
): Promise<CollectResult> {
  const settled = await Promise.allSettled(
    sources.map((source) => collectOne(source, http, cache, options)),
  );

  const items: NormalizedItem[] = [];
  const health: SourceHealth[] = [];

  settled.forEach((result, index) => {
    const source = sources[index];
    if (!source) return;

    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      health.push(result.value.health);
      return;
    }

    const previous = options.previousHealth?.[source.id];
    health.push({
      sourceId: source.id,
      sourceName: source.name,
      status: "failed",
      error: String(result.reason).slice(0, 300),
      itemsParsed: 0,
      itemsKept: 0,
      parseWarnings: [],
      latencyMs: 0,
      lastSuccessAt: previous?.lastSuccessAt,
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    });
  });

  return { items, health };
}

async function collectOne(
  source: SourceDef,
  http: HttpClient,
  cache: HttpCache,
  options: CollectOptions,
): Promise<{ items: NormalizedItem[]; health: SourceHealth }> {
  const url = resolveEndpoint(source, options.window);
  const previous = options.previousHealth?.[source.id];
  const meta = source.conditionalGet ? cache.get(source.id) : undefined;

  const response = await http(url, {
    cacheKey: source.id,
    etag: meta?.etag,
    lastModified: meta?.lastModified,
    crawlDelayMs: source.crawlDelayMs,
    accept: source.dialect === "json" ? "application/json, */*;q=0.8" : undefined,
    timeoutMs: source.dialect === "json" ? 25_000 : 15_000,
    fromCache: options.fromCache,
  });

  const baseHealth: SourceHealth = {
    sourceId: source.id,
    sourceName: source.name,
    status: "ok",
    httpStatus: response.status,
    itemsParsed: 0,
    itemsKept: 0,
    parseWarnings: [],
    latencyMs: response.timingMs,
    lastSuccessAt: previous?.lastSuccessAt,
    consecutiveFailures: 0,
  };

  // 304: nothing changed. Replay the cached body so the digest still lists the
  // source's recent items rather than dropping it for the day.
  let body = response.body;
  if (response.notModified) {
    body = await cache.readRaw(source.id);
    if (!body) {
      return {
        items: [],
        health: {
          ...baseHealth,
          status: "not-modified",
          lastSuccessAt: new Date().toISOString(),
        },
      };
    }
  }

  if (!body) {
    return {
      items: [],
      health: {
        ...baseHealth,
        status: "failed",
        error: response.error ?? `HTTP ${response.status}`,
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      },
    };
  }

  let parsed;
  try {
    parsed =
      source.dialect === "json"
        ? parseJsonSource(source, body, options.now)
        : await parseFeed(body, source, options.now);
  } catch (error) {
    return {
      items: [],
      health: {
        ...baseHealth,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      },
    };
  }

  const status = assessStatus(source, parsed.items.length, parsed.parsed, options.trailingMedian);

  options.log?.(
    `  ${source.id.padEnd(26)} ${String(response.status).padStart(3)} ` +
      `${String(parsed.items.length).padStart(3)} items ${response.timingMs}ms` +
      (parsed.warnings.length ? `  [${parsed.warnings.join(", ")}]` : ""),
  );

  return {
    items: parsed.items,
    health: {
      ...baseHealth,
      status,
      itemsParsed: parsed.parsed,
      itemsKept: parsed.items.length,
      parseWarnings: parsed.warnings,
      lastSuccessAt: new Date().toISOString(),
    },
  };
}

function parseJsonSource(source: SourceDef, body: string, now: Date) {
  if (source.id.startsWith("europepmc")) return parseEuropePmc(body, source, now);
  if (source.id === "clinicaltrials") return parseClinicalTrials(body, source, now);
  return { items: [], parsed: 0, warnings: [`no json parser for ${source.id}`] };
}

/**
 * HTTP 200 with zero items is "degraded", not "ok". So is a sudden collapse in
 * volume — that check is what would have caught the previous version pointing
 * at Fierce's sponsored feed, where 10 whitepapers a day looks healthy.
 */
function assessStatus(
  source: SourceDef,
  kept: number,
  parsed: number,
  trailingMedian?: Record<string, number>,
): SourceHealth["status"] {
  if (parsed === 0 || kept === 0) return "degraded";
  const median = trailingMedian?.[source.id];
  if (median !== undefined && median >= 5 && kept < median * 0.3) return "degraded";
  return "ok";
}
