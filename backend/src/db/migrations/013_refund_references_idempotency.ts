import type { Knex } from "knex";
import { run } from "../sql.js";

/**
 * Controlled refunds (Q8, Q28):
 *  1. Server-generated `RF-` references via number_sequences (unique only; gaps allowed).
 *  2. idempotency_key on refunds so a double-click or retry returns the original request.
 */
const startAfter = `
  SELECT p.id, ?, ?, ?, COALESCE((
    SELECT MAX(CAST(SUBSTRING(t.reference, 4) AS UNSIGNED)) FROM refunds t
    WHERE t.property_id = p.id AND t.reference REGEXP '^RF-[0-9]+$'), 0) + 1
  FROM properties p`;

export async function up(knex: Knex): Promise<void> {
  await run(knex, "ALTER TABLE number_sequences MODIFY document_type ENUM('invoice','booking','payment','refund') NOT NULL");
  await knex.raw(`INSERT INTO number_sequences (property_id, document_type, series, prefix, next_value) ${startAfter}`, ["refund", "RF", "RF-"]);
  await run(
    knex,
    "ALTER TABLE refunds ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER reason, ADD UNIQUE KEY uq_refunds_idempotency (property_id, idempotency_key)",
  );
}

export async function down(knex: Knex): Promise<void> {
  await run(
    knex,
    "ALTER TABLE refunds DROP INDEX uq_refunds_idempotency, DROP COLUMN idempotency_key",
    "DELETE FROM number_sequences WHERE document_type = 'refund'",
    "ALTER TABLE number_sequences MODIFY document_type ENUM('invoice','booking','payment') NOT NULL",
  );
}
