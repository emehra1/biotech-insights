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
  // Only make the request conditional when we can actually serve a 304: a
  // runner that restored the committed ETags but not the gitignored bodies
  // would otherwise get a valid "not modified" and contribute nothing.
  const canReplay = await cache.hasRaw(source.id);
  const meta = source.conditionalGet && canReplay ? cache.get(source.id) : undefined;

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

  // Diagnose the response before parsing it. A WAF that answers a datacenter IP
  // with a 200 and an interstitial page produces "Attribute without value,
  // Line: 13" from the XML parser — HTML boolean attributes like `<script
  // async>` are illegal in XML. That error is useless for deciding what to do;
  // "received HTML, not XML" tells you it is a block, not a parser bug.
  if (source.dialect !== "json") {
    const shape = describeNonXml(body);
    if (shape) {
      return {
        items: [],
        health: {
          ...baseHealth,
          status: "failed",
          error: `expected XML, ${shape}`,
          consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
        },
      };
    }
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

/**
 * Returns a human description when the body is NOT parseable XML, or undefined
 * when it looks fine. Kept to a single line so it survives a markdown table.
 */
function describeNonXml(body: string): string | undefined {
  const head = body.slice(0, 400).trim();
  if (!head) return "got an empty response";

  const lower = head.toLowerCase();
  if (lower.startsWith("<!doctype html") || lower.startsWith("<html") || lower.includes("<head>")) {
    const title = /<title[^>]*>([^<]{0,80})/i.exec(head)?.[1]?.trim();
    return `got HTML${title ? ` titled "${title}"` : ""} — likely a bot challenge or consent page`;
  }
  if (lower.startsWith("{") || lower.startsWith("[")) return "got JSON";
  if (!head.startsWith("<")) {
    return `got non-markup starting ${JSON.stringify(head.slice(0, 40))}`;
  }
  return undefined;
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
