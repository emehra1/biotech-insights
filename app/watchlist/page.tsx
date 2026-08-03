import yaml from "js-yaml";

import { Badge, InfoChip } from "@/components/digest";
import { latestDigest, readWatchlistYaml } from "@/lib/data/repo";
import type { Watchlist } from "@/lib/types";

export const metadata = { title: "Watchlist — Biotech Insights" };

export default function WatchlistPage() {
  const raw = readWatchlistYaml();
  const watchlist = raw ? (yaml.load(raw) as Watchlist) : undefined;
  const digest = latestDigest();

  const hitCounts = new Map<string, number>();
  for (const alert of digest?.alerts ?? []) {
    hitCounts.set(alert.entryId, (hitCounts.get(alert.entryId) ?? 0) + 1);
  }

  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Configuration</span>
          <h1>Watchlist</h1>
          <p>
            Edit <code>config/watchlist.yml</code> — from github.com on your phone if you like. It
            drives the alerts on the digest, the pinned block in the email, and a score boost.
          </p>
          <p className="tiny-note">
            This site is publicly readable even from a private repo. Terms you would rather not
            publish belong in the <code>WATCHLIST_PRIVATE</code> secret, which affects the email only.
          </p>
        </div>
      </section>

      <section>
        <div className="grid grid-2">
          {(watchlist?.entries ?? []).map((entry) => {
            const hits = hitCounts.get(entry.id) ?? 0;
            return (
              <article className="card" key={entry.id}>
                <div className="item-header">
                  <div className="item-source">
                    <Badge>{entry.kind}</Badge>
                    {entry.priority === "high" ? <Badge tone="alert">always alert</Badge> : null}
                  </div>
                  <span className="section-note">
                    {hits > 0 ? `${hits} hit${hits === 1 ? "" : "s"} today` : "no hits today"}
                  </span>
                </div>
                <h3 className="item-title">{entry.label ?? entry.id}</h3>
                <div className="tag-row">
                  {(entry.match.any ?? []).slice(0, 8).map((term) => (
                    <InfoChip key={term}>{term}</InfoChip>
                  ))}
                  {(entry.match.tickers ?? []).map((ticker) => (
                    <InfoChip key={ticker}>${ticker}</InfoChip>
                  ))}
                </div>
                {entry.match.deny?.length ? (
                  <p className="tiny-note">excludes: {entry.match.deny.join(", ")}</p>
                ) : null}
                {entry.topics?.length ? (
                  <p className="tiny-note">only in: {entry.topics.join(", ")}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="footer-panel">
        <div className="footer-card">
          <h2>How alerts fire</h2>
          <p>
            An entry alerts when it matches, no <code>deny</code> term appears, the item is in scope
            for the entry’s topics, and the item is <strong>first seen today</strong> — so a story
            resurfacing in another outlet’s feed next week will not alert twice. Entries marked{" "}
            <code>priority: high</code> skip the score threshold; everything else needs to clear{" "}
            <code>alertMinScore</code>.
          </p>
        </div>
      </section>
    </main>
  );
}
