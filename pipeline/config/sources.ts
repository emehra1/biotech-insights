import type { FocusLane, SourceKind } from "../../lib/types";
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
    maxItems: 40,
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
    name: "Nature Reviews Drug Discovery",
    publisherGroup: "springer-nature",
    homepage: "https://www.nature.com/nrd/",
    kind: "journal",
    dialect: "rdf",
    endpoint: "https://www.nature.com/nrd.rss",
    authority: 0.85,
    laneHints: { "frontier-science": 0.4, "business-deals": 0.25 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 20,
    enabled: true,
  },
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
    enabled: true,
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
    enabled: true,
  },
  {
    id: "nejm",
    name: "NEJM",
    publisherGroup: "mms",
    homepage: "https://www.nejm.org/",
    kind: "journal",
    dialect: "rss2",
    // /rss 403s; this is the working feed URL.
    endpoint: "https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm",
    authority: 0.95,
    laneHints: { "clinical-regulatory": 0.5, "frontier-science": 0.3 },
    fullText: "feed-only",
    paywalled: true,
    crawlDelayMs: 700,
    conditionalGet: true,
    maxItems: 25,
    enabled: true,
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

  /* -------------------------- literature APIs -------------------------- */
  {
    id: "europepmc-aging",
    name: "Europe PMC (aging & omics)",
    publisherGroup: "europepmc",
    homepage: "https://europepmc.org/",
    kind: "journal",
    dialect: "json",
    // The only source that hands us real abstracts, and it covers preprints too.
    endpoint: (window) =>
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=50&query=" +
      encodeURIComponent(
        `(("epigenetic clock" OR "biological age" OR senescence OR senolytic OR ` +
          `"partial reprogramming" OR "Yamanaka factors" OR geroscience OR ` +
          `"3D genome" OR "chromatin architecture" OR "single-cell atlas" OR ` +
          `"spatial transcriptomics" OR "DNA methylation age")) AND ` +
          `(FIRST_PDATE:[${eutc(window.start)} TO ${eutc(window.end)}])`,
      ),
    authority: 0.7,
    laneHints: { "aging-omics": 0.7, "frontier-science": 0.3 },
    fullText: "api-body",
    paywalled: false,
    crawlDelayMs: 1000,
    conditionalGet: false,
    maxItems: 50,
    enabled: true,
    note: "resultType=core returns abstractText — the abstract IS the summary.",
  },
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
