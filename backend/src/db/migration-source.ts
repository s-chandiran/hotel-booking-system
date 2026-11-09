/**
 * One migration source for every runtime. Migrations run from compiled `.js` in Docker and from `.ts`
 * (tsx) on the host. knex records the file name, so the name is always reported with `.js`, whichever
 * file is loaded. Otherwise a host run would call the directory "corrupt" after a Docker run, and the
 * reverse would also happen.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Knex } from "knex";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";

const source: Knex.MigrationSource<string> = {
  async getMigrations() {
    return (await readdir(dir)).filter((f) => f.endsWith(ext) && !f.endsWith(".d.ts")).sort();
  },
  getMigrationName(file) {
    return file.slice(0, -ext.length) + ".js";
  },
  async getMigration(file) {
    return (await import(pathToFileURL(path.join(dir, file)).href)) as Knex.Migration;
  },
};

export const migrationConfig: Knex.MigratorConfig = { migrationSource: source, tableName: "knex_migrations" };

/** Names of migrations not yet applied (the API refuses to start while any are pending). */
export async function pendingMigrations(db: Knex): Promise<string[]> {
  const [, pending] = (await db.migrate.list(migrationConfig)) as [unknown[], Array<{ file: string } | string>];
  return pending.map((p) => (typeof p === "string" ? p : p.file));
}
