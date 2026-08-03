import { readFileSync } from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { FOCUS_LANES, type Entities, type FocusLane, type WatchEntry, type Watchlist } from "../../lib/types";

/**
 * Watchlist matching.
 *
 * The rules that keep alerts from becoming noise:
 *  - short tokens must come from `tickers` and match case-sensitively, or "KL"
 *    and "MS" fire on everything;
 *  - `deny` terms veto (so "Vertex AI" never alerts a Vertex Pharma watcher);
 *  - an item only alerts the day it is FIRST SEEN, so a story resurfacing in
 *    another outlet's feed a week later doesn't re-alert.
 */

export interface WatchHit {
  entryId: string;
  label: string;
  matched: string[];
  field: string;
  priority: boolean;
  minScore: number;
}

export interface CompiledEntry {
  entry: WatchEntry;
  label: string;
  patterns: { re: RegExp; term: string; field: string }[];
  deny: RegExp[];
  topics?: FocusLane[];
  priority: boolean;
  minScore: number;
}

export function loadWatchlist(filePath = "config/watchlist.yml"): Watchlist {
  const raw = readFileSync(path.resolve(filePath), "utf8");
  const parsed = yaml.load(raw) as Watchlist;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    throw new Error(`watchlist: ${filePath} is missing an entries array`);
  }
  return {
    version: parsed.version ?? 1,
    defaults: {
      alertMinScore: parsed.defaults?.alertMinScore ?? 55,
      fields: parsed.defaults?.fields ?? ["title", "body", "entities"],
    },
    entries: parsed.entries,
  };
}

/** Merge the committed watchlist with an optional private overlay from a secret. */
export function loadWatchlistWithPrivate(filePath?: string): Watchlist {
  const base = loadWatchlist(filePath);
  const secret = process.env.WATCHLIST_PRIVATE;
  if (!secret) return base;
  try {
    const extra = yaml.load(secret) as Partial<Watchlist>;
    if (extra && Array.isArray(extra.entries)) {
      return { ...base, entries: [...base.entries, ...extra.entries] };
    }
  } catch {
    console.warn("watchlist: WATCHLIST_PRIVATE could not be parsed; ignoring it");
  }
  return base;
}

export function compileWatchlist(watchlist: Watchlist): CompiledEntry[] {
  return watchlist.entries.map((entry) => {
    const patterns: CompiledEntry["patterns"] = [];

    for (const term of entry.match.any ?? []) {
      // Anything under four characters is too short to match case-insensitively.
      if (term.length < 4) continue;
      patterns.push({ re: new RegExp(`\\b${escapeRegExp(term)}\\b`, "i"), term, field: "text" });
    }
    for (const ticker of entry.match.tickers ?? []) {
      patterns.push({ re: new RegExp(`\\b${escapeRegExp(ticker)}\\b`), term: ticker, field: "ticker" });
    }
    for (const source of entry.match.regex ?? []) {
      try {
        patterns.push({ re: new RegExp(source, "i"), term: source, field: "regex" });
      } catch {
        console.warn(`watchlist: entry ${entry.id} has an invalid regex: ${source}`);
      }
    }

    return {
      entry,
      label: entry.label ?? entry.id,
      patterns,
      deny: (entry.match.deny ?? []).map((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i")),
      topics: entry.topics?.filter((t): t is FocusLane => (FOCUS_LANES as readonly string[]).includes(t)),
      priority: entry.priority === "high",
      minScore: entry.alertMinScore ?? watchlist.defaults.alertMinScore,
    };
  });
}

export interface MatchInput {
  title: string;
  body: string;
  entities: Entities;
  lane: FocusLane;
}

export function matchWatchlist(compiled: CompiledEntry[], input: MatchInput): WatchHit[] {
  const text = `${input.title}\n${input.body}`;
  const entityText = [
    ...input.entities.companies.map((c) => `${c.canonical} ${c.ticker ?? ""}`),
    ...input.entities.drugs.map((d) => d.text),
    ...input.entities.targets.map((t) => t.canonical),
    ...input.entities.indications.map((i) => i.canonical),
  ].join(" ");

  const hits: WatchHit[] = [];

  for (const compiledEntry of compiled) {
    if (compiledEntry.topics && !compiledEntry.topics.includes(input.lane)) continue;
    if (compiledEntry.deny.some((re) => re.test(text))) continue;

    const matched: string[] = [];
    let field = "text";
    for (const pattern of compiledEntry.patterns) {
      const haystack = pattern.field === "ticker" ? `${text} ${entityText}` : `${text} ${entityText}`;
      if (pattern.re.test(haystack)) {
        matched.push(pattern.term);
        field = pattern.field;
      }
    }

    if (matched.length === 0) continue;
    hits.push({
      entryId: compiledEntry.entry.id,
      label: compiledEntry.label,
      matched: matched.slice(0, 4),
      field,
      priority: compiledEntry.priority,
      minScore: compiledEntry.minScore,
    });
  }

  return hits;
}

/** Alert gate: novelty first, then the score bar (bypassed by priority: high). */
export function shouldAlert(hit: WatchHit, score: number, isNew: boolean): boolean {
  if (!isNew) return false;
  if (hit.priority) return true;
  return score >= hit.minScore;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
