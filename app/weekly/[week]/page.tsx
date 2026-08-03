import { notFound } from "next/navigation";

import { InfoChip } from "@/components/digest";
import { listWeeks, readDigest, readWeekly } from "@/lib/data/repo";
import { formatDay, formatUsdMillions, weekLabel } from "@/lib/format";
import { routes } from "@/lib/paths";
import type { DigestItem } from "@/lib/types";

export const dynamicParams = false;

export function generateStaticParams() {
  return listWeeks().map((week) => ({ week }));
}

export function generateMetadata({ params }: { params: { week: string } }) {
  return { title: `${weekLabel(params.week)} — Biotech Insights` };
}

/** Looks an item up across the week's digests, since ids are date-scoped in storage. */
function findItem(start: string, end: string, itemId: string): { item: DigestItem; date: string } | undefined {
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    const digest = readDigest(date);
    const item = digest?.items[itemId];
    if (item) return { item, date };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return undefined;
}

export default function WeeklyPage({ params }: { params: { week: string } }) {
  const rollup = readWeekly(params.week);
  if (!rollup) notFound();

  const link = (itemId: string) => {
    const found = findItem(rollup.start, rollup.end, itemId);
    if (!found) return undefined;
    return { href: `${routes.digest(found.date)}#${itemId}`, item: found.item };
  };

  const readoutTotal =
    rollup.tallies.readouts.met.length +
    rollup.tallies.readouts.missed.length +
    rollup.tallies.readouts.mixed.length;

  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Weekly deep dive</span>
          <h1>{weekLabel(rollup.week)}</h1>
          <p>
            {formatDay(`${rollup.start}T12:00:00Z`)} – {formatDay(`${rollup.end}T12:00:00Z`)}
          </p>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-value">{rollup.tallies.approvals.length}</span>
              <span className="stat-label">approvals</span>
            </div>
            <div className="stat">
              <span className="stat-value">{readoutTotal}</span>
              <span className="stat-label">readouts</span>
            </div>
            <div className="stat">
              <span className="stat-value">{rollup.tallies.ma.count}</span>
              <span className="stat-label">M&amp;A deals</span>
            </div>
            <div className="stat">
              <span className="stat-value">
                {formatUsdMillions(rollup.tallies.ma.totalUsdM) ?? "—"}
              </span>
              <span className="stat-label">M&amp;A value</span>
            </div>
            <div className="stat">
              <span className="stat-value">{rollup.tallies.financings.count}</span>
              <span className="stat-label">financings</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <h2>Themes</h2>
            <p>Terms unusually frequent this week versus a trailing four-week baseline.</p>
          </div>
        </div>
        {rollup.themes.status === "warming-up" ? (
          <div className="card empty-card">
            <p>
              Theme detection needs history to compare against — {rollup.themes.weeksObserved} of 3
              weeks observed so far. Until then the tallies below are the honest signal, and inventing
              a trend from one week of data would just be noise.
            </p>
          </div>
        ) : (
          <div className="grid grid-2">
            {rollup.themes.items.map((theme) => (
              <article className="card" key={theme.label}>
                <div className="item-header">
                  <h3 className="item-title">{theme.label}</h3>
                  <span className="section-note">{theme.lift}× lift</span>
                </div>
                <div className="tag-row">
                  {theme.terms.slice(1, 6).map((term) => (
                    <InfoChip key={term}>{term}</InfoChip>
                  ))}
                </div>
                <p className="tiny-note">{theme.docCount} items this week</p>
                <ul className="mini-list">
                  {theme.itemIds.slice(0, 4).map((itemId) => {
                    const found = link(itemId);
                    if (!found) return null;
                    return (
                      <li key={itemId}>
                        <a href={found.href}>{found.item.title}</a>
                      </li>
                    );
                  })}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {rollup.tallies.approvals.length > 0 || rollup.tallies.crls.length > 0 ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Regulatory</h2>
            </div>
          </div>
          <div className="card">
            <ul className="mini-list">
              {rollup.tallies.approvals.map((entry) => {
                const found = link(entry.itemId);
                return (
                  <li key={entry.itemId}>
                    <strong>Approval</strong>{" "}
                    {found ? <a href={found.href}>{entry.title}</a> : entry.title}
                  </li>
                );
              })}
              {rollup.tallies.crls.map((entry) => {
                const found = link(entry.itemId);
                return (
                  <li key={entry.itemId}>
                    <strong>CRL</strong> {found ? <a href={found.href}>{entry.title}</a> : entry.title}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {rollup.tallies.newPhase3.length > 0 ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>New phase 3 starts</h2>
              <p>Industry-sponsored studies newly posted to ClinicalTrials.gov.</p>
            </div>
          </div>
          <div className="card">
            <ul className="mini-list">
              {rollup.tallies.newPhase3.map((trial) => (
                <li key={trial.nct}>
                  <a
                    href={`https://clinicaltrials.gov/study/${trial.nct}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {trial.title}
                  </a>
                  {trial.sponsor ? <span className="tiny-note"> — {trial.sponsor}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {rollup.degradedSources.length > 0 ? (
        <section className="footer-panel">
          <div className="footer-card">
            <h2>Sources that struggled</h2>
            <p>{rollup.degradedSources.join(", ")}</p>
          </div>
        </section>
      ) : null}
    </main>
  );
}
