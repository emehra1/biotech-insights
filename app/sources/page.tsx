import { SOURCES } from "@/pipeline/config/sources";
import { latestDigest } from "@/lib/data/repo";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Sources — Biotech Insights" };

/**
 * Feed rot is the failure mode that quietly guts a digest: four of the previous
 * version's ten feeds had died and every one of them just rendered an empty
 * section. This page makes that visible.
 */
export default function SourcesPage() {
  const digest = latestDigest();
  const health = new Map((digest?.health ?? []).map((entry) => [entry.sourceId, entry]));

  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Diagnostics</span>
          <h1>Source health</h1>
          <p>
            Status from the most recent run{digest ? ` (${formatDateTime(digest.generatedAt)})` : ""}.
            “Degraded” means the feed answered but gave us nothing usable — the shape that used to go
            unnoticed for months.
          </p>
        </div>
      </section>

      <section>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Items</th>
                <th>Last success</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((source) => {
                const entry = health.get(source.id);
                const status = entry?.status ?? (source.enabled ? "unknown" : "disabled");
                return (
                  <tr key={source.id} className={`status-${status}`}>
                    <td>
                      <a href={source.homepage} target="_blank" rel="noreferrer noopener">
                        {source.name}
                      </a>
                      {source.paywalled ? <span className="tiny-note"> paywalled</span> : null}
                    </td>
                    <td>{source.kind}</td>
                    <td>
                      <span className={`status-dot status-dot-${status}`} aria-hidden="true" />
                      {status}
                    </td>
                    <td>{entry?.itemsKept ?? "—"}</td>
                    <td>{entry?.lastSuccessAt ? formatDateTime(entry.lastSuccessAt) : "—"}</td>
                    <td className="notes-cell">
                      {entry?.error ? <span className="error-note">{entry.error}</span> : null}
                      {entry?.parseWarnings.length ? entry.parseWarnings.join(", ") : null}
                      {!entry?.error && !entry?.parseWarnings.length ? source.note ?? "" : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="footer-panel">
        <div className="footer-card">
          <h2>When something breaks</h2>
          <p>
            Run <code>npx tsx scripts/check-sources.ts</code> to see exactly what each feed returned.
            A feed that 403s from CI but works locally is a WAF blocking the datacenter IP, not a bug
            — the fix is to drop that source to feed-only, not to change code.
          </p>
        </div>
      </section>
    </main>
  );
}
