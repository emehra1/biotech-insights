import type { DailyDigest, DigestItem, WeeklyRollup } from "../types";
import { formatDay, formatUsdMillions } from "../format";
import { escapeHtml, html, raw, safeUrl, type Raw } from "../html";

/**
 * Digest email.
 *
 * Rendered from the committed digest JSON, never by re-fetching, so the email
 * and the web page are byte-identical in content.
 *
 * Client constraints baked in: one 600px presentational table, inline styles
 * only (no flex, no grid, no external CSS, no web fonts, no images), an
 * explicit color on every text element because Gmail's dark-mode inverter
 * mangles unset colors, and a real text/plain alternative.
 */

const MAX_HTML_BYTES = 95_000; // Gmail clips around 102 KB.

const COLORS = {
  ink: "#1a1a1a",
  muted: "#5a6472",
  accent: "#0b6bcb",
  alert: "#8a5a00",
  alertBg: "#fff8e6",
  border: "#e2e6ec",
  page: "#f5f7fa",
  card: "#ffffff",
};

export interface RenderOptions {
  siteUrl?: string;
  weekly?: WeeklyRollup;
  maxPerLane?: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function itemUrl(item: DigestItem): string {
  return item.url;
}

function factsLine(item: DigestItem): string {
  const facts = item.keyFacts;
  const parts: string[] = [];
  if (facts.phase) parts.push(facts.phase);
  if (facts.indication) parts.push(facts.indication);
  if (facts.outcome) parts.push(`endpoint ${facts.outcome}`);
  for (const drug of facts.drugs.slice(0, 2)) parts.push(drug.name);
  for (const result of facts.results.slice(0, 2)) parts.push(`${result.metric} ${result.value}`);
  if (facts.deal) {
    const size = formatUsdMillions(facts.deal.totalUsdM ?? facts.deal.upfrontUsdM);
    parts.push([facts.deal.type, facts.deal.round, size].filter(Boolean).join(" "));
  }
  if (facts.evidenceLevel !== "unknown" && facts.evidenceLevel !== "clinical") {
    parts.push(facts.evidenceLevel);
  }
  return parts.slice(0, 6).join(" · ");
}

function whyLine(item: DigestItem): string {
  return item.scoreBreakdown.factors
    .slice(0, 2)
    .map((factor) => factor.label)
    .join(" · ");
}

/**
 * "Paper · Nature Genetics" rather than a bare source name.
 *
 * Half of "I don't get paper recommendations" was legibility: a Nature Genetics
 * paper and a Fierce Biotech dek rendered identically — one bold line over one
 * grey byline — so a lane holding four papers and one news item read as five
 * headlines. The other half was that the papers on offer were Nature's newsroom;
 * `articleClass` is how a journal's own news gets labelled as news here.
 */
function kindLabel(item: DigestItem): string {
  if (item.sourceKind === "preprint") return "Preprint";
  if (item.sourceKind !== "journal") return "";
  // `articleClass` is absent from every digest built before it existed, and
  // inferring "Paper" from a missing value would relabel the whole archive —
  // including the astrophysics news item that started all this. No evidence, no
  // badge; a badge that lies is worse than none.
  if (!item.articleClass) return "";
  if (item.articleClass === "news-comment") return "Journal news";
  if (item.articleClass === "notice") return "Correction";
  return "Paper";
}

function renderItem(item: DigestItem, options: { showDigest: boolean }): Raw {
  const facts = factsLine(item);
  const kind = kindLabel(item);
  // A paper's abstract IS the recommendation — without it the reader has a bare
  // title and no way to judge. So papers keep their summary even in the
  // size-reduced build; news deks are what gets shed to fit under Gmail's clip.
  const showBody = options.showDigest || item.isAcademic;
  return html`
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid ${COLORS.border};">
        <a
          href="${raw(safeUrl(itemUrl(item)))}"
          style="color:${COLORS.ink};font-size:15px;font-weight:600;line-height:1.4;text-decoration:none;"
          >${item.title}</a
        >
        <div style="color:${COLORS.muted};font-size:12px;padding-top:4px;">
          ${kind
            ? html`<span style="color:${COLORS.accent};font-weight:700;">${kind}</span> · `
            : ""}${item.sourceName} · score ${Math.round(item.score)} · ${whyLine(item)}
        </div>
        ${showBody && item.digest[0]
          ? html`<div style="color:${COLORS.ink};font-size:13px;line-height:1.5;padding-top:6px;">
              ${item.digest[0]}
            </div>`
          : ""}
        ${facts
          ? html`<div style="color:${COLORS.accent};font-size:12px;padding-top:6px;">${facts}</div>`
          : ""}
      </td>
    </tr>
  `;
}

export function renderDigestEmail(digest: DailyDigest, options: RenderOptions = {}): RenderedEmail {
  // 5 per lane showed 20 of the 80 items the pipeline had already selected and
  // committed. The lanes holding the papers are the last two, so the ones that
  // got cut were disproportionately papers.
  const maxPerLane = options.maxPerLane ?? 7;
  const alertItems = uniqueAlertItems(digest);

  const subject = buildSubject(digest, alertItems);

  const lanes = digest.lanes
    .map((lane) => ({
      lane,
      items: lane.itemIds
        .map((id) => digest.items[id])
        .filter((item): item is DigestItem => Boolean(item))
        .slice(0, maxPerLane),
    }))
    .filter((entry) => entry.items.length > 0);

  const degraded = digest.health.filter((h) => h.status === "failed" || h.status === "degraded");

  const build = (showDigest: boolean, perLane: number): string =>
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <meta name="supported-color-schemes" content="light dark" />
          <title>${subject}</title>
          <style>
            @media (prefers-color-scheme: dark) {
              .bti-page { background: #10141a !important; }
              .bti-card { background: #171c24 !important; }
              .bti-ink { color: #e8ecf2 !important; }
              .bti-muted { color: #9aa5b4 !important; }
            }
          </style>
        </head>
        <body
          class="bti-page"
          style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"
        >
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${COLORS.page}">
            <tr>
              <td align="center" style="padding:24px 12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;">
                  <tr>
                    <td class="bti-card" bgcolor="${COLORS.card}" style="background:${COLORS.card};padding:24px;border-radius:12px;">
                      <div class="bti-muted" style="color:${COLORS.muted};font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">
                        Biotech Insights · ${formatDay(`${digest.date}T12:00:00Z`)}
                      </div>
                      <h1 class="bti-ink" style="color:${COLORS.ink};font-size:20px;margin:8px 0 4px;">
                        ${digest.stats.kept} items worth your attention
                      </h1>
                      ${options.siteUrl
                        ? html`<a href="${raw(safeUrl(options.siteUrl))}" style="color:${COLORS.accent};font-size:13px;text-decoration:none;">View on the web →</a>`
                        : ""}

                      ${alertItems.length > 0
                        ? html`
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:18px;">
                              <tr>
                                <td bgcolor="${COLORS.alertBg}" style="background:${COLORS.alertBg};border-left:3px solid ${COLORS.alert};padding:12px 14px;">
                                  <div style="color:${COLORS.alert};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">
                                    Watchlist · ${alertItems.length}
                                  </div>
                                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                    ${alertItems.slice(0, 15).map((item) => renderItem(item, { showDigest }))}
                                  </table>
                                </td>
                              </tr>
                            </table>
                          `
                        : ""}

                      ${lanes.map(
                        (entry) => html`
                          <h2 class="bti-ink" style="color:${COLORS.ink};font-size:15px;margin:24px 0 0;padding-top:12px;border-top:2px solid ${COLORS.border};">
                            ${entry.lane.label}
                          </h2>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                            ${entry.items.slice(0, perLane).map((item) => renderItem(item, { showDigest }))}
                          </table>
                        `,
                      )}

                      ${options.weekly ? renderWeeklySection(options.weekly) : ""}

                      <div class="bti-muted" style="color:${COLORS.muted};font-size:11px;padding-top:20px;line-height:1.6;">
                        ${digest.health.length - degraded.length}/${digest.health.length} feeds healthy${degraded.length
                          ? ` · degraded: ${degraded.map((h) => h.sourceName).join(", ")}`
                          : ""}<br />
                        Ranked by deterministic keyword scoring — no model reads these articles.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>`.value;

  // Gmail clips long messages; shed the summaries, then trim per-lane counts.
  let output = build(true, maxPerLane);
  if (Buffer.byteLength(output) > MAX_HTML_BYTES) output = build(false, maxPerLane);
  for (let perLane = maxPerLane - 1; perLane >= 2 && Buffer.byteLength(output) > MAX_HTML_BYTES; perLane--) {
    output = build(false, perLane);
  }

  return { subject, html: output, text: renderText(digest, alertItems, lanes, options) };
}

function renderWeeklySection(weekly: WeeklyRollup): Raw {
  const readouts = weekly.tallies.readouts;
  return html`
    <h2 style="color:${COLORS.ink};font-size:15px;margin:24px 0 8px;padding-top:12px;border-top:2px solid ${COLORS.border};">
      Week in review · ${weekly.week}
    </h2>
    <div style="color:${COLORS.ink};font-size:13px;line-height:1.7;">
      ${weekly.tallies.approvals.length} approvals · ${weekly.tallies.crls.length} CRLs ·
      readouts ${readouts.met.length} met / ${readouts.missed.length} missed / ${readouts.mixed.length} mixed ·
      ${weekly.tallies.ma.count} M&amp;A (${formatUsdMillions(weekly.tallies.ma.totalUsdM) ?? "n/a"}) ·
      ${weekly.tallies.financings.count} financings
    </div>
    ${weekly.themes.items.length > 0
      ? html`<div style="color:${COLORS.muted};font-size:12px;padding-top:6px;">
          Themes: ${weekly.themes.items.map((theme) => theme.label).join(", ")}
        </div>`
      : ""}
  `;
}

function uniqueAlertItems(digest: DailyDigest): DigestItem[] {
  const seen = new Set<string>();
  const items: DigestItem[] = [];
  for (const alert of digest.alerts) {
    if (seen.has(alert.itemId)) continue;
    const item = digest.items[alert.itemId];
    if (!item) continue;
    seen.add(alert.itemId);
    items.push(item);
  }
  return items.sort((a, b) => b.score - a.score);
}

/**
 * The subject carries the signal, and the date keeps Gmail from collapsing
 * every digest into one thread.
 */
function buildSubject(digest: DailyDigest, alerts: DigestItem[]): string {
  const date = new Date(`${digest.date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  const parts = [`Biotech digest · ${date}`];
  if (alerts.length > 0) parts.push(`${alerts.length} watchlist hit${alerts.length === 1 ? "" : "s"}`);

  const headline = Object.values(digest.items)
    .filter((item) => item.eventTypes.some((event) => event === "approval" || event === "ma-large" || event === "phase3-readout"))
    .sort((a, b) => b.score - a.score)[0];
  if (headline) parts.push(truncate(headline.title, 60));

  return parts.join(" · ");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function renderText(
  digest: DailyDigest,
  alerts: DigestItem[],
  lanes: { lane: DailyDigest["lanes"][number]; items: DigestItem[] }[],
  options: RenderOptions,
): string {
  const lines: string[] = [];
  lines.push(`BIOTECH DIGEST — ${digest.date}`);
  if (options.siteUrl) lines.push(options.siteUrl);
  lines.push("");

  if (alerts.length > 0) {
    lines.push(`WATCHLIST (${alerts.length})`);
    for (const item of alerts.slice(0, 15)) {
      lines.push(`- ${item.title}`);
      lines.push(`  ${item.sourceName} · ${factsLine(item) || whyLine(item)}`);
      lines.push(`  ${item.url}`);
    }
    lines.push("");
  }

  for (const { lane, items } of lanes) {
    lines.push(lane.label.toUpperCase());
    for (const item of items) {
      const kind = kindLabel(item);
      lines.push(`- ${item.title}`);
      lines.push(
        `  ${[kind, item.sourceName, factsLine(item) || whyLine(item)].filter(Boolean).join(" · ")}`,
      );
      if (item.isAcademic && item.digest[0]) lines.push(`  ${item.digest[0]}`);
      lines.push(`  ${item.url}`);
    }
    lines.push("");
  }

  const degraded = digest.health.filter((h) => h.status === "failed" || h.status === "degraded");
  lines.push(
    `${digest.health.length - degraded.length}/${digest.health.length} feeds healthy${
      degraded.length ? ` — degraded: ${degraded.map((h) => h.sourceName).join(", ")}` : ""
    }`,
  );
  lines.push("Deterministic keyword ranking; no model reads these articles.");

  return lines.join("\n");
}

export { escapeHtml };
