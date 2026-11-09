import type { Knex } from "knex";
import { CREATED, ID, ownedFks, PROPERTY, run, TABLE_OPTS, UPDATED, dropAll } from "../sql.js";

// DATABASE.md §3.4. No tax rate is stored on properties (G11). A component is valid for
// effective_from <= date < effective_to (effective_to exclusive, NULL = open-ended).
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE tax_components (
  ${ID},
  ${PROPERTY},
  code VARCHAR(20) NOT NULL,
  name VARCHAR(80) NOT NULL,
  rate_percent DECIMAL(7,4) NOT NULL,
  applies_to ENUM('room','penalty') NOT NULL,
  apply_order TINYINT UNSIGNED NOT NULL DEFAULT 1,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  ${CREATED},
  UNIQUE KEY uq_tax_components_period (property_id, code, applies_to, effective_from),
  CONSTRAINT ck_tax_components_rate CHECK (rate_percent >= 0),
  CONSTRAINT ck_tax_components_period CHECK (effective_to IS NULL OR effective_to > effective_from),
  ${ownedFks("tax_components").join(",\n  ")}
) ${TABLE_OPTS}`,
    // One row per series. It is the lock target for concurrent invoice issue (F2.1).
    `CREATE TABLE number_sequences (
  ${ID},
  ${PROPERTY},
  document_type ENUM('invoice') NOT NULL,
  series VARCHAR(20) NOT NULL,
  prefix VARCHAR(20) NOT NULL,
  next_value INT UNSIGNED NOT NULL DEFAULT 1,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_number_sequences (property_id, document_type, series),
  CONSTRAINT ck_number_sequences_next CHECK (next_value >= 1),
  ${ownedFks("number_sequences").join(",\n  ")}
) ${TABLE_OPTS}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropAll(knex, "number_sequences", "tax_components");
}
