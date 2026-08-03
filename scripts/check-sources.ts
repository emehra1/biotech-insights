/**
 * Source health check: fetch every (or some) source and report what came back.
 *
 * This is the tool that catches feed rot. Four of the previous version's ten
 * feeds had died silently; run this whenever the digest looks thin.
 *
 *   npx tsx scripts/check-sources.ts                    # all sources
 *   npx tsx scripts/check-sources.ts fierce-biotech     # just one
 */
import { enabledSources } from "../pipeline/config/sources";
import { collectSources } from "../pipeline/ingest/collect";
import { HttpCache } from "../pipeline/net/cache";
import { createHttpClient } from "../pipeline/net/http";

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const now = new Date();
  const window = { start: new Date(now.getTime() - 4 * 86_400_000), end: now };

  const cache = new HttpCache(".cache/http-meta.json", ".cache/raw");
  await cache.load();
  const http = createHttpClient(cache);

  const sources = enabledSources(only.length ? only : undefined);
  console.log(`Fetching ${sources.length} sources…\n`);

  const { items, health } = await collectSources(sources, http, cache, {
    window,
    now,
    log: (m) => console.log(m),
  });
  await cache.flush();

  console.log("\n=== HEALTH ===");
  for (const h of [...health].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    const flag = h.status === "ok" ? "  " : "!!";
    console.log(
      `${flag} ${h.status.padEnd(13)} ${h.sourceId.padEnd(26)} kept=${String(h.itemsKept).padStart(3)}` +
        ` parsed=${String(h.itemsParsed).padStart(3)} ${h.latencyMs}ms ${h.error ?? ""}` +
        (h.parseWarnings.length ? ` [${h.parseWarnings.join(", ")}]` : ""),
    );
  }

  console.log("\n=== BODY TEXT AVAILABLE (median chars) ===");
  const bySource = new Map<string, number[]>();
  for (const item of items) {
    const arr = bySource.get(item.sourceId) ?? [];
    arr.push(item.bodyText.length);
    bySource.set(item.sourceId, arr);
  }
  for (const [id, lengths] of [...bySource].sort()) {
    const sorted = lengths.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const provenance = items.find((i) => i.sourceId === id)?.bodyProvenance ?? "?";
    console.log(`   ${id.padEnd(26)} n=${String(sorted.length).padStart(3)} median=${String(median).padStart(5)}  ${provenance}`);
  }

  console.log("\n=== SAMPLE ===");
  for (const item of items.slice(0, 5)) {
    console.log(`\n[${item.sourceId}] ${item.title}`);
    console.log(
      `   ${item.publishedAt?.toISOString() ?? "NO DATE"} (${item.datePrecision}, confident=${item.dateConfident})`,
    );
    console.log(`   ${item.canonicalUrl}`);
    console.log(`   ${item.bodyProvenance}: ${item.bodyText.slice(0, 120)}`);
  }

  // Regression assertions for the specific bugs this rewrite fixes.
  const problems: string[] = [];
  for (const item of items) {
    if (typeof item.title !== "string" || !item.title) problems.push(`non-string title @ ${item.sourceId}`);
    if (item.title.includes("[object")) problems.push(`object leaked into title @ ${item.sourceId}: ${item.title}`);
    if (/\/resource\/|\/premium\//.test(item.canonicalUrl)) problems.push(`sponsored URL survived: ${item.canonicalUrl}`);
    if (/[?&](utm_|rss=)/.test(item.canonicalUrl)) problems.push(`tracking param survived: ${item.canonicalUrl}`);
  }
  const undated = items.filter((i) => !i.publishedAt);
  if (undated.length) problems.push(`${undated.length} items without a parseable date`);

  console.log(`\n=== ASSERTIONS (${items.length} items) ===`);
  if (problems.length === 0) {
    console.log("   OK — string titles, canonical URLs, real dates, no sponsored content");
  } else {
    for (const p of [...new Set(problems)]) console.log(`   FAIL ${p}`);
  }

  const bad = health.filter((h) => h.status === "failed" || h.status === "degraded");
  if (bad.length) {
    console.log(`\n${bad.length}/${health.length} sources need attention.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
