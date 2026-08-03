import { Suspense } from "react";

import { ArchiveBrowser } from "@/components/archive-browser";
import { listDigestDates, listWeeks } from "@/lib/data/repo";
import { formatDay, weekLabel } from "@/lib/format";
import { routes } from "@/lib/paths";

export const metadata = { title: "Archive — Biotech Insights" };

export default function ArchivePage() {
  const dates = listDigestDates();
  const weeks = listWeeks();
  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))].sort((a, b) => b - a);

  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Archive</span>
          <h1>{dates.length} days of digests</h1>
          <p>
            Search runs entirely in your browser against a slim index; results link straight to the
            prerendered day.
          </p>
        </div>
      </section>

      <section>
        <Suspense fallback={<p className="tiny-note">Loading…</p>}>
          <ArchiveBrowser years={years} />
        </Suspense>
      </section>

      {weeks.length > 0 ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Weekly deep dives</h2>
              <p>Sunday synthesis: themes, tallies and what moved.</p>
            </div>
          </div>
          <ul className="pill-list">
            {weeks.map((week) => (
              <li key={week}>
                <a className="pill" href={routes.weekly(week)}>
                  {weekLabel(week)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <div className="section-heading">
          <div>
            <h2>All days</h2>
          </div>
        </div>
        <ul className="pill-list">
          {dates.map((date) => (
            <li key={date}>
              <a className="pill" href={routes.digest(date)}>
                {formatDay(`${date}T12:00:00Z`)}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
