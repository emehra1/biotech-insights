/**
 * Shared data contract between the pipeline (Node), the static site (React) and
 * the email renderer. Must stay browser-safe: no `node:` imports, no runtime deps.
 */

export const FOCUS_LANES = [
  "clinical-regulatory",
  "business-deals",
  "frontier-science",
  "aging-omics",
] as const;

export type FocusLane = (typeof FOCUS_LANES)[number];

export const LANE_LABELS: Record<FocusLane, string> = {
  "clinical-regulatory": "Clinical & Regulatory",
  "business-deals": "Business, Deals & Financing",
  "frontier-science": "Frontier Science",
  "aging-omics": "Aging, Epigenetics & Omics",
};

export const LANE_BLURBS: Record<FocusLane, string> = {
  "clinical-regulatory":
    "Trial readouts, phase transitions, approvals, CRLs, adcomms and safety signals.",
  "business-deals":
    "M&A, licensing, financings, IPOs, restructurings and leadership changes.",
  "frontier-science":
    "New mechanisms, modalities and methods from journals and preprints.",
  "aging-omics":
    "Aging biology, epigenetic clocks and reprogramming, 3D genome, single-cell and spatial omics.",
};

/** Where an item's body text came from. Never let the UI imply more than this. */
export type BodyProvenance =
  | "content:encoded"
  | "description"
  | "scraped"
  | "abstract"
  | "api"
  | "dek"
  | "none";

export type SourceKind = "news" | "journal" | "preprint" | "regulatory" | "trials";

export type EvidenceLevel =
  | "clinical"
  | "preclinical"
  | "in-vitro"
  | "review"
  | "unknown";

export type EventType =
  | "approval"
  | "crl"
  | "filing"
  | "designation"
  | "phase3-readout"
  | "phase-readout"
  | "phase3-start"
  | "safety-hold"
  | "ma-large"
  | "ma"
  | "license-large"
  | "license"
  | "financing-large"
  | "financing"
  | "ipo"
  | "distress"
  | "personnel"
  | "major-journal-primary"
  | "preprint"
  | "opinion";

export const EVENT_LABELS: Record<EventType, string> = {
  approval: "Regulatory approval",
  crl: "Complete response letter",
  filing: "Regulatory filing",
  designation: "Regulatory designation",
  "phase3-readout": "Phase 3 readout",
  "phase-readout": "Trial readout",
  "phase3-start": "New phase 3 start",
  "safety-hold": "Safety signal / clinical hold",
  "ma-large": "Large M&A",
  ma: "M&A",
  "license-large": "Major licensing deal",
  license: "Licensing deal",
  "financing-large": "Large financing",
  financing: "Financing",
  ipo: "IPO",
  distress: "Layoffs / restructuring",
  personnel: "Leadership change",
  "major-journal-primary": "Major-journal paper",
  preprint: "Preprint",
  opinion: "Opinion / roundup",
};

/** How much we trust an extracted entity. Only `stem-only` is hidden from the UI. */
export type MentionConfidence =
  | "dictionary"
  | "stem+anchor"
  | "stem-only"
  | "code"
  | "contextual";

export interface MentionEvidence {
  /** Verbatim source span. With no LLM, this quote *is* the correctness guarantee. */
  quote: string;
  offset: number;
}

export interface Mention {
  text: string;
  canonical: string;
  confidence: MentionConfidence;
  count: number;
  inTitle: boolean;
  evidence: MentionEvidence[];
}

export interface DrugMention extends Mention {
  inn?: string;
  brand?: string;
  code?: string;
  modality?: string;
}

export type CompanyRole = "sponsor" | "acquirer" | "target" | "partner" | "mentioned";

export interface CompanyMention extends Mention {
  companyId: string;
  ticker?: string;
  role?: CompanyRole;
}

export interface Entities {
  drugs: DrugMention[];
  companies: CompanyMention[];
  indications: Mention[];
  modalities: Mention[];
  targets: Mention[];
  nctIds: string[];
}

export type ResultMetric =
  | "ORR"
  | "PFS"
  | "OS"
  | "DOR"
  | "EFS"
  | "HR"
  | "p"
  | "response";

export interface TrialResult {
  metric: ResultMetric;
  value: string;
  comparator?: string;
  verbatim: string;
}

export type DealType = "M&A" | "license" | "financing" | "IPO";

export interface DealFacts {
  type: DealType;
  upfrontUsdM?: number;
  totalUsdM?: number;
  round?: string;
  currency?: string;
  verbatim: string;
}

export interface RegulatoryFact {
  agency: string;
  action: string;
  date?: string;
  verbatim: string;
}

/** The strip that usually communicates more than the prose does. */
export interface KeyFacts {
  companies: { name: string; role: CompanyRole; ticker?: string }[];
  drugs: { name: string; inn?: string; brand?: string; modality?: string }[];
  indication?: string;
  phase?: string;
  nct: string[];
  enrollment?: number;
  results: TrialResult[];
  outcome?: "met" | "missed" | "mixed" | "unclear";
  regulatory: RegulatoryFact[];
  deal?: DealFacts;
  evidenceLevel: EvidenceLevel;
}

export interface ScoreFactor {
  /** Stable key, e.g. `authority`, `recency`, `lane.aging-omics`, `event.approval`. */
  key: string;
  /** UI-ready label, e.g. "Phase 3 readout". */
  label: string;
  raw: number;
  weight: number;
  /** Signed points contributed to the total. */
  contribution: number;
  evidence?: string[];
}

export interface ScoreBreakdown {
  total: number;
  factors: ScoreFactor[];
  penalties: ScoreFactor[];
  laneScores: Record<FocusLane, number>;
  /** Hash of weights.json; golden tests pin this so weight edits fail loudly. */
  weightsVersion: string;
}

export type DigestSource = "extractive" | "abstract" | "dek";

/**
 * Article type within a journal feed. Nature's RSS mixes its newsroom and its
 * journal in one stream, so "came from Nature" says nothing about whether an
 * item is a paper. See pipeline/extract/article-class.ts.
 */
export type ArticleClass = "research" | "news-comment" | "notice" | "unknown";

export interface DigestItem {
  id: string;
  guid?: string;
  clusterId: string;
  title: string;
  url: string;
  canonicalUrl: string;
  sourceId: string;
  sourceName: string;
  publisherGroup: string;
  sourceKind: SourceKind;
  publishedAt?: string;
  datePrecision: "second" | "minute" | "day" | "unknown";
  /** First run that saw this URL — prevents fake freshness and drives "new". */
  firstSeenAt: string;
  isNew: boolean;
  paywalled: boolean;
  bodyProvenance: BodyProvenance;
  /** 1–3 sentences in document order. Never fabricated. */
  digest: string[];
  digestSource: DigestSource;
  keyFacts: KeyFacts;
  entities: Entities;
  eventTypes: EventType[];
  lanes: Partial<Record<FocusLane, number>>;
  primaryLane: FocusLane;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  watchHits: string[];
  isAcademic: boolean;
  /** Set for journal/preprint items; `unknown` when the feed gives no signal. */
  articleClass?: ArticleClass;
}

export interface Cluster {
  id: string;
  memberIds: string[];
  leadId: string;
  publisherGroups: string[];
  publisherCount: number;
  syndicated: boolean;
}

export type SourceStatus = "ok" | "not-modified" | "degraded" | "failed";

export interface SourceHealth {
  sourceId: string;
  sourceName: string;
  status: SourceStatus;
  httpStatus?: number;
  error?: string;
  itemsParsed: number;
  itemsKept: number;
  parseWarnings: string[];
  latencyMs: number;
  lastSuccessAt?: string;
  consecutiveFailures: number;
}

export type DropReason =
  | "no-title"
  | "no-url"
  | "excluded-url"
  | "too-old"
  | "duplicate"
  | "below-threshold"
  | "no-date"
  /** Correction, erratum or retraction notice — never a recommendation. */
  | "editorial-notice"
  /** Passed the score gate but lost to a per-source, per-lane or daily cap. */
  | "over-cap";

export interface WatchAlert {
  itemId: string;
  entryId: string;
  label: string;
  matched: string[];
  field: string;
}

export interface DailyDigest {
  schemaVersion: 2;
  date: string;
  runId?: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  health: SourceHealth[];
  /** Keyed by id — an item is stored once, never duplicated across lanes. */
  items: Record<string, DigestItem>;
  clusters: Cluster[];
  lanes: { id: FocusLane; label: string; blurb: string; itemIds: string[] }[];
  alerts: WatchAlert[];
  stats: {
    fetched: number;
    kept: number;
    clusters: number;
    medianScore: number;
    dropped: Partial<Record<DropReason, number>>;
  };
  emailedAt?: string;
}

export interface WeeklyTheme {
  label: string;
  terms: string[];
  docCount: number;
  lift: number;
  score: number;
  itemIds: string[];
}

export interface WeeklyRollup {
  schemaVersion: 2;
  week: string;
  start: string;
  end: string;
  generatedAt: string;
  themes: { status: "ok" | "warming-up"; weeksObserved: number; items: WeeklyTheme[] };
  tallies: {
    approvals: { itemId: string; title: string }[];
    crls: { itemId: string; title: string }[];
    readouts: { met: string[]; missed: string[]; mixed: string[] };
    ma: { count: number; totalUsdM: number; largest?: { itemId: string; usdM: number } };
    financings: { count: number; totalUsdM: number; byRound: Record<string, number> };
    newPhase3: { nct: string; title: string; sponsor?: string }[];
  };
  topClusters: { clusterId: string; leadItemId: string; publisherCount: number }[];
  preprintShift: { term: string; delta: number }[];
  degradedSources: string[];
  lexiconSuggestions: string[];
}

/** Slim, array-shaped search index. One row per item; see build-site-data.ts. */
export interface SearchIndex {
  year: number;
  buildId: string;
  cols: string[];
  sources: string[];
  lanes: FocusLane[];
  days: string[];
  rows: (string | number)[][];
}

export interface SiteManifest {
  latest: string;
  days: string[];
  weeks: string[];
  years: number[];
  buildId: string;
  generatedAt: string;
}

export interface RunStatus {
  runId?: string;
  startedAt: string;
  finishedAt: string;
  outcome: "ok" | "unusable" | "error";
  message?: string;
  date?: string;
  sourcesOk: number;
  sourcesTotal: number;
  itemsKept: number;
}

/* ------------------------------- watchlist -------------------------------- */

export type WatchKind =
  | "company"
  | "ticker"
  | "drug"
  | "target"
  | "author"
  | "keyword";

export interface WatchEntry {
  id: string;
  label?: string;
  kind: WatchKind;
  priority?: "high" | "normal";
  alertMinScore?: number;
  topics?: FocusLane[];
  fields?: string[];
  match: {
    any?: string[];
    tickers?: string[];
    regex?: string[];
    deny?: string[];
  };
}

export interface Watchlist {
  version: number;
  defaults: { alertMinScore: number; fields: string[] };
  entries: WatchEntry[];
}
