import type { FocusLane, SourceKind } from "../../lib/types";
import { JOURNAL_FAMILIES } from "./journals";
import { cleanText } from "../normalize/text";
import { parseFeedDate, type ParsedDate } from "../normalize/dates";

/**
 * The source registry. Every endpoint here returned HTTP 200 when this file was
 * written; the ones the previous version of this project used and that are now
 * dead are listed at the bottom so nobody re-adds them.
 *
 * Two fields deserve explanation:
 *
 *  - `publisherGroup` is what corroboration counts, not `id`. Fierce Biotech and
 *    Fierce Pharma are one newsroom (Questex); Nature/NBT/NM/NRD are one
 *    (Springer Nature). Counting sources would make "covered by 3 outlets" a lie.
 *  - `fullText` gates article scraping. Paywalled sources are feed-only, full
 *    stop, and scraping is off by default everywhere because Cloudflare-fronted
 *    publishers reject datacenter IPs — GitHub Actions runners included.
 */

export type FeedDialect = "rss2" | "rdf" | "atom" | "json";
export type FullTextPolicy = "feed-only" | "scrape-allowed" | "api-body";

export interface RunWindow {
  start: Date;
  end: Date;
}

export interface RawFeedItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;
  isoDate?: string;
  creator?: unknown;
  categories?: unknown;
  content?: unknown;
  contentSnippet?: unknown;
  ce?: unknown;
  dcDate?: unknown;
  prismDate?: unknown;
  doi?: unknown;
  [key: string]: unknown;
}

export interface ParserOverrides {
  title?: (raw: RawFeedItem) => string;
  date?: (raw: RawFeedItem, source: SourceDef, now: Date) => ParsedDate;
  link?: (raw: RawFeedItem) => string;
}

export interface SourceDef {
  id: string;
  name: string;
  publisherGroup: string;
  homepage: string;
  kind: SourceKind;
  dialect: FeedDialect;
  endpoint: string | ((window: RunWindow) => string);
  /** 0..1 hand-set editorial authority. */
  authority: number;
  /** Prior, not a filter — scoring still decides the lane from content. */
  laneHints: Partial<Record<FocusLane, number>>;
  fullText: FullTextPolicy;
  paywalled: boolean;
  crawlDelayMs: number;
  conditionalGet: boolean;
  maxItems: number;
  enabled: boolean;
  /** Zone for wall-clock dates that carry no offset. */
  timeZone?: string;
  exclude?: { urlPatterns?: RegExp[]; titlePatterns?: RegExp[] };
  parser?: ParserOverrides;
  note?: string;
}

/** Unwraps Fierce's anchor-in-title: {"a":[{"_":"…","$":{...}}]} → "…". */
export function unwrapAnchorText(raw: RawFeedItem): string {
  return cleanText(raw.title);
}

const fierceDate = (raw: RawFeedItem, source: SourceDef, now: Date): ParsedDate =>
  parseFeedDate(raw.pubDate, {
    assumeTimeZone: source.timeZone ?? "America/New_York",
    now,
  });

const FIERCE_EXCLUDE = {
  urlPatterns: [/\/resource\//i, /\/premium\//i, /\/sponsored/i, /\/whitepaper/i, /\/webinar/i],
  titlePatterns: [/^\s*\[sponsored\]/i],
};

function eutc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Europe PMC lookback, in days, for the per-publisher literature sources.
 *
 * The run window is "time since the last digest" — about 24 hours in steady
 * state — and that is far too narrow for this API. Measured on 2026-08-06 with
 * the nine journals the old `europepmc-clinical` query named:
 *
 *   FIRST_PDATE window   1d=5   3d=40   7d=224   14d=400
 *
 * Five hits, all of them JAMA. That is the whole of `europepmc-clinical`'s
 * recentCounts [36,13,4,5]: the 36 was the cold-start 3-day window on the first
 * run, and every daily run since collapsed to 4-5.
 *
 * Widening is not optional and no other date field rescues it. FIRST_IDATE and
 * CREATION_DATE key on when Europe PMC ingested the record, and those arrive in
 * bulk batches with multi-day gaps of literally zero (07-27, 07-28, 07-29 and
 * 08-01 were all empty), so a narrow window on any field produces dead days.
 * The per-journal deposit lag runs 1 day (Sci Transl Med, JAMA) to 9 days (Cell
 * Stem Cell), so the window has to clear the worst lag plus an issue period or
 * whole journals silently vanish.
 *
 * Re-fetching two weeks every day is safe: the seen store gives each item a
 * stable id, and anything an earlier digest already carried takes the
 * `staleRepeat` penalty.
 */
const LITERATURE_LOOKBACK_DAYS = 14;

/**
 * A Europe PMC journal search that returns only records with an abstract.
 *
 * `HAS_ABSTRACT:Y` is the single highest-leverage term here. Without it, 73% of
 * what these journals match has no abstract to return, because it is not
 * research: a 7-day sample of JOURNAL:"Nature" was 68 News items, 5 errata, a
 * retraction notice and an expression of concern against 25 research articles,
 * and NEJM was 27 Comments and Letters against 6. With it, abstract coverage
 * goes from 27% to 100% and the notices disappear at the source.
 *
 * `sort=P_PDATE_D desc` is load-bearing too: the API defaults to relevance
 * order, so with a 14-day window an unsorted `maxItems` slice would keep an
 * arbitrary subset and could drop today's papers entirely.
 *
 * Beware the silent-zero trap when editing this: PUB_DATE, EPUB_DATE, PPUB_DATE
 * and INDEXED_DATE are not Europe PMC fields. They return HTTP 200 with
 * hitCount 0 and no error, so a plausible-looking "fix" takes the source to zero
 * without failing anything.
 */
function europePmcJournals(
  journals: readonly string[],
  window: RunWindow,
  pageSize = 100,
): string {
  const clause = journals.map((journal) => `JOURNAL:"${journal}"`).join(" OR ");
  const start = eutc(new Date(window.end.getTime() - LITERATURE_LOOKBACK_DAYS * 86_400_000));
  return (
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
    `?format=json&resultType=core&pageSize=${pageSize}&sort=${encodeURIComponent("P_PDATE_D desc")}` +
    "&query=" +
    encodeURIComponent(
      `(${clause}) AND HAS_ABSTRACT:Y AND (FIRST_PDATE:[${start} TO ${eutc(window.end)}])`,
    )
  );
}

/**
 * Shared shape for the nature.com sub-journal feeds. Every non-flagship feed
 * nature.com serves returns exactly 8 items, server-side, whatever you ask for —
 * so `maxItems` here is headroom, not a target, and the old `maxItems: 30` on
 * nbt/nm/nrd was always dead config.
 */
function natureJournal(
  overrides: Pick<SourceDef, "id" | "name" | "homepage" | "endpoint" | "authority" | "laneHints"> &
    Partial<SourceDef>,
): SourceDef {
  return {
    publisherGroup: "springer-nature",
    kind: "journal",
    dialect: "rdf",
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 20,
    enabled: true,
    ...overrides,
  };
}

export const SOURCES: SourceDef[] = [
  /* ------------------------------- news -------------------------------- */
  {
    id: "endpoints",
    name: "Endpoints News",
    publisherGroup: "endpoints",
    homepage: "https://endpoints.news/",
    kind: "news",
    dialect: "rss2",
    // endpts.com/feed/ 301s here; register the destination directly.
    endpoint: "https://endpoints.news/feed/",
    authority: 0.9,
    laneHints: { "business-deals": 0.45, "clinical-regulatory": 0.4 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 500,
    conditionalGet: true,
    maxItems: 40,
    enabled: true,
    note: "No content:encoded; deks run ~200 chars. Do not scrape (paywalled).",
  },
  {
    id: "fierce-biotech",
    name: "Fierce Biotech",
    publisherGroup: "questex",
    homepage: "https://www.fiercebiotech.com/",
    kind: "news",
    dialect: "rss2",
    // /rss.xml is the SPONSORED feed (all /resource/ + /premium/webinar/ links).
    // /rss/xml is the editorial feed. The old code used the wrong one.
    endpoint: "https://www.fiercebiotech.com/rss/xml",
    authority: 0.74,
    laneHints: { "clinical-regulatory": 0.4, "business-deals": 0.35 },
    fullText: "feed-only",
    paywalled: false,
    crawlDelayMs: 400,
    conditionalGet: true,
    maxItems: 40,
    enabled: true,
    timeZone: "America/New_York",
    exclude: FIERCE_EXCLUDE,
    parser: { title: unwrapAnchorText, date: fierceDate },
    note: "Anchor markup inside <title>/<dc:creator>; pubDate is 'Jul 31, 2026 8:59am'.",
  },
  {
    id: "fierce-pharma",
    name: "Fierce Pharma",
    publisherGroup: "questex",
    homepage: "https://www.fiercepharma.com/",
    kind: "news",
    dialect: "rss2",
    endpoint: "https://www.fiercepharma.com/rss/xml",
    authority: 0.72,
    laneHints: { "business-deals": 0.45, "clinical-regulatory": 0.3 },
    fullText: "feed-only",
    paywalled: false,
    crawlDelayMs: 400,
    conditionalGet: true,
    maxItems: 40,
    enabled: true,
    timeZone: "America/New_York",
    exclude: FIERCE_EXCLUDE,
    parser: { title: unwrapAnchorText, date: fierceDate },
  },
  {
    id: "statnews",
    name: "STAT News",
    publisherGroup: "stat",
    homepage: "https://www.statnews.com/",
    kind: "news",
    dialect: "rss2",
    endpoint: "https://www.statnews.com/feed/",
    authority: 0.88,
    laneHints: { "clinical-regulatory": 0.4, "business-deals": 0.3, "frontier-science": 0.2 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 500,
    conditionalGet: true,
    maxItems: 40,
    enabled: true,
    note: "Richest bodies of any source: content:encoded runs 680–3445 chars.",
  },
  {
    id: "biopharmadive",
    name: "BioPharma Dive",
    publisherGroup: "industrydive",
    homepage: "https://www.biopharmadive.com/",
    kind: "news",
    dialect: "rss2",
    endpoint: "https://www.biopharmadive.com/feeds/news/",
    authority: 0.78,
    laneHints: { "business-deals": 0.4, "clinical-regulatory": 0.4 },
    fullText: "feed-only",
    paywalled: false,
    crawlDelayMs: 400,
    conditionalGet: true,
    maxItems: 40,
    enabled: true,
    note: "description is escaped HTML opening with <figure><img>.",
  },

  /* ---------------------------- regulatory ----------------------------- */
  {
    id: "fda-press",
    name: "FDA Press Announcements",
    publisherGroup: "fda",
    homepage: "https://www.fda.gov/news-events/fda-newsroom/press-announcements",
    kind: "regulatory",
    dialect: "rss2",
    endpoint:
      "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    authority: 1,
    laneHints: { "clinical-regulatory": 0.8 },
    fullText: "scrape-allowed",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: true,
    maxItems: 30,
    enabled: true,
    note: "RFC-822 dates with named zones (EDT); http:// links get upgraded.",
  },

  /* ------------------------------ journals ----------------------------- */
  {
    id: "nature",
    name: "Nature",
    publisherGroup: "springer-nature",
    homepage: "https://www.nature.com/nature/",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.nature.com/nature.rss",
    authority: 0.95,
    laneHints: { "frontier-science": 0.6, "aging-omics": 0.2 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    // The flagship feed carries ~75 items and is 59% magazine: a live pull was
    // 44 `d41586` (News, News & Views, Careers, Books & Arts, Editorials, the
    // Futures fiction column) against 31 `s41586` research articles. At
    // maxItems: 40 the slice happened before any of that was assessed, so a third
    // of the research was truncated away to make room for book reviews. Take the
    // whole feed and let scoring decide; the per-source cap still keeps 8.
    maxItems: 80,
    enabled: true,
    note: "RSS 1.0/RDF: no pubDate, no contentSnippet. Use dc:date + content:encoded.",
  },
  {
    id: "nature-biotech",
    name: "Nature Biotechnology",
    publisherGroup: "springer-nature",
    homepage: "https://www.nature.com/nbt/",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.nature.com/nbt.rss",
    authority: 0.9,
    laneHints: { "frontier-science": 0.55, "business-deals": 0.15 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 30,
    enabled: true,
  },
  {
    id: "nature-medicine",
    name: "Nature Medicine",
    publisherGroup: "springer-nature",
    homepage: "https://www.nature.com/nm/",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.nature.com/nm.rss",
    authority: 0.92,
    laneHints: { "frontier-science": 0.45, "clinical-regulatory": 0.3 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 30,
    enabled: true,
  },
  {
    id: "nature-rev-drug-discovery",
    name: "Nature Reviews Drug Discovery (News & Analysis)",
    publisherGroup: "springer-nature",
    homepage: "https://www.nature.com/nrd/",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.nature.com/nrd.rss",
    authority: 0.85,
    // All 8 items this feed serves are `d41573` — NRDD's News & Analysis column,
    // not the peer-reviewed reviews, and none of them carry an abstract. The
    // content is good ("First dual BAFF and APRIL inhibitor nabs FDA approval",
    // "Lilly spends US$2.8 billion on psychedelic drugs") but it is industry
    // news, so the old frontier-science: 0.4 prior was filing pipeline business
    // stories under basic science.
    laneHints: { "business-deals": 0.4, "clinical-regulatory": 0.3 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 20,
    enabled: true,
    note: "News & Analysis column, not the reviews. Titles only, no abstracts.",
  },

  /* ------------------- Nature sub-journals (research) -------------------
   *
   * Every one of these serves 8 items with a real editor's-summary abstract,
   * which matters more than it sounds: the flagship nature.rss is title-only for
   * a third of its items, and an item with no body has nothing for the lexicon
   * to match, so it can only ever be scored on provenance. These are the feeds
   * that actually let a paper be judged on what it says.
   *
   * Chosen against config/watchlist.yml rather than by impact factor. Also live
   * and datacenter-safe, if the interests change: natcancer.rss, ncomms.rss
   * (mega-journal, ~80 papers/day behind an 8-item feed), nsmb.rss,
   * nmicrobiol.rss, ni.rss, nmeth.rss (only 2/8 carry abstracts).
   */
  natureJournal({
    id: "nature-genetics",
    name: "Nature Genetics",
    homepage: "https://www.nature.com/ng/",
    endpoint: "https://www.nature.com/ng.rss",
    authority: 0.9,
    // Chromatin architecture, enhancer–gene mapping and single-cell method work:
    // three of the reader's four standing watchlist topics.
    laneHints: { "aging-omics": 0.5, "frontier-science": 0.4 },
    note: "8/8 items carry abstracts, median 265 chars.",
  }),
  natureJournal({
    id: "nature-aging",
    name: "Nature Aging",
    homepage: "https://www.nature.com/nataging/",
    endpoint: "https://www.nature.com/nataging.rss",
    authority: 0.88,
    laneHints: { "aging-omics": 0.7, "frontier-science": 0.25 },
    note: "The aging-omics lane had no dedicated journal before this.",
  }),
  natureJournal({
    id: "nature-metabolism",
    name: "Nature Metabolism",
    homepage: "https://www.nature.com/natmetab/",
    endpoint: "https://www.nature.com/natmetab.rss",
    authority: 0.86,
    laneHints: { "aging-omics": 0.45, "frontier-science": 0.35 },
  }),
  natureJournal({
    id: "nature-chem-biol",
    name: "Nature Chemical Biology",
    homepage: "https://www.nature.com/nchembio/",
    endpoint: "https://www.nature.com/nchembio.rss",
    authority: 0.86,
    // Degraders, molecular glues and chemical probes — the frontier-science
    // lexicon's highest-weighted terms live here.
    laneHints: { "frontier-science": 0.6 },
  }),
  natureJournal({
    id: "nature-biomed-eng",
    name: "Nature Biomedical Engineering",
    homepage: "https://www.nature.com/natbiomedeng/",
    endpoint: "https://www.nature.com/natbiomedeng.rss",
    authority: 0.85,
    laneHints: { "frontier-science": 0.55, "clinical-regulatory": 0.2 },
  }),
  natureJournal({
    id: "nature-cell-biol",
    name: "Nature Cell Biology",
    homepage: "https://www.nature.com/ncb/",
    endpoint: "https://www.nature.com/ncb.rss",
    authority: 0.86,
    laneHints: { "frontier-science": 0.45, "aging-omics": 0.4 },
    note: "Closest reachable substitute for the blocked cell-stem-cell feed.",
  }),
  natureJournal({
    id: "nature-cancer",
    name: "Nature Cancer",
    homepage: "https://www.nature.com/natcancer/",
    endpoint: "https://www.nature.com/natcancer.rss",
    authority: 0.86,
    laneHints: { "frontier-science": 0.45, "clinical-regulatory": 0.25 },
  }),
  {
    id: "science-news",
    name: "Science (News)",
    publisherGroup: "aaas",
    homepage: "https://www.science.org/news",
    kind: "journal",
    dialect: "rss2",
    // news_content.xml is gone (410). news_current.xml is the live one.
    endpoint: "https://www.science.org/rss/news_current.xml",
    authority: 0.9,
    laneHints: { "frontier-science": 0.5, "clinical-regulatory": 0.15 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 30,
    enabled: true,
  },
  {
    id: "cell",
    name: "Cell",
    publisherGroup: "elsevier",
    homepage: "https://www.cell.com/cell/home",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.cell.com/cell/inpress.rss",
    authority: 0.92,
    laneHints: { "frontier-science": 0.55, "aging-omics": 0.25 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 30,
    // Disabled: returns HTTP 403 to GitHub Actions runners (Atypon fronts the
    // cell.com feeds and blocks datacenter ranges). It works from a laptop, so
    // a local `npm run pipeline` still picks it up — but a source that can only
    // ever fail in CI is noise in the health panel. Coverage comes from
    // europepmc-elsevier below, which indexes these journals AND gives real
    // abstracts instead of RSS titles.
    //
    // Do not "fix" this with a proxy or a scraper: the same response carries
    // `tdm-reservation: 1`, Elsevier's machine-readable opt-out from text and
    // data mining. The block is a stated preference, not an obstacle.
    enabled: false,
  },
  {
    id: "cell-stem-cell",
    name: "Cell Stem Cell",
    publisherGroup: "elsevier",
    homepage: "https://www.cell.com/cell-stem-cell/home",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.cell.com/cell-stem-cell/inpress.rss",
    authority: 0.88,
    laneHints: { "aging-omics": 0.45, "frontier-science": 0.35 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 20,
    enabled: false, // HTTP 403 from Actions runners — see the note on `cell`.
  },
  {
    id: "nejm",
    name: "NEJM",
    publisherGroup: "mms",
    homepage: "https://www.nejm.org/",
    kind: "journal",
    dialect: "rss2",
    // /rss 403s; this is the working feed URL — but see `enabled` below: it is
    // also robots-disallowed, so "working" is not the same as "ours to fetch".
    endpoint: "https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm",
    authority: 0.95,
    laneHints: { "clinical-regulatory": 0.5, "frontier-science": 0.3 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 25,
    // Disabled, and not to be re-enabled: nejm.org/robots.txt has both
    // `Disallow: /action` and `Disallow: /rss` under `User-agent: *`, so every
    // NEJM feed URL is off-limits by the site's own rules — the 403 is the
    // enforcement, not the problem. science.org and thelancet.com both disallow
    // `/action` the same way. Coverage comes from europepmc-nejm below.
    enabled: false,
  },
  /* ------------- publishers only reachable through Europe PMC -------------
   *
   * These three replace the single `europepmc-clinical` source, which named nine
   * journals in one query and delivered 0-3 items a day. Two things were wrong
   * with it and both are fixed above in `europePmcJournals`: the window was ~24h
   * against an index whose deposit lag is 1-9 days, and it did not ask for
   * abstracts, so three quarters of what it matched was News and Letters.
   *
   * The split is by publisher, not by topic, and that is deliberate. One source
   * declares one `publisherGroup`, and publisherGroup is what corroboration
   * counts and what the per-publisher cap limits — so lumping Elsevier, AAAS and
   * NEJM together made all three look like a single outlet called "europepmc".
   *
   * Springer Nature and JAMA were in that old query and are deliberately NOT
   * here: their own feeds work, are fresher (nature.com same-day vs 8 days
   * through Europe PMC), and a publisher reachable by two paths would be
   * ingested twice under two different canonical URLs. Same-run duplicates get
   * clustered, but the two arrivals are 8 days apart, so nothing would catch it.
   */
  {
    id: "europepmc-cellpress",
    name: "Cell Press (via Europe PMC)",
    // cell.com is Atypon/Cloudflare and 403s the runner. Elsevier also returns
    // `tdm-reservation: 1` on those feeds — a machine-readable text-and-data-
    // mining opt-out — so routing around the block would be ignoring an explicit
    // "no". Europe PMC is the licensed index that says yes, and it hands back the
    // abstract too. Items are credited to the journal, not to the index.
    publisherGroup: "elsevier",
    homepage: "https://europepmc.org/",
    kind: "journal",
    dialect: "json",
    // ~110 abstract-bearing papers per 14 days across the eleven titles, so ask
    // for more than that: the query is date-sorted, but truncating it would still
    // silently drop the tail of the window.
    endpoint: (window) => europePmcJournals(JOURNAL_FAMILIES.cellpress, window, 130),
    authority: 0.9,
    laneHints: { "frontier-science": 0.45, "clinical-regulatory": 0.25 },
    fullText: "api-body",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: false,
    maxItems: 130,
    enabled: true,
    note: "Verified: JOURNAL:\"Cell\" resolves to Cell alone and does not leak into Cell Reports.",
  },
  {
    id: "europepmc-lancet",
    name: "The Lancet (via Europe PMC)",
    // Also Elsevier, so it shares a publisherGroup with Cell Press and cannot
    // corroborate it. Separate source purely so the two families get separate
    // daily allowances — bundled, Cell Press's volume would crowd Lancet out.
    publisherGroup: "elsevier",
    homepage: "https://europepmc.org/",
    kind: "journal",
    dialect: "json",
    endpoint: (window) => europePmcJournals(JOURNAL_FAMILIES.lancet, window, 60),
    authority: 0.93,
    laneHints: { "clinical-regulatory": 0.55, "frontier-science": 0.2 },
    fullText: "api-body",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: false,
    maxItems: 60,
    enabled: true,
    note: "~35 papers/14d across the eight titles.",
  },
  {
    id: "europepmc-aaas",
    name: "Science journals (via Europe PMC)",
    // Same publisherGroup as science-news on purpose: the newsroom and the
    // research journals are one outlet, so corroboration must not count them
    // twice. science.org is Atypon-fronted like cell.com, and its robots.txt
    // disallows /action, which is where every eTOC feed lives.
    publisherGroup: "aaas",
    homepage: "https://europepmc.org/",
    kind: "journal",
    dialect: "json",
    endpoint: (window) => europePmcJournals(JOURNAL_FAMILIES.aaas, window, 100),
    authority: 0.92,
    laneHints: { "frontier-science": 0.5, "clinical-regulatory": 0.2 },
    fullText: "api-body",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: false,
    maxItems: 100,
    enabled: true,
    note: "The only route to Science RESEARCH — science-news is the newsroom and carries no papers.",
  },
  {
    id: "europepmc-nejm",
    name: "NEJM (via Europe PMC)",
    publisherGroup: "mms",
    homepage: "https://europepmc.org/",
    kind: "journal",
    dialect: "json",
    endpoint: (window) => europePmcJournals(JOURNAL_FAMILIES.nejm, window, 50),
    authority: 0.95,
    laneHints: { "clinical-regulatory": 0.5, "frontier-science": 0.25 },
    fullText: "api-body",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: false,
    maxItems: 20,
    enabled: true,
    // Low volume by nature — roughly 2 abstract-bearing papers per 14 days — but
    // they are the highest-authority clinical papers published anywhere, and the
    // cap is a ceiling rather than a quota.
    note: "Deposit lag ~5 days. Its own feed is robots-disallowed; see the nejm entry above.",
  },
  {
    id: "europepmc-jama",
    name: "JAMA specialty journals (via Europe PMC)",
    // JAMA itself is NOT in this query — it has a working RSS feed above, and a
    // journal reachable two ways arrives under two canonical URLs that the
    // deduper cannot merge.
    publisherGroup: "ama",
    homepage: "https://europepmc.org/",
    kind: "journal",
    dialect: "json",
    endpoint: (window) => europePmcJournals(JOURNAL_FAMILIES.jama, window, 80),
    authority: 0.88,
    laneHints: { "clinical-regulatory": 0.55, "frontier-science": 0.15 },
    fullText: "api-body",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: false,
    maxItems: 80,
    enabled: true,
    // JAMA Network Open is excluded on volume — it alone publishes several
    // thousand papers a year.
    note: "JAMA Oncology, Cardiology, Neurology, Internal Medicine, Pediatrics, Psychiatry.",
  },
  {
    id: "jama",
    name: "JAMA",
    publisherGroup: "ama",
    homepage: "https://jamanetwork.com/journals/jama",
    kind: "journal",
    dialect: "rss2",
    // /journals/jama/rss.xml is a 404; this is the working path.
    endpoint: "https://jamanetwork.com/rss/site_3/67.xml",
    authority: 0.92,
    laneHints: { "clinical-regulatory": 0.5, "frontier-science": 0.2 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 25,
    enabled: true,
  },

  /* ----------------------------- preprints ----------------------------- */
  {
    id: "biorxiv",
    name: "bioRxiv",
    publisherGroup: "biorxiv",
    homepage: "https://www.biorxiv.org/",
    kind: "preprint",
    dialect: "rdf",
    // connect.biorxiv.org/relate/feed/ is a 404; this is the live endpoint.
    endpoint: "https://connect.biorxiv.org/biorxiv_xml.php?subject=all",
    authority: 0.55,
    laneHints: { "frontier-science": 0.5, "aging-omics": 0.3 },
    fullText: "feed-only",
    paywalled: false,
    crawlDelayMs: 800,
    conditionalGet: true,
    maxItems: 60,
    enabled: true,
    note: "RDF; titles and links arrive wrapped in literal newlines. ?rss=1 stripped.",
  },
  {
    id: "medrxiv",
    name: "medRxiv",
    publisherGroup: "medrxiv",
    homepage: "https://www.medrxiv.org/",
    kind: "preprint",
    dialect: "rdf",
    endpoint: "https://connect.medrxiv.org/medrxiv_xml.php?subject=all",
    authority: 0.55,
    laneHints: { "clinical-regulatory": 0.3, "frontier-science": 0.35 },
    fullText: "feed-only",
    paywalled: false,
    crawlDelayMs: 800,
    conditionalGet: true,
    maxItems: 60,
    enabled: true,
  },

  /* --------------------------- trial registry --------------------------- */
  {
    id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    publisherGroup: "nlm",
    homepage: "https://clinicaltrials.gov/",
    kind: "trials",
    dialect: "json",
    endpoint: (window) =>
      "https://clinicaltrials.gov/api/v2/studies?pageSize=40&countTotal=false" +
      "&filter.overallStatus=NOT_YET_RECRUITING|RECRUITING" +
      "&query.term=" +
      encodeURIComponent(
        `AREA[LastUpdatePostDate]RANGE[${eutc(window.start)},MAX] AND AREA[Phase]PHASE3 AND AREA[LeadSponsorClass]INDUSTRY`,
      ) +
      "&fields=protocolSection.identificationModule.nctId" +
      ",protocolSection.identificationModule.briefTitle" +
      ",protocolSection.descriptionModule.briefSummary" +
      ",protocolSection.designModule.phases" +
      ",protocolSection.designModule.enrollmentInfo.count" +
      ",protocolSection.sponsorCollaboratorsModule.leadSponsor.name" +
      ",protocolSection.conditionsModule.conditions" +
      ",protocolSection.armsInterventionsModule.interventions" +
      ",protocolSection.statusModule.lastUpdatePostDateStruct.date" +
      ",protocolSection.statusModule.startDateStruct.date",
    authority: 0.65,
    laneHints: { "clinical-regulatory": 0.6 },
    fullText: "api-body",
    paywalled: false,
    // robots.txt says Disallow: /api/ with Crawl-delay: 1. This is a documented
    // public REST API and we call it once a day, but we honor the crawl delay.
    crawlDelayMs: 1200,
    conditionalGet: false,
    maxItems: 40,
    enabled: true,
    note: "robots.txt Disallow: /api/ — documented public API, once-daily, 1s+ delay.",
  },
];

/**
 * Endpoints the previous version used that are now dead. Kept as a tombstone so
 * they don't get re-added from an old README.
 *   https://www.fiercebiotech.com/rss.xml               → sponsored content only
 *   https://www.fiercepharma.com/rss.xml                → sponsored content only
 *   https://www.science.org/rss/news_content.xml        → 410 Gone
 *   https://jamanetwork.com/journals/jama/rss.xml       → 404
 *   https://www.nejm.org/rss                            → 403
 *   https://connect.biorxiv.org/relate/feed/            → 404
 *   https://connect.medrxiv.org/relate/feed/            → 404
 */
export const RETIRED_ENDPOINTS = [
  "https://www.fiercebiotech.com/rss.xml",
  "https://www.fiercepharma.com/rss.xml",
  "https://www.science.org/rss/news_content.xml",
  "https://jamanetwork.com/journals/jama/rss.xml",
  "https://www.nejm.org/rss",
  "https://connect.biorxiv.org/relate/feed/",
  "https://connect.medrxiv.org/relate/feed/",
];

export function resolveEndpoint(source: SourceDef, window: RunWindow): string {
  return typeof source.endpoint === "function" ? source.endpoint(window) : source.endpoint;
}

export function sourceById(id: string): SourceDef | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function enabledSources(only?: string[]): SourceDef[] {
  const active = SOURCES.filter((s) => s.enabled);
  if (!only || only.length === 0) return active;
  const wanted = new Set(only);
  return active.filter((s) => wanted.has(s.id));
}
