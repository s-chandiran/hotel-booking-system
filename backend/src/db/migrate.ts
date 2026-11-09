/**
 * Migration CLI. Runs as the migrator DB user, and only when invoked explicitly (never on API start).
 *   latest   apply pending migrations
 *   status   list applied / pending
 *   rollback undo the last batch (refused when NODE_ENV=production; shared migrations are forward-only)
 */
import { createDb } from "./knex.js";
import { migrationConfig as config } from "./migration-source.js";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "status";
  const db = createDb("migrator");
  try {
    if (cmd === "latest") {
      const [batch, files] = (await db.migrate.latest(config)) as [number, string[]];
      console.log(files.length ? `Batch ${batch}: applied ${files.length} migration(s): ${files.join(", ")}` : "Already up to date.");
    } else if (cmd === "status") {
      const [done, pending] = (await db.migrate.list(config)) as [Array<{ name: string } | string>, Array<{ file: string } | string>];
      const name = (x: { name: string } | { file: string } | string) => (typeof x === "string" ? x : "name" in x ? x.name : x.file);
      console.log(`Applied (${done.length}): ${done.map(name).join(", ") || "-"}`);
      console.log(`Pending (${pending.length}): ${pending.map(name).join(", ") || "-"}`);
    } else if (cmd === "rollback") {
      if (process.env["NODE_ENV"] === "production") throw new Error("Rollback is disabled in production (forward-only migrations).");
      const [batch, files] = (await db.migrate.rollback(config)) as [number, string[]];
      console.log(`Rolled back batch ${batch}: ${files.join(", ") || "-"}`);
    } else {
      throw new Error(`Unknown command "${cmd}". Use latest | status | rollback.`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
