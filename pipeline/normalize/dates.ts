/**
 * Feed date parsing. Every format below was observed live in one of our feeds.
 *
 * Two things this exists to prevent:
 *  1. `new Date("Jul 31, 2026 8:59am")` → Invalid Date. That is FierceBiotech's
 *     format, so today every Fierce item sorts as garbage.
 *  2. `new Date("31 Jul 2026")` → midnight in the *runner's* local zone, which
 *     silently shifts the day under TZ=UTC vs TZ=America/Los_Angeles.
 *
 * A date we cannot parse becomes `null` with `confident: false`. It never
 * becomes `Date.now()` — that would fabricate freshness, and freshness is a
 * scoring input.
 */

export type DatePrecision = "second" | "minute" | "day" | "unknown";

export interface ParsedDate {
  date: Date | null;
  precision: DatePrecision;
  from: "isoDate" | "pubDate" | "dc:date" | "api" | "none";
  confident: boolean;
  warning?: string;
}

const MISS: ParsedDate = {
  date: null,
  precision: "unknown",
  from: "none",
  confident: false,
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** "Jul 31, 2026 8:59am" — FierceBiotech. Publisher is US Eastern. */
const FIERCE_RE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i;
/** "31 Jul 2026" — bare day, no zone. */
const BARE_DAY_RE = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/;

/**
 * Offset of a named zone at a given instant, via ICU (ships with Node).
 * Returns milliseconds to ADD to UTC to get local time (negative for the US).
 */
function zoneOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  return sign * (hours * 60 + minutes) * 60_000;
}

/**
 * Interpret wall-clock fields as a specific zone. Two-pass fixpoint because the
 * offset itself depends on the instant (DST) — one pass is wrong for the hour
 * either side of a transition.
 */
export function wallClockToUtc(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
): Date {
  const naive = Date.UTC(y, mo, d, h, mi);
  let t = naive;
  for (let i = 0; i < 2; i++) t = naive - zoneOffsetMs(timeZone, t);
  return new Date(t);
}

export interface ParseDateOptions {
  /** Zone to assume for formats that carry no offset. */
  assumeTimeZone?: string;
  /** Clamp anything further ahead than this (feeds do publish future dates). */
  now?: Date;
  maxFutureHours?: number;
}

export function parseFeedDate(
  raw: unknown,
  options: ParseDateOptions = {},
): ParsedDate {
  if (raw == null) return MISS;
  const input = String(raw).replace(/\s+/g, " ").trim();
  if (!input) return MISS;

  const zone = options.assumeTimeZone ?? "UTC";
  const parsed = parseByFormat(input, zone);
  if (!parsed.date) return parsed;

  return clampFuture(parsed, options);
}

function parseByFormat(input: string, zone: string): ParsedDate {
  // 1. ISO with an explicit offset — unambiguous, fast path.
  if (ISO_RE.test(input)) {
    const date = new Date(input);
    if (!Number.isNaN(date.getTime())) {
      return {
        date,
        precision: /:\d{2}(\.\d+)?(Z|[+-])/.test(input) ? "second" : "minute",
        from: "isoDate",
        confident: true,
      };
    }
  }

  // 2. Date-only (dc:date on Nature/Cell/bioRxiv). Anchor at NOON UTC so that
  //    formatting in any western zone still lands on the intended calendar day.
  const dateOnly = DATE_ONLY_RE.exec(input);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return {
      date: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0)),
      precision: "day",
      from: "dc:date",
      confident: true,
    };
  }

  // 3. RFC-822 / RFC-2822, including named zones like "EDT" (FDA). V8 handles these.
  if (/^[A-Za-z]{3},\s/.test(input) || /\d{2}:\d{2}:\d{2}\s?(GMT|UT|[A-Z]{3}|[+-]\d{4})/.test(input)) {
    const date = new Date(input);
    if (!Number.isNaN(date.getTime())) {
      return { date, precision: "second", from: "pubDate", confident: true };
    }
  }

  // 4. FierceBiotech: "Jul 31, 2026 8:59am" — invalid in V8, valid in reality.
  const fierce = FIERCE_RE.exec(input);
  if (fierce) {
    const [, monName, day, year, hourRaw, minute, meridiem] = fierce;
    const month = MONTHS[(monName ?? "").slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      let hour = Number(hourRaw) % 12;
      if ((meridiem ?? "").toLowerCase() === "p") hour += 12;
      return {
        date: wallClockToUtc(zone, Number(year), month, Number(day), hour, Number(minute)),
        precision: "minute",
        from: "pubDate",
        confident: true,
      };
    }
  }

  // 5. "31 Jul 2026" — bare day; treat as noon in the source's zone.
  const bare = BARE_DAY_RE.exec(input);
  if (bare) {
    const [, day, monName, year] = bare;
    const month = MONTHS[(monName ?? "").slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return {
        date: wallClockToUtc(zone, Number(year), month, Number(day), 12, 0),
        precision: "day",
        from: "pubDate",
        confident: true,
      };
    }
  }

  // 6. Last resort: let V8 try, but mark it unconfident so scoring can penalize.
  const loose = new Date(input);
  if (!Number.isNaN(loose.getTime())) {
    return {
      date: loose,
      precision: "day",
      from: "pubDate",
      confident: false,
      warning: `loose-date-parse:${input}`,
    };
  }

  return { ...MISS, warning: `unparseable-date:${input}` };
}

function clampFuture(parsed: ParsedDate, options: ParseDateOptions): ParsedDate {
  if (!parsed.date) return parsed;
  const now = options.now ?? new Date();
  const maxFutureMs = (options.maxFutureHours ?? 36) * 3_600_000;
  if (parsed.date.getTime() > now.getTime() + maxFutureMs) {
    return {
      ...parsed,
      date: new Date(now.getTime() + maxFutureMs),
      confident: false,
      warning: `future-date-clamped:${parsed.date.toISOString()}`,
    };
  }
  return parsed;
}

/** Hours between two instants, floored at 0. */
export function ageHours(published: Date, now: Date): number {
  return Math.max(0, (now.getTime() - published.getTime()) / 3_600_000);
}

/** YYYY-MM-DD in a given zone (defaults to UTC). */
export function isoDay(date: Date, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO week id, e.g. 2026-W31. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d;
}
