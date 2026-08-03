import {
  LaneSection,
  SourceHealthStrip,
  StalenessBanner,
  WatchAlertPanel,
} from "@/components/digest";
import { latestDigest, listDigestDates, readRunStatus } from "@/lib/data/repo";
import { formatDay, formatDateTime } from "@/lib/format";
import { routes } from "@/lib/paths";

/**
 * Today's digest, read from committed JSON at build time.
 *
 * The previous version awaited getSummary() here, which fired ~10 feeds and up
 * to 240 article fetches on every render. Under `output: 'export'` that would
 * run at build time from a GitHub Actions IP — and get 403'd.
 */
export default function HomePage() {
  const digest = latestDigest();
  const runStatus = readRunStatus();
  const dates = listDigestDates();

  if (!digest) {
    return (
      <main>
        <section className="hero-panel">
          <div className="hero-card">
            <span className="eyebrow">Biotech Insights</span>
            <h1>No digest yet</h1>
            <p>
              Run <code>npm run pipeline</code> locally, or trigger the{" "}
              <strong>Digest pipeline</strong> workflow from the Actions tab, and this page will fill
              in on the next build.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const previous = dates[1];

  return (
    <main>
      <StalenessBanner digestDate={digest.date} runStatus={runStatus} />

      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Daily digest · {formatDay(`${digest.date}T12:00:00Z`)}</span>
          <h1>What moved in biotech</h1>
          <p>
            {digest.stats.kept} items kept from {digest.stats.fetched} fetched, ranked by source
            authority, recency, topic match, event type and cross-outlet corroboration.
          </p>
          <SourceHealthStrip health={digest.health} />
          <div className="hero-links">
            <a href={routes.archive()}>Browse the archive</a>
            {previous ? <a href={routes.digest(previous)}>← {formatDay(`${previous}T12:00:00Z`)}</a> : null}
          </div>
        </div>
      </section>

      <WatchAlertPanel alerts={digest.alerts} digest={digest} />

      {digest.lanes.map((lane) => (
        <LaneSection
          key={lane.id}
          lane={lane}
          digest={digest}
          items={lane.itemIds
            .map((id) => digest.items[id])
            .filter((item): item is NonNullable<typeof item> => Boolean(item))}
        />
      ))}

      <section className="footer-panel">
        <div className="footer-card">
          <h2>How this is ranked</h2>
          <p>
            No model reads these articles. Each item is scored by a transparent weighted sum — source
            authority, exponential recency decay tuned per topic, a saturating keyword match, an event
            boost for approvals and readouts and M&amp;A, corroboration across independent publishers,
            and your watchlist. Open <em>why this ranked</em> on any card to see the arithmetic.
          </p>
          <p className="footer-meta">
            Generated {formatDateTime(digest.generatedAt)} · window from{" "}
            {formatDateTime(digest.windowStart)} · median score {digest.stats.medianScore}
          </p>
        </div>
      </section>
    </main>
  );
}
