import knex, { type Knex } from "knex";
import { loadDbConfig, type DbRole } from "../config.js";

export type Db = Knex | Knex.Transaction;

/**
 * - `app`: restricted user (SELECT/INSERT + column-level UPDATE, no DELETE). Used by services and seeds.
 * - `migrator`: owns DDL. Used only by the migration CLI.
 *
 * DECIMAL columns come back as strings (mysql2 default), never floats. Dates come back as strings
 * (`dateStrings`), and every session runs in UTC.
 */
export function createDb(role: DbRole): Knex {
  const c = loadDbConfig(role);
  return knex({
    client: "mysql2",
    connection: {
      host: c.host,
      port: c.port,
      user: c.user,
      password: c.password,
      database: c.database,
      charset: "utf8mb4",
      timezone: "Z",
      dateStrings: true,
    },
    pool: {
      min: 0,
      max: 10,
      afterCreate: (conn: { query: (sql: string, cb: (err: Error | null) => void) => void }, done: (err: Error | null, conn: unknown) => void) => {
        conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
      },
    },
  });
}
