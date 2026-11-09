/**
 * API entry point. Runs as the restricted app DB user. It refuses to start while migrations are
 * pending (it never runs them itself: migrations are an explicit step), and it logs no secrets.
 */
import { createDb } from "../db/knex.js";
import { pendingMigrations } from "../db/migration-source.js";
import { createApp } from "./app.js";
import { loadApiConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const db = createDb("app");
  const pending = await pendingMigrations(db);
  if (pending.length) {
    await db.destroy();
    throw new Error(`Refusing to start: ${pending.length} migration(s) pending (${pending.join(", ")}). Run the migrate step first.`);
  }
  const app = createApp(db, config, (line) => console.error(line));
  const server = app.listen(config.port, () => console.log(`StayDesk API listening on :${config.port} (${config.nodeEnv})`));
  const stop = () => {
    server.close(() => {
      void db.destroy().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
