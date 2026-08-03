/**
 * Formatting helpers.
 *
 * Every date format pins an explicit timeZone. Without it, a prerendered page
 * formats under the CI runner's zone and re-renders under the viewer's, which
 * is a React hydration mismatch — the old app had exactly this bug in its
 * `toLocaleDateString("en-US", …)` call.
 */
export const SITE_TIME_ZONE = "America/New_York";

export function formatDay(iso: string, timeZone = SITE_TIME_ZONE): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDay(iso: string, timeZone = SITE_TIME_ZONE): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" });
}

export function formatDateTime(iso: string, timeZone = SITE_TIME_ZONE): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeDays(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function formatUsdMillions(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (value >= 1000) return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}B`;
  return `$${Math.round(value)}M`;
}

export function weekLabel(week: string): string {
  const [year, rest] = week.split("-W");
  return `Week ${rest} of ${year}`;
}
