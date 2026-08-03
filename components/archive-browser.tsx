"use client";

import { useEffect, useMemo, useState } from "react";

import { formatShortDay } from "@/lib/format";
import { dataUrl, routes } from "@/lib/paths";
import type { SearchIndex } from "@/lib/types";

/**
 * Client-side archive search.
 *
 * There is no server, so all filtering happens here — but we never ship full
 * digests to the browser. The index is arrays, not objects (~140 bytes a row,
 * so a year of ~80 items/day gzips to a few hundred KB), and each result links
 * to the prerendered /digest/<date>/#<id> page instead of fetching that day's
 * JSON. Older years load only when the filter reaches them.
 */

const LANE_LABELS: Record<string, string> = {
  "clinical-regulatory": "Clinical & Regulatory",
  "business-deals": "Business & Deals",
  "frontier-science": "Frontier Science",
  "aging-omics": "Aging & Omics",
};

interface Row {
  date: string;
  source: string;
  lane: string;
  score: number;
  watched: boolean;
  title: string;
  id: string;
}

function toRows(index: SearchIndex): Row[] {
  return index.rows.map((row) => ({
    date: index.days[Number(row[0])] ?? "",
    source: index.sources[Number(row[1])] ?? "",
    lane: index.lanes[Number(row[2])] ?? "",
    score: Number(row[3]),
    watched: Number(row[4]) === 1,
    title: String(row[5] ?? ""),
    id: String(row[6] ?? ""),
  }));
}

export function ArchiveBrowser({ years }: { years: number[] }) {
  const [loadedYears, setLoadedYears] = useState<number[]>(years.slice(0, 1));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("");
  const [source, setSource] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [watchedOnly, setWatchedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      loadedYears.map((year) =>
        fetch(dataUrl(`/data/search-${year}.json`)).then((response) => {
          if (!response.ok) throw new Error(`search-${year}.json → HTTP ${response.status}`);
          return response.json() as Promise<SearchIndex>;
        }),
      ),
    )
      .then((indexes) => {
        if (cancelled) return;
        setRows(indexes.flatMap(toRows));
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadedYears]);

  const sources = useMemo(() => [...new Set(rows.map((row) => row.source))].sort(), [rows]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return rows
      .filter((row) => {
        if (lane && row.lane !== lane) return false;
        if (source && row.source !== source) return false;
        if (row.score < minScore) return false;
        if (watchedOnly && !row.watched) return false;
        if (terms.length === 0) return true;
        const haystack = `${row.title} ${row.source}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((a, b) => (a.date === b.date ? b.score - a.score : a.date < b.date ? 1 : -1))
      .slice(0, 400);
  }, [rows, query, lane, source, minScore, watchedOnly]);

  const remainingYears = years.filter((year) => !loadedYears.includes(year));

  return (
    <div className="archive">
      <div className="filter-bar card">
        <input
          type="search"
          className="filter-input"
          placeholder="Search titles…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search archived items"
        />
        <select value={lane} onChange={(event) => setLane(event.target.value)} aria-label="Topic">
          <option value="">All topics</option>
          {Object.entries(LANE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {sources.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="filter-range">
          min score {minScore}
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value))}
          />
        </label>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={watchedOnly}
            onChange={(event) => setWatchedOnly(event.target.checked)}
          />
          watchlist only
        </label>
      </div>

      {error ? (
        <p className="error-note">Could not load the search index: {error}</p>
      ) : loading ? (
        <p className="tiny-note">Loading index…</p>
      ) : (
        <>
          <p className="tiny-note">
            {filtered.length} of {rows.length} items
            {loadedYears.length === 1 ? ` in ${loadedYears[0]}` : ""}
          </p>
          <ul className="result-list">
            {filtered.map((row) => (
              <li key={`${row.date}-${row.id}`} className="result-row">
                <a href={`${routes.digest(row.date)}#${row.id}`}>
                  <span className="result-score">{row.score}</span>
                  <span className="result-title">{row.title}</span>
                </a>
                <span className="result-meta">
                  {row.source} · {formatShortDay(`${row.date}T12:00:00Z`)} ·{" "}
                  {LANE_LABELS[row.lane] ?? row.lane}
                  {row.watched ? " · watchlist" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {remainingYears.length > 0 ? (
        <button
          type="button"
          className="load-more"
          onClick={() => setLoadedYears([...loadedYears, ...remainingYears])}
        >
          Load {remainingYears.join(", ")}
        </button>
      ) : null}
    </div>
  );
}
