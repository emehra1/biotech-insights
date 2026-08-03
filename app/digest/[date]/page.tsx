import { notFound } from "next/navigation";

import { LaneSection, SourceHealthStrip, WatchAlertPanel } from "@/components/digest";
import { listDigestDates, readDigest } from "@/lib/data/repo";
import { formatDateTime, formatDay } from "@/lib/format";
import { routes } from "@/lib/paths";

/** Every archived day is prerendered; there is no server to render one on demand. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listDigestDates().map((date) => ({ date }));
}

export function generateMetadata({ params }: { params: { date: string } }) {
  return { title: `Digest · ${params.date} — Biotech Insights` };
}

export default function DigestPage({ params }: { params: { date: string } }) {
  const digest = readDigest(params.date);
  if (!digest) notFound();

  const dates = listDigestDates();
  const index = dates.indexOf(params.date);
  const newer = index > 0 ? dates[index - 1] : undefined;
  const older = index >= 0 && index < dates.length - 1 ? dates[index + 1] : undefined;

  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Archived digest</span>
          <h1>{formatDay(`${digest.date}T12:00:00Z`)}</h1>
          <p>
            {digest.stats.kept} items · median score {digest.stats.medianScore} ·{" "}
            {digest.alerts.length} watchlist hits
          </p>
          <SourceHealthStrip health={digest.health} />
          <div className="hero-links">
            {newer ? <a href={routes.digest(newer)}>← {formatDay(`${newer}T12:00:00Z`)}</a> : null}
            <a href={routes.archive()}>All days</a>
            {older ? <a href={routes.digest(older)}>{formatDay(`${older}T12:00:00Z`)} →</a> : null}
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
          <p className="footer-meta">Generated {formatDateTime(digest.generatedAt)}</p>
        </div>
      </section>
    </main>
  );
}
