import { buildWeekly } from "./weekly";
import { writeWeekly } from "../state/store";

/**
 * Sunday rollup. Runs as a step inside the same workflow as the daily pipeline,
 * gated on the day of week — two workflows would race on the Pages deployment
 * and both push to main.
 */
function main(): number {
  const args = process.argv.slice(2);
  const dateArg = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  const reference = dateArg ? new Date(`${dateArg}T12:00:00Z`) : new Date();

  const rollup = buildWeekly({ reference });
  if (!rollup) {
    console.log("weekly: no digests in this week yet; nothing to roll up");
    return 0;
  }

  const file = writeWeekly(rollup);
  console.log(`weekly: wrote ${file}`);
  console.log(
    `  themes: ${rollup.themes.status}${
      rollup.themes.status === "warming-up" ? ` (${rollup.themes.weeksObserved} weeks observed)` : ""
    }, ${rollup.themes.items.length} detected`,
  );
  console.log(
    `  approvals ${rollup.tallies.approvals.length} · CRLs ${rollup.tallies.crls.length} · ` +
      `readouts met/missed/mixed ${rollup.tallies.readouts.met.length}/${rollup.tallies.readouts.missed.length}/${rollup.tallies.readouts.mixed.length}`,
  );
  console.log(
    `  M&A ${rollup.tallies.ma.count} ($${rollup.tallies.ma.totalUsdM}M) · financings ${rollup.tallies.financings.count}`,
  );
  if (rollup.lexiconSuggestions.length) {
    console.log(`  lexicon candidates: ${rollup.lexiconSuggestions.join(", ")}`);
  }
  return 0;
}

process.exitCode = main();
