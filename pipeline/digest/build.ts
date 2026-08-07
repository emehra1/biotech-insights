import {
  FOCUS_LANES,
  LANE_BLURBS,
  LANE_LABELS,
  type ArticleClass,
  type DailyDigest,
  type DigestItem,
  type DropReason,
  type FocusLane,
  type SourceHealth,
  type WatchAlert,
} from "../../lib/types";
import { MAJOR_JOURNAL_SOURCES } from "../config/lanes";
import { clusterItems, type ClusterCandidate } from "../cluster";
import { classifyArticle, earnsMajorJournalBoost } from "../extract/article-class";
import { extractEntities } from "../extract/entities";
import { buildKeyFacts, detectEventTypes } from "../extract/facts";
import type { NormalizedItem } from "../ingest/types";
import { itemId } from "../normalize/ids";
import { isTooOld, scoreItem, WEIGHTS, WEIGHTS_VERSION, type Weights } from "../score";
import { summarize } from "../summarize";
import type { SeenStore } from "../state/store";
import { matchWatchlist, shouldAlert, type CompiledEntry } from "../watchlist";

/**
 * Assembles the day's digest: extract → cluster → score → summarize → select.
 *
 * Items below the keep threshold are never stored as objects — only their ids
 * land in the seen store. That keeps junk out of the repo permanently instead of
 * accumulating a few hundred low-value records a day forever.
 */

export interface BuildOptions {
  date: string;
  now: Date;
  windowStart: Date;
  health: SourceHealth[];
  watchlist: CompiledEntry[];
  seen: SeenStore;
  /** Ids delivered by a recent digest — see recentlyDelivered(). */
  delivered: Set<string>;
  weights?: Weights;
  runId?: string;
}

export interface BuildResult {
  digest: DailyDigest;
  unknownEntities: Map<string, number>;
}

const UNKNOWN_CANDIDATE =
  /\b([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,2})\b(?=[^.]{0,40}\b(?:announced|said|acquired|raised|reported|CEO|shares|Inc\.?|Corp\.?)\b)/g;

export function buildDigest(items: NormalizedItem[], options: BuildOptions): BuildResult {
  const weights = options.weights ?? WEIGHTS;
  const dropped: Partial<Record<DropReason, number>> = {};
  const drop = (reason: DropReason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };

  /* ---- dedupe by canonical URL, keeping the highest-authority copy ---- */
  const byId = new Map<string, NormalizedItem>();
  for (const item of items) {
    if (!item.title) {
      drop("no-title");
      continue;
    }
    if (!item.canonicalUrl) {
      drop("no-url");
      continue;
    }
    const id = itemId(item.canonicalUrl);
    const existing = byId.get(id);
    if (existing) {
      drop("duplicate");
      if (item.authority > existing.authority || item.bodyText.length > existing.bodyText.length * 1.5) {
        byId.set(id, item);
      }
      continue;
    }
    byId.set(id, item);
  }

  /* ---- extract entities and facts ---- */
  interface Enriched {
    id: string;
    item: NormalizedItem;
    articleClass: ArticleClass;
    entities: ReturnType<typeof extractEntities>;
    facts: ReturnType<typeof buildKeyFacts>;
    events: ReturnType<typeof detectEventTypes>;
  }

  const enriched: Enriched[] = [];
  const unknownEntities = new Map<string, number>();

  for (const [id, item] of byId) {
    const isAcademic = item.sourceKind === "journal" || item.sourceKind === "preprint";
    const articleClass = classifyArticle({
      title: item.title,
      url: item.canonicalUrl,
      doi: item.doi,
    });
    // "Author Correction: …" is not a paper recommendation. Four of them reached
    // the digest over three runs, one of them twice.
    if (isAcademic && articleClass === "notice") {
      drop("editorial-notice");
      continue;
    }

    const input = { title: item.title, body: item.bodyText };
    const entities = extractEntities(input, item.nctIds);
    const facts = buildKeyFacts({
      title: item.title,
      body: item.bodyText,
      entities,
      sourceKind: item.sourceKind,
      authority: item.authority,
      nctIds: item.nctIds,
    });
    const events = detectEventTypes(facts, `${item.title}. ${item.bodyText}`, {
      largeDealThresholdUsdM: weights.largeDealThresholdUsdM,
      // The boost is named "-primary" and now means it: Nature's feed is 59%
      // newsroom, and every one of those items used to collect it.
      isMajorJournal:
        MAJOR_JOURNAL_SOURCES.has(item.sourceId) &&
        item.sourceKind === "journal" &&
        earnsMajorJournalBoost(articleClass),
      isPreprint: item.sourceKind === "preprint",
    });

    enriched.push({ id, item, articleClass, entities, facts, events });
    collectUnknownEntities(item, entities, unknownEntities);
  }

  /* ---- cluster ---- */
  const candidates: ClusterCandidate[] = enriched.map((entry) => ({
    id: entry.id,
    title: entry.item.title,
    canonicalUrl: entry.item.canonicalUrl,
    publisherGroup: entry.item.publisherGroup,
    publishedAt: entry.item.publishedAt,
    entities: entry.entities,
    authority: entry.item.authority,
    bodyLength: entry.item.bodyText.length,
    sourceKind: entry.item.sourceKind,
  }));
  const { clusters, clusterOf } = clusterItems(candidates);
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  /* ---- score, summarize, gate ---- */
  const scored: DigestItem[] = [];
  const alerts: WatchAlert[] = [];

  for (const entry of enriched) {
    const clusterKey = clusterOf.get(entry.id);
    const cluster = clusterKey ? clusterById.get(clusterKey) : undefined;
    const publisherCount = cluster?.publisherCount ?? 1;

    // Claimed before scoring, because the score now carries a penalty for an
    // item an earlier digest already delivered. Every item that reaches this loop
    // is recorded exactly once, whichever way it exits — that is what keeps
    // "first seen" from drifting into "first seen and also kept".
    const { date: firstSeenAt, isNew } = options.seen.firstSeen(entry.id, options.date);
    const deliveredBefore = options.delivered.has(entry.id);

    // Provisional lane so the watchlist's topic filter has something to read.
    const provisional = scoreItem({
      item: entry.item,
      facts: entry.facts,
      events: entry.events,
      publisherCount,
      watchHits: [],
      now: options.now,
      weights,
      deliveredBefore,
    });

    const hits = matchWatchlist(options.watchlist, {
      title: entry.item.title,
      body: entry.item.bodyText,
      entities: entry.entities,
      lane: provisional.primaryLane,
    });

    const scoreResult =
      hits.length > 0
        ? scoreItem({
            item: entry.item,
            facts: entry.facts,
            events: entry.events,
            publisherCount,
            watchHits: hits.map((h) => ({ entryId: h.entryId, label: h.label, priority: h.priority })),
            now: options.now,
            weights,
            deliveredBefore,
          })
        : provisional;

    if (
      isTooOld(
        entry.item.publishedAt,
        scoreResult.primaryLane,
        options.now,
        weights,
        entry.item.sourceKind === "journal" || entry.item.sourceKind === "preprint",
      )
    ) {
      drop("too-old");
      continue;
    }
    // Deliberately no drop("no-date") here: this item is about to be KEPT, and a
    // counter in `dropped` that also counts kept items is why the stats never
    // added up. The per-item signal is better anyway — `datePrecision` is
    // "unknown" and the `dateMissing` penalty is in the score breakdown.

    if (scoreResult.score < weights.keepThreshold && !hits.some((h) => h.priority)) {
      drop("below-threshold");
      continue;
    }

    const summary = summarize({
      title: entry.item.title,
      body: entry.item.bodyText,
      provenance: entry.item.bodyProvenance,
      lane: scoreResult.primaryLane,
      entities: entry.entities,
    });

    const watchHits: string[] = [];
    for (const hit of hits) {
      watchHits.push(hit.entryId);
      if (shouldAlert(hit, scoreResult.score, isNew)) {
        alerts.push({
          itemId: entry.id,
          entryId: hit.entryId,
          label: hit.label,
          matched: hit.matched,
          field: hit.field,
        });
      }
    }

    scored.push({
      id: entry.id,
      guid: entry.item.guid,
      clusterId: clusterKey ?? entry.id,
      title: entry.item.title,
      url: entry.item.url,
      canonicalUrl: entry.item.canonicalUrl,
      sourceId: entry.item.sourceId,
      sourceName: entry.item.sourceName,
      publisherGroup: entry.item.publisherGroup,
      sourceKind: entry.item.sourceKind,
      publishedAt: entry.item.publishedAt?.toISOString(),
      datePrecision: entry.item.datePrecision,
      firstSeenAt,
      isNew,
      paywalled: entry.item.paywalled,
      bodyProvenance: entry.item.bodyProvenance,
      digest: summary.digest,
      digestSource: summary.source,
      keyFacts: entry.facts,
      entities: entry.entities,
      eventTypes: entry.events,
      lanes: scoreResult.lanes,
      primaryLane: scoreResult.primaryLane,
      score: scoreResult.score,
      scoreBreakdown: scoreResult.breakdown,
      watchHits,
      isAcademic: entry.item.sourceKind === "journal" || entry.item.sourceKind === "preprint",
      articleClass: entry.articleClass,
    });
  }

  /* ---- select: one card per cluster, balanced across lanes ----
   *
   * Selection is lane-balanced on purpose. A pure global top-N lets one lane
   * eat the digest: Europe PMC returns 50 dense abstracts a day, and long
   * abstracts naturally out-score a two-sentence news dek on lexicon match, so
   * a straight sort buries the day's biggest M&A story under review articles.
   * Round-robin by lane first, then fill any leftover slots globally.
   */
  scored.sort((a, b) => b.score - a.score);

  const seenClusters = new Set<string>();
  const perSource = new Map<string, number>();
  const perPublisher = new Map<string, number>();
  // Europe PMC alone returns 50 dense abstracts a day; without a per-source cap
  // it fills its whole lane and the digest stops feeling curated.
  const maxPerSource = Math.max(5, Math.floor(weights.maxItemsPerDay / 10));

  const byLane = new Map<FocusLane, DigestItem[]>();
  for (const lane of FOCUS_LANES) byLane.set(lane, []);
  for (const item of scored) {
    if (seenClusters.has(item.clusterId)) {
      // A second outlet's telling of a story already represented.
      drop("duplicate");
      continue;
    }
    const used = perSource.get(item.sourceId) ?? 0;
    if (used >= maxPerSource) {
      drop("over-cap");
      continue;
    }
    // The per-source cap alone stopped counting once Springer Nature had a dozen
    // feeds in the registry: twelve sub-journals at 8 apiece is 96 candidates
    // from one publisher for an 80-item digest. Corroboration is already counted
    // per publisherGroup, so the ceiling belongs there too.
    const publisherUsed = perPublisher.get(item.publisherGroup) ?? 0;
    if (publisherUsed >= weights.maxItemsPerPublisher) {
      drop("over-cap");
      continue;
    }
    seenClusters.add(item.clusterId);
    perSource.set(item.sourceId, used + 1);
    perPublisher.set(item.publisherGroup, publisherUsed + 1);
    byLane.get(item.primaryLane)?.push(item);
  }

  const kept: DigestItem[] = [];
  const cursors = new Map<FocusLane, number>(FOCUS_LANES.map((lane) => [lane, 0]));
  let progress = true;
  while (kept.length < weights.maxItemsPerDay && progress) {
    progress = false;
    for (const lane of FOCUS_LANES) {
      if (kept.length >= weights.maxItemsPerDay) break;
      const cursor = cursors.get(lane) ?? 0;
      const laneItems = byLane.get(lane) ?? [];
      if (cursor >= Math.min(laneItems.length, weights.maxItemsPerLane)) continue;
      const next = laneItems[cursor];
      cursors.set(lane, cursor + 1);
      if (next) {
        kept.push(next);
        progress = true;
      }
    }
  }

  // Items that cleared every quality gate and still never got a slot, because
  // the day or the lane was full. Counting them is the difference between stats
  // that add up and stats that read "346 fetched, 80 kept" and silently lose
  // the other 207 — which is what made the caps invisible in the first place.
  const keptIdSet = new Set(kept.map((item) => item.id));
  for (const laneItems of byLane.values()) {
    for (const item of laneItems) if (!keptIdSet.has(item.id)) drop("over-cap");
  }

  const lanes = FOCUS_LANES.map((lane) => ({
    id: lane,
    label: LANE_LABELS[lane],
    blurb: LANE_BLURBS[lane],
    itemIds: kept
      .filter((item) => item.primaryLane === lane)
      .sort((a, b) => b.score - a.score)
      .slice(0, weights.maxItemsPerLane)
      .map((item) => item.id),
  }));

  const keptIds = new Set(lanes.flatMap((lane) => lane.itemIds));
  const itemsById: Record<string, DigestItem> = {};
  for (const item of kept) {
    if (keptIds.has(item.id)) itemsById[item.id] = item;
  }

  const finalAlerts = alerts.filter((alert) => itemsById[alert.itemId]);
  const scores = Object.values(itemsById).map((item) => item.score).sort((a, b) => a - b);

  const digest: DailyDigest = {
    schemaVersion: 2,
    date: options.date,
    runId: options.runId,
    generatedAt: options.now.toISOString(),
    windowStart: options.windowStart.toISOString(),
    windowEnd: options.now.toISOString(),
    health: options.health,
    items: itemsById,
    clusters: clusters.filter((cluster) => cluster.memberIds.some((id) => itemsById[id])),
    lanes,
    alerts: finalAlerts,
    stats: {
      fetched: items.length,
      kept: Object.keys(itemsById).length,
      clusters: clusters.length,
      medianScore: scores.length ? scores[Math.floor(scores.length / 2)] ?? 0 : 0,
      dropped,
    },
  };

  return { digest, unknownEntities };
}

function collectUnknownEntities(
  item: NormalizedItem,
  entities: ReturnType<typeof extractEntities>,
  counts: Map<string, number>,
): void {
  const known = new Set(entities.companies.map((c) => c.text));
  const text = `${item.title}. ${item.bodyText.slice(0, 1500)}`;
  for (const match of text.matchAll(UNKNOWN_CANDIDATE)) {
    const phrase = match[1];
    if (!phrase || phrase.length < 4 || known.has(phrase)) continue;
    if (/^(The|This|That|These|Those|A|An|In|On|At|For|But|And|However|Meanwhile)\b/.test(phrase)) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
}

export { WEIGHTS_VERSION };
