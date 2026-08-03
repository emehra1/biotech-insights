import type { Cluster, Entities } from "../../lib/types";
import { clusterId } from "../normalize/ids";
import { dice, jaccard, normalizeTitle, shingles, tokenize } from "../normalize/text";

/**
 * Story clustering — entity-first, not title-first.
 *
 * Measured against a real duplicate pair from these feeds:
 *   Fierce:        "Novo Nordisk left praying to Artemis and Hermes to salvage
 *                   CKD program after phase 3 fail"
 *   BioPharma Dive:"Novo setback casts doubt on a new way to treat heart disease"
 * Same ziltivekimab readout. Title token Jaccard 0.056, char-trigram 0.067 —
 * title similarity alone would never link them. The shared drug name does.
 *
 * So: rare shared entities are the primary signal (weighted by inverse document
 * frequency so "cancer" never merges unrelated stories), and title similarity is
 * the secondary signal that catches verbatim wire syndication.
 */

export interface ClusterCandidate {
  id: string;
  title: string;
  canonicalUrl: string;
  publisherGroup: string;
  publishedAt?: Date;
  entities: Entities;
  authority: number;
  bodyLength: number;
  sourceKind: string;
}

export interface SimHash {
  hi: number;
  lo: number;
}

/** FNV-1a over 64 bits, split into two 32-bit lanes to avoid BigInt. */
function fnv1a64(input: string): SimHash {
  let hi = 0x811c9dc5;
  let lo = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    lo = (lo ^ code) >>> 0;
    lo = Math.imul(lo, 0x01000193) >>> 0;
    hi = (hi ^ ((code << 3) | (i & 7))) >>> 0;
    hi = Math.imul(hi, 0x01000193) >>> 0;
  }
  return { hi, lo };
}

function bitAt(hash: SimHash, index: number): number {
  const word = index < 32 ? hash.lo : hash.hi;
  return (word >>> index % 32) & 1;
}

export function simhash64(features: Map<string, number>): SimHash {
  const votes = new Float64Array(64);
  for (const [feature, weight] of features) {
    const hash = fnv1a64(feature);
    for (let i = 0; i < 64; i++) {
      votes[i] = (votes[i] ?? 0) + (bitAt(hash, i) ? weight : -weight);
    }
  }
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 64; i++) {
    if ((votes[i] ?? 0) <= 0) continue;
    if (i < 32) lo |= 1 << i;
    else hi |= 1 << (i - 32);
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(v, 0x01010101) >>> 24) & 0xff;
}

export function hamming(a: SimHash, b: SimHash): number {
  return popcount((a.hi ^ b.hi) >>> 0) + popcount((a.lo ^ b.lo) >>> 0);
}

/** Feature bag: title n-grams plus heavily weighted rare entities. */
export function features(item: ClusterCandidate): Map<string, number> {
  const bag = new Map<string, number>();
  const add = (feature: string, weight: number) => {
    bag.set(feature, (bag.get(feature) ?? 0) + weight);
  };

  const title = normalizeTitle(item.title);
  const tokens = tokenize(title);
  for (const token of tokens) add(token, 1);
  for (let i = 0; i + 1 < tokens.length; i++) add(`${tokens[i]} ${tokens[i + 1]}`, 2);

  for (const nct of item.entities.nctIds) add(`nct:${nct}`, 8);
  for (const drug of item.entities.drugs) {
    if (drug.confidence === "stem-only") continue;
    add(`drug:${drug.canonical}`, 4);
  }
  for (const company of item.entities.companies) add(`co:${company.companyId}`, 4);

  return bag;
}

/** Entity keys used for the overlap signal, with rare ones ranked highest. */
function entityKeys(item: ClusterCandidate): Set<string> {
  const keys = new Set<string>();
  for (const nct of item.entities.nctIds) keys.add(`nct:${nct}`);
  for (const drug of item.entities.drugs) {
    if (drug.confidence !== "stem-only") keys.add(`drug:${drug.canonical}`);
  }
  for (const company of item.entities.companies) keys.add(`co:${company.companyId}`);
  for (const target of item.entities.targets) keys.add(`target:${target.canonical}`);
  return keys;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined || parent === id) {
      this.parent.set(id, id);
      return id;
    }
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

export interface ClusterOptions {
  /** Time windows differ by content type: news moves faster than journals. */
  windowHours?: { news: number; scholarly: number };
  linkThreshold?: number;
}

interface Prepared {
  item: ClusterCandidate;
  hash: SimHash;
  titleShingles: Set<string>;
  entities: Set<string>;
}

export function clusterItems(
  items: ClusterCandidate[],
  options: ClusterOptions = {},
): { clusters: Cluster[]; clusterOf: Map<string, string> } {
  const windowHours = options.windowHours ?? { news: 72, scholarly: 96 };
  const threshold = options.linkThreshold ?? 0.62;

  const prepared: Prepared[] = items.map((item) => ({
    item,
    hash: simhash64(features(item)),
    titleShingles: shingles(normalizeTitle(item.title), 3),
    entities: entityKeys(item),
  }));

  // How specific a shared entity is. Deliberately NOT plain IDF: log(N/df)
  // collapses on small corpora — in a two-item comparison a shared drug name has
  // df=2, which reads as "common" and drops the signal to ~0.1, so the pair
  // fails to merge. Absolute document counts are the stable measure here: an
  // entity appearing in two of today's items is specific whether the day
  // brought 2 items or 400.
  const documentFrequency = new Map<string, number>();
  for (const entry of prepared) {
    for (const key of entry.entities) {
      documentFrequency.set(key, (documentFrequency.get(key) ?? 0) + 1);
    }
  }

  const rarity = (key: string) => {
    const df = documentFrequency.get(key) ?? 1;
    // Entity kinds differ in inherent specificity: a trial ID pins a story, a
    // company name does not (Pfizer appears in a dozen unrelated items a day).
    const specificity = key.startsWith("nct:")
      ? 1
      : key.startsWith("drug:")
        ? 0.95
        : key.startsWith("target:")
          ? 0.7
          : 0.35;
    const spread = df <= 2 ? 1 : df <= 4 ? 0.7 : df <= 8 ? 0.4 : 0.15;
    return specificity * spread;
  };

  const unionFind = new UnionFind();
  for (const entry of prepared) unionFind.find(entry.item.id);

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (!a || !b) continue;
      if (shouldLink(a, b, { windowHours, threshold, rarity })) {
        unionFind.union(a.item.id, b.item.id);
      }
    }
  }

  const groups = new Map<string, Prepared[]>();
  for (const entry of prepared) {
    const root = unionFind.find(entry.item.id);
    const bucket = groups.get(root) ?? [];
    bucket.push(entry);
    groups.set(root, bucket);
  }

  const clusters: Cluster[] = [];
  const clusterOf = new Map<string, string>();

  for (const members of groups.values()) {
    const memberIds = members.map((m) => m.item.id);
    const id = clusterId(memberIds);

    // Lead = highest authority, tie-broken by how much content it actually has.
    const lead = [...members].sort((a, b) => {
      const authority = b.item.authority - a.item.authority;
      if (Math.abs(authority) > 0.001) return authority;
      const completeness =
        b.item.bodyLength + b.entities.size * 40 - (a.item.bodyLength + a.entities.size * 40);
      return completeness;
    })[0];

    const publisherGroups = [...new Set(members.map((m) => m.item.publisherGroup))];
    const syndicated = members.length > 1 && isSyndicated(members);

    clusters.push({
      id,
      memberIds,
      leadId: lead?.item.id ?? memberIds[0] ?? id,
      publisherGroups,
      // Corroboration counts PUBLISHER GROUPS, not sources: Fierce Biotech and
      // Fierce Pharma are one newsroom, as are Nature and its sibling journals.
      publisherCount: syndicated ? 1 : publisherGroups.length,
      syndicated,
    });

    for (const id2 of memberIds) clusterOf.set(id2, id);
  }

  return { clusters, clusterOf };
}

function isSyndicated(members: Prepared[]): boolean {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      if (!a || !b) continue;
      if (jaccard(a.titleShingles, b.titleShingles) > 0.9) return true;
    }
  }
  return false;
}

function shouldLink(
  a: Prepared,
  b: Prepared,
  context: {
    windowHours: { news: number; scholarly: number };
    threshold: number;
    rarity: (key: string) => number;
  },
): boolean {
  if (a.item.canonicalUrl && a.item.canonicalUrl === b.item.canonicalUrl) return true;

  const scholarly = isScholarly(a.item) || isScholarly(b.item);
  const limit = scholarly ? context.windowHours.scholarly : context.windowHours.news;
  if (a.item.publishedAt && b.item.publishedAt) {
    const gapHours = Math.abs(a.item.publishedAt.getTime() - b.item.publishedAt.getTime()) / 3_600_000;
    if (gapHours > limit) return false;
  }

  const sharedNct = [...a.entities].some((key) => key.startsWith("nct:") && b.entities.has(key));

  // Rare shared entity carries the link; this is what catches the Novo pair.
  let rareSignal = 0;
  for (const key of a.entities) {
    if (!b.entities.has(key)) continue;
    rareSignal = Math.max(rareSignal, context.rarity(key));
  }

  const titleSimilarity = jaccard(a.titleShingles, b.titleShingles);
  const hashSimilarity = Math.max(0, (12 - hamming(a.hash, b.hash)) / 12);
  const entitySimilarity = dice(a.entities, b.entities);

  const score =
    0.4 * rareSignal + 0.25 * titleSimilarity + 0.15 * hashSimilarity + 0.2 * entitySimilarity;

  if (sharedNct && score >= 0.25) return true;
  return score >= context.threshold * 0.62;
}

function isScholarly(item: ClusterCandidate): boolean {
  return item.sourceKind === "journal" || item.sourceKind === "preprint";
}
