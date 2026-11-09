import type { Knex } from "knex";

/** Shared DDL fragments for migrations (kept outside migrations/ so knex doesn't load it as one). */
export const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci";
export const ID = "id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY";
export const CREATED = "created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n  created_by_user_id BIGINT UNSIGNED NULL";
export const UPDATED = "updated_at DATETIME(3) NULL";
export const PROPERTY = "property_id BIGINT UNSIGNED NOT NULL";

/** FK with RESTRICT on both actions (DATABASE.md §1): nothing disappears by cascade. */
export const fk = (table: string, column: string, ref: string): string =>
  `CONSTRAINT fk_${table}_${column} FOREIGN KEY (${column}) REFERENCES ${ref}(id) ON DELETE RESTRICT ON UPDATE RESTRICT`;

/** created_by + property FKs that every property-owned table carries. */
export const ownedFks = (table: string): string[] => [fk(table, "property_id", "properties"), fk(table, "created_by_user_id", "user_accounts")];

export async function run(knex: Knex, ...statements: string[]): Promise<void> {
  for (const s of statements) await knex.raw(s);
}

export const dropAll = (knex: Knex, ...tables: string[]): Promise<void> => run(knex, ...tables.map((t) => `DROP TABLE IF EXISTS ${t}`));
