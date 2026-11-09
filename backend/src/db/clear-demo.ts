/**
 * CLI: clear operational demo data; keep users; restore 10 rooms.
 *   docker compose --profile tools run --rm clear-demo
 */
import { createDb } from "./knex.js";
import { clearDemoData } from "./clear-demo-data.js";

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production" && process.env["ALLOW_DEMO_CLEAR"] !== "true") {
    throw new Error("clear-demo refuses production unless ALLOW_DEMO_CLEAR=true");
  }
  const code = process.env["HOTEL_SLUG"] || "demo-hotel";
  const db = createDb("migrator");
  try {
    const r = await clearDemoData(db, code);
    console.log(`Cleared demo data for ${code}: kept users/staff; restored ${r.rooms} rooms.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
