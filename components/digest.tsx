import type {
  DailyDigest,
  DigestItem,
  KeyFacts as KeyFactsType,
  RunStatus,
  SourceHealth,
  WatchAlert,
} from "@/lib/types";
import { EVENT_LABELS } from "@/lib/types";
import { formatShortDay, formatUsdMillions, relativeDays } from "@/lib/format";
import { routes } from "@/lib/paths";

/**
 * Server components — no client JS. The "why this ranked" disclosure uses a
 * native <details>, so explainability costs zero kilobytes.
 */

export function Badge({ children, tone }: { children: React.ReactNode; tone?: "alert" | "muted" }) {
  return <span className={tone ? `badge badge-${tone}` : "badge"}>{children}</span>;
}

export function InfoChip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="info-chip" title={title}>
      {children}
    </span>
  );
}

/** The strip that usually says more than the prose does. */
export function KeyFacts({ facts }: { facts: KeyFactsType }) {
  const chips: { label: string; value: string; title?: string }[] = [];

  if (facts.phase) chips.push({ label: "Phase", value: facts.phase.replace(/^phase\s*/i, "") });
  if (facts.indication) chips.push({ label: "Indication", value: facts.indication });
  for (const drug of facts.drugs.slice(0, 2)) {
    chips.push({ label: "Drug", value: drug.name, title: drug.modality });
  }
  for (const company of facts.companies.slice(0, 2)) {
    chips.push({
      label: company.role === "mentioned" ? "Company" : company.role,
      value: company.ticker ? `${company.name} (${company.ticker})` : company.name,
    });
  }
  if (facts.outcome) chips.push({ label: "Endpoint", value: facts.outcome });
  if (facts.enrollment) chips.push({ label: "n", value: facts.enrollment.toLocaleString("en-US") });
  for (const result of facts.results.slice(0, 3)) {
    chips.push({ label: result.metric, value: result.value, title: result.verbatim });
  }
  if (facts.deal) {
    const size = formatUsdMillions(facts.deal.totalUsdM ?? facts.deal.upfrontUsdM);
    chips.push({
      label: facts.deal.type,
      value: [facts.deal.round, size].filter(Boolean).join(" ") || "undisclosed",
      title: facts.deal.verbatim,
    });
  }
  for (const regulatory of facts.regulatory.slice(0, 2)) {
    chips.push({
      label: regulatory.agency,
      value: regulatory.action,
      title: regulatory.verbatim,
    });
  }
  if (facts.evidenceLevel !== "unknown" && facts.evidenceLevel !== "clinical") {
    chips.push({ label: "Evidence", value: facts.evidenceLevel });
  }

  if (chips.length === 0) return null;

  return (
    <dl className="key-facts">
      {chips.slice(0, 7).map((chip, index) => (
        <div className="key-fact" key={`${chip.label}-${chip.value}-${index}`} title={chip.title}>
          <dt>{chip.label}</dt>
          <dd>{chip.value}</dd>
        </div>
      ))}
      {chips.length > 7 ? <div className="key-fact key-fact-more">+{chips.length - 7}</div> : null}
    </dl>
  );
}

/**
 * With no model writing "why this matters", the score breakdown is the trust
 * mechanism: you can see exactly which signals put an item where it is, and
 * re-tune config/weights.json when the ranking looks wrong.
 */
export function WhyRanked({ item }: { item: DigestItem }) {
  const { factors, penalties } = item.scoreBreakdown;
  return (
    <details className="why-ranked">
      <summary>
        <span className="why-score">{item.score.toFixed(0)}</span>
        <span className="why-label">why this ranked</span>
        <span className="score-meter" aria-hidden="true">
          <span className="score-meter-fill" style={{ width: `${Math.min(100, item.score)}%` }} />
        </span>
      </summary>
      <ul className="why-list">
        {factors.map((factor) => (
          <li key={factor.key}>
            <span className="why-delta positive">+{factor.contribution.toFixed(1)}</span>
            <span>{factor.label}</span>
            {factor.evidence?.length ? (
              <span className="why-evidence">{factor.evidence.slice(0, 4).join(", ")}</span>
            ) : null}
          </li>
        ))}
        {penalties.map((penalty) => (
          <li key={penalty.key}>
            <span className="why-delta negative">{penalty.contribution.toFixed(1)}</span>
            <span>{penalty.label}</span>
          </li>
        ))}
      </ul>
      <p className="why-footnote">
        Deterministic keyword scoring — no model involved. Weights: {item.scoreBreakdown.weightsVersion}
      </p>
    </details>
  );
}

export function ItemCard({
  item,
  siblings = [],
  variant = "default",
}: {
  item: DigestItem;
  siblings?: DigestItem[];
  variant?: "default" | "alert" | "compact";
}) {
  const provenanceNote =
    item.digestSource === "dek"
      ? "Publisher summary"
      : item.digestSource === "abstract"
        ? "From the abstract"
        : "Key sentences";

  return (
    <article className={`card item-card${variant === "alert" ? " item-card-alert" : ""}`} id={item.id}>
      <div className="item-header">
        <div className="item-source">
          <Badge>{item.sourceName}</Badge>
          {item.publishedAt ? (
            <span className="item-date">{formatShortDay(item.publishedAt)}</span>
          ) : (
            <span className="item-date item-date-missing">date unknown</span>
          )}
          {item.isNew ? <Badge tone="alert">new</Badge> : null}
          {item.paywalled ? <Badge tone="muted">paywalled</Badge> : null}
        </div>
        <WhyRanked item={item} />
      </div>

      <h3 className="item-title">
        <a href={item.url} target="_blank" rel="noreferrer noopener">
          {item.title}
        </a>
      </h3>

      {item.eventTypes.length > 0 ? (
        <div className="event-row">
          {item.eventTypes
            .filter((event) => event !== "opinion")
            .slice(0, 3)
            .map((event) => (
              <InfoChip key={event}>{EVENT_LABELS[event]}</InfoChip>
            ))}
        </div>
      ) : null}

      {item.digest.length > 0 ? (
        <div className="item-digest">
          {item.digest.map((sentence, index) => (
            <p key={index}>{sentence}</p>
          ))}
          <span className="item-provenance">{provenanceNote}</span>
        </div>
      ) : null}

      <KeyFacts facts={item.keyFacts} />

      {siblings.length > 0 ? (
        <p className="also-covered">
          Also covered by{" "}
          {siblings.map((sibling, index) => (
            <span key={sibling.id}>
              {index > 0 ? ", " : ""}
              <a href={sibling.url} target="_blank" rel="noreferrer noopener">
                {sibling.sourceName}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </article>
  );
}

export function LaneSection({
  lane,
  items,
  digest,
}: {
  lane: DailyDigest["lanes"][number];
  items: DigestItem[];
  digest: DailyDigest;
}) {
  return (
    <section className="lane-section" id={lane.id}>
      <div className="section-heading">
        <div>
          <h2>{lane.label}</h2>
          <p>{lane.blurb}</p>
        </div>
        <span className="section-note">{items.length} items</span>
      </div>
      {items.length > 0 ? (
        <div className="grid grid-2">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} siblings={siblingsOf(digest, item)} />
          ))}
        </div>
      ) : (
        <div className="card empty-card">
          <p>
            Nothing cleared the relevance threshold in this topic today. That is a real signal, not a
            failure — check <a href={routes.sources()}>source health</a> if it persists.
          </p>
        </div>
      )}
    </section>
  );
}

function siblingsOf(digest: DailyDigest, item: DigestItem): DigestItem[] {
  const cluster = digest.clusters.find((c) => c.id === item.clusterId);
  if (!cluster || cluster.memberIds.length < 2) return [];
  return cluster.memberIds
    .filter((id) => id !== item.id)
    .map((id) => digest.items[id])
    .filter((sibling): sibling is DigestItem => Boolean(sibling));
}

export function WatchAlertPanel({
  alerts,
  digest,
}: {
  alerts: WatchAlert[];
  digest: DailyDigest;
}) {
  if (alerts.length === 0) return null;

  const byItem = new Map<string, { item: DigestItem; labels: Set<string>; matched: Set<string> }>();
  for (const alert of alerts) {
    const item = digest.items[alert.itemId];
    if (!item) continue;
    const entry = byItem.get(alert.itemId) ?? { item, labels: new Set(), matched: new Set() };
    entry.labels.add(alert.label);
    for (const term of alert.matched) entry.matched.add(term);
    byItem.set(alert.itemId, entry);
  }

  const entries = [...byItem.values()].sort((a, b) => b.item.score - a.item.score);

  return (
    <section className="watch-panel" id="watchlist-alerts">
      <div className="section-heading">
        <div>
          <h2>Watchlist hits</h2>
          <p>
            First seen today, matching <a href={routes.watchlist()}>your watchlist</a>.
          </p>
        </div>
        <span className="section-note">{entries.length}</span>
      </div>
      <div className="grid grid-2">
        {entries.map(({ item, labels, matched }) => (
          <div key={item.id} className="watch-item">
            <div className="watch-tags">
              {[...labels].map((label) => (
                <Badge tone="alert" key={label}>
                  {label}
                </Badge>
              ))}
              {matched.size > 0 ? (
                <span className="watch-matched">matched: {[...matched].slice(0, 4).join(", ")}</span>
              ) : null}
            </div>
            <ItemCard item={item} variant="alert" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function SourceHealthStrip({ health }: { health: SourceHealth[] }) {
  const degraded = health.filter((h) => h.status === "degraded" || h.status === "failed");
  const ok = health.length - degraded.length;

  return (
    <div className={`source-strip${degraded.length ? " source-strip-warn" : ""}`}>
      <span>
        <strong>{ok}</strong>/{health.length} sources healthy
      </span>
      {degraded.length > 0 ? (
        <span className="source-strip-detail">
          {degraded
            .slice(0, 4)
            .map((entry) => `${entry.sourceName} (${entry.status})`)
            .join(", ")}
          {degraded.length > 4 ? ` +${degraded.length - 4} more` : ""}
        </span>
      ) : null}
      <a href={routes.sources()}>source detail →</a>
    </div>
  );
}

/**
 * If the pipeline failed, the site keeps serving the last good digest — so it
 * has to say so out loud, or stale data silently looks current.
 */
export function StalenessBanner({
  digestDate,
  runStatus,
  now = new Date(),
}: {
  digestDate: string;
  runStatus?: RunStatus;
  now?: Date;
}) {
  const ageDays = Math.floor(
    (now.getTime() - new Date(`${digestDate}T12:00:00Z`).getTime()) / 86_400_000,
  );
  const runFailed = runStatus && runStatus.outcome !== "ok";
  if (ageDays < 2 && !runFailed) return null;

  return (
    <div className="staleness-banner">
      <strong>Heads up:</strong> the latest digest is from {relativeDays(`${digestDate}T12:00:00Z`, now)}
      {runFailed ? (
        <>
          {" "}
          and the last pipeline run {runStatus?.outcome === "unusable" ? "was unusable" : "failed"}
          {runStatus?.message ? ` (${runStatus.message})` : ""}.
        </>
      ) : (
        "."
      )}
    </div>
  );
}
