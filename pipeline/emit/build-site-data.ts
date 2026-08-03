import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { DigestItem, SearchIndex, SiteManifest } from "../../lib/types";
import { FOCUS_LANES } from "../../lib/types";
import { buildWeekly } from "../rollup/weekly";
import { listDigestDates, listWeeks, readDigest, writeWeekly } from "../state/store";

/**
 * Derives the browser-facing payload from the committed digests. Runs as
 * `prebuild`, writes to public/data/ (gitignored — it is derived, not source).
 *
 * The search index is arrays, not objects, and carries only what a result row
 * needs to render. Rows link to the prerendered /digest/<date>/#<id> page, so
 * the archive never has to fetch a full day's JSON.
 */

const OUT_DIR = path.join(process.cwd(), "public", "data");

const COLS = ["day", "src", "lane", "score", "watch", "title", "id"] as const;

function write(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf8");
}

function main(): void {
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  const dates = listDigestDates();

  // `generateStaticParams` returning an empty array is a hard build failure
  // under `output: 'export'`, so /weekly/[week] needs at least one rollup to
  // exist. Building the current week here is idempotent and useful anyway —
  // you get a running rollup instead of waiting for Sunday.
  if (dates.length > 0 && listWeeks().length === 0) {
    const latestDate = dates[0];
    if (latestDate) {
      const rollup = buildWeekly({
        reference: new Date(`${latestDate}T12:00:00Z`),
        updateBaseline: false,
      });
      if (rollup) {
        writeWeekly(rollup);
        console.log(`build-site-data: seeded weekly rollup ${rollup.week}`);
      }
    }
  }

  const weeks = listWeeks();

  if (dates.length === 0) {
    // A fresh clone with no digests must still build; the site shows an
    // explanatory empty state rather than crashing the build.
    write(path.join(OUT_DIR, "manifest.json"), {
      latest: "",
      days: [],
      weeks,
      years: [],
      buildId,
      generatedAt: new Date().toISOString(),
    } satisfies SiteManifest);
    console.log("build-site-data: no digests yet; wrote an empty manifest");
    return;
  }

  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))].sort((a, b) => b - a);

  const manifest: SiteManifest = {
    latest: dates[0] ?? "",
    days: dates,
    weeks,
    years,
    buildId,
    generatedAt: new Date().toISOString(),
  };
  write(path.join(OUT_DIR, "manifest.json"), manifest);

  // A static stand-in for the API route the old app had: same role, real file,
  // cache-bustable, and it costs nothing to serve.
  const latest = readDigest(dates[0] ?? "");
  if (latest) write(path.join(OUT_DIR, "latest.json"), latest);

  for (const year of years) {
    const yearDates = dates.filter((date) => date.startsWith(String(year))).sort();
    const sources: string[] = [];
    const rows: (string | number)[][] = [];

    for (const [dayIndex, date] of yearDates.entries()) {
      const digest = readDigest(date);
      if (!digest) continue;
      for (const item of Object.values(digest.items) as DigestItem[]) {
        let sourceIndex = sources.indexOf(item.sourceName);
        if (sourceIndex === -1) {
          sources.push(item.sourceName);
          sourceIndex = sources.length - 1;
        }
        rows.push([
          dayIndex,
          sourceIndex,
          FOCUS_LANES.indexOf(item.primaryLane),
          Math.round(item.score),
          item.watchHits.length > 0 ? 1 : 0,
          item.title,
          item.id,
        ]);
      }
    }

    const index: SearchIndex = {
      year,
      buildId,
      cols: [...COLS],
      sources,
      lanes: [...FOCUS_LANES],
      days: yearDates,
      rows,
    };
    write(path.join(OUT_DIR, `search-${year}.json`), index);
    console.log(`build-site-data: search-${year}.json — ${rows.length} rows`);
  }

  console.log(`build-site-data: ${dates.length} digests, ${weeks.length} weekly rollups`);
}

main();
