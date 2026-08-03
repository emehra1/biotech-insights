import fs from "fs";
import path from "path";
import { getSummary } from "@/lib/summary";

async function main() {
  const summary = await getSummary();
  const outputPath = path.resolve(process.cwd(), "summary.json");
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`Summary written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
