/**
 * Schema-checks everything under data/. Runs in CI so a malformed digest fails
 * the pull request instead of the nightly build.
 */
import { FOCUS_LANES, type DailyDigest, type WeeklyRollup } from "../lib/types";
import { listDigestDates, listWeeks, readDigest, readWeekly } from "../pipeline/state/store";

const problems: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) problems.push(message);
}

function validateDigest(date: string, digest: DailyDigest): void {
  const where = `digest ${date}`;
  check(digest.schemaVersion === 2, `${where}: expected schemaVersion 2, got ${digest.schemaVersion}`);
  check(digest.date === date, `${where}: date field is ${digest.date}`);
  check(Array.isArray(digest.lanes) && digest.lanes.length === FOCUS_LANES.length, `${where}: expected ${FOCUS_LANES.length} lanes`);
  check(typeof digest.items === "object", `${where}: items must be an object keyed by id`);

  for (const lane of digest.lanes) {
    check(
      (FOCUS_LANES as readonly string[]).includes(lane.id),
      `${where}: unknown lane ${lane.id}`,
    );
    for (const id of lane.itemIds) {
      check(Boolean(digest.items[id]), `${where}: lane ${lane.id} references missing item ${id}`);
    }
  }

  for (const [id, item] of Object.entries(digest.items)) {
    check(item.id === id, `${where}: item key ${id} does not match item.id ${item.id}`);
    check(typeof item.title === "string" && item.title.length > 0, `${where}: item ${id} has no title`);
    check(/^https?:\/\//.test(item.canonicalUrl), `${where}: item ${id} has a non-http URL`);
    check(item.score >= 0 && item.score <= 100, `${where}: item ${id} score out of range (${item.score})`);
    check(Array.isArray(item.digest), `${where}: item ${id} digest must be an array`);
    check(
      Boolean(item.scoreBreakdown?.weightsVersion),
      `${where}: item ${id} is missing scoreBreakdown.weightsVersion`,
    );
  }

  for (const alert of digest.alerts) {
    check(Boolean(digest.items[alert.itemId]), `${where}: alert references missing item ${alert.itemId}`);
  }
}

function validateWeekly(week: string, rollup: WeeklyRollup): void {
  const where = `weekly ${week}`;
  check(rollup.schemaVersion === 2, `${where}: expected schemaVersion 2`);
  check(rollup.week === week, `${where}: week field is ${rollup.week}`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(rollup.start), `${where}: bad start date`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(rollup.end), `${where}: bad end date`);
}

const dates = listDigestDates();
for (const date of dates) {
  const digest = readDigest(date);
  if (!digest) {
    problems.push(`digest ${date}: unreadable JSON`);
    continue;
  }
  validateDigest(date, digest);
}

const weeks = listWeeks();
for (const week of weeks) {
  const rollup = readWeekly(week);
  if (!rollup) {
    problems.push(`weekly ${week}: unreadable JSON`);
    continue;
  }
  validateWeekly(week, rollup);
}

if (problems.length > 0) {
  console.error(`validate-data: ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`validate-data: OK — ${dates.length} digests, ${weeks.length} weekly rollups`);
