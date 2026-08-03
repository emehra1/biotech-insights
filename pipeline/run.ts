import { appendFileSync } from "node:fs";

import type { RunStatus } from "../lib/types";
import { enabledSources } from "./config/sources";
import { buildDigest } from "./digest/build";
import { collectSources } from "./ingest/collect";
import { HttpCache } from "./net/cache";
import { createHttpClient } from "./net/http";
import { isoDay } from "./normalize/dates";
import {
  healthFromHistory,
  readDigest,
  readSourceHistory,
  SeenStore,
  trailingMedians,
  writeDigest,
  writeRunStatus,
  writeSourceHistory,
  writeUnknownEntities,
} from "./state/store";
import { compileWatchlist, loadWatchlistWithPrivate } from "./watchlist";

/**
 * Pipeline entry point.
 *
 * Exit codes matter to the workflow:
 *   0  fine — commit the digest, send the email
 *   2  unusable (most sources down, or nothing kept) — do NOT commit a broken
 *      digest and do NOT email; the site keeps serving yesterday's and shows a
 *      staleness banner
 *   1  crashed
 */

interface Args {
  date?: string;
  dryRun: boolean;
  fromCache: boolean;
  force: boolean;
  only: string[];
  summaryFile?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, fromCache: false, force: false, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--from-cache") args.fromCache = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--date") args.date = argv[++i] || undefined;
    else if (arg.startsWith("--date=")) args.date = arg.slice(7);
    else if (arg === "--only") args.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg.startsWith("--only=")) args.only = arg.slice(7).split(",").filter(Boolean);
    else if (arg === "--summary") args.summaryFile = argv[++i] || undefined;
    else if (arg.startsWith("--summary=")) args.summaryFile = arg.slice(10);
  }
  return args;
}

function emitSummary(file: string | undefined, markdown: string): void {
  if (!file) return;
  try {
    appendFileSync(file, `${markdown}\n`, "utf8");
  } catch {
    /* a missing GITHUB_STEP_SUMMARY must never fail the run */
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const now = startedAt;
  const timeZone = process.env.TZ || "America/New_York";
  const date = args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : isoDay(now, timeZone);

  if (!args.force && !args.dryRun && readDigest(date)) {
    console.log(`Digest for ${date} already exists. Use --force to regenerate.`);
    return 0;
  }

  const previousDigest = findPreviousDigest(date);
  // Window = time since the last digest, never a hard 24h. A delayed or skipped
  // cron then just widens the window instead of dropping a day of coverage.
  const windowStart = previousDigest?.generatedAt
    ? new Date(previousDigest.generatedAt)
    : new Date(now.getTime() - 3 * 86_400_000);

  const history = readSourceHistory();
  const cache = new HttpCache(".cache/http-meta.json", ".cache/raw");
  await cache.load();
  const http = createHttpClient(cache);

  const sources = enabledSources(args.only.length ? args.only : undefined);
  console.log(`[${date}] fetching ${sources.length} sources (window from ${windowStart.toISOString()})`);

  const { items, health } = await collectSources(sources, http, cache, {
    window: { start: windowStart, end: now },
    now,
    fromCache: args.fromCache,
    previousHealth: healthFromHistory(history),
    trailingMedian: trailingMedians(history),
    log: (message) => console.log(message),
  });
  await cache.flush();

  const okSources = health.filter((h) => h.status === "ok" || h.status === "not-modified").length;
  console.log(`\nFetched ${items.length} items from ${okSources}/${health.length} healthy sources`);

  const watchlist = compileWatchlist(loadWatchlistWithPrivate());
  const seen = new SeenStore();

  const { digest, unknownEntities } = buildDigest(items, {
    date,
    now,
    windowStart,
    health,
    watchlist,
    seen,
    runId: process.env.GITHUB_RUN_ID,
  });

  const laneCounts = digest.lanes.map((lane) => `${lane.label}: ${lane.itemIds.length}`).join(" · ");
  console.log(`Kept ${digest.stats.kept} items (median score ${digest.stats.medianScore})`);
  console.log(`  ${laneCounts}`);
  console.log(`  ${digest.alerts.length} watchlist alerts, ${digest.clusters.length} clusters`);
  if (Object.keys(digest.stats.dropped).length) {
    console.log(`  dropped: ${JSON.stringify(digest.stats.dropped)}`);
  }

  /* ---- usability gate: never publish a broken digest ---- */
  const healthyRatio = health.length > 0 ? okSources / health.length : 0;
  const unusable = digest.stats.kept === 0 || healthyRatio < 0.5;

  const status: RunStatus = {
    runId: process.env.GITHUB_RUN_ID,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    outcome: unusable ? "unusable" : "ok",
    message: unusable
      ? `only ${okSources}/${health.length} sources healthy, ${digest.stats.kept} items kept`
      : undefined,
    date,
    sourcesOk: okSources,
    sourcesTotal: health.length,
    itemsKept: digest.stats.kept,
  };

  if (args.dryRun) {
    console.log("\n--- dry run: nothing written ---\n");
    printTop(digest, 15);
    return unusable ? 2 : 0;
  }

  writeRunStatus(status);
  writeSourceHistory(health, history);

  if (unusable) {
    console.error(`\nRUN UNUSABLE: ${status.message}. Not writing a digest.`);
    emitSummary(args.summaryFile, `### Digest ${date}\n\n**Run unusable** — ${status.message}`);
    return 2;
  }

  seen.flush();
  writeUnknownEntities(unknownEntities);
  const file = writeDigest(digest);
  console.log(`\nWrote ${file}`);

  emitSummary(
    args.summaryFile,
    [
      `### Digest ${date}`,
      "",
      `- ${digest.stats.kept} items kept from ${items.length} fetched`,
      `- ${okSources}/${health.length} sources healthy`,
      `- ${digest.alerts.length} watchlist alerts`,
      "",
      "| Source | Status | Items |",
      "| --- | --- | --- |",
      ...health.map((h) => `| ${h.sourceId} | ${h.status} | ${h.itemsKept} |`),
    ].join("\n"),
  );

  printTop(digest, 10);
  return 0;
}

function findPreviousDigest(date: string) {
  for (let back = 1; back <= 10; back++) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - back);
    const previous = readDigest(day.toISOString().slice(0, 10));
    if (previous) return previous;
  }
  return undefined;
}

function printTop(digest: ReturnType<typeof buildDigest>["digest"], count: number): void {
  const items = Object.values(digest.items)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
  console.log(`\nTop ${items.length}:`);
  for (const item of items) {
    const why = item.scoreBreakdown.factors
      .slice(0, 3)
      .map((f) => `${f.label} +${f.contribution.toFixed(1)}`)
      .join(", ");
    console.log(`\n  ${item.score.toFixed(1).padStart(5)}  [${item.sourceName}] ${item.title}`);
    console.log(`         ${why}`);
    if (item.digest[0]) console.log(`         ${item.digest[0].slice(0, 130)}`);
    const facts = [
      item.keyFacts.phase,
      item.keyFacts.indication,
      item.keyFacts.outcome ? `outcome: ${item.keyFacts.outcome}` : undefined,
      item.keyFacts.drugs[0]?.name,
      item.keyFacts.deal ? `${item.keyFacts.deal.type} ${item.keyFacts.deal.totalUsdM ?? ""}` : undefined,
      item.keyFacts.evidenceLevel !== "unknown" ? item.keyFacts.evidenceLevel : undefined,
    ].filter(Boolean);
    if (facts.length) console.log(`         facts: ${facts.join(" · ")}`);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
