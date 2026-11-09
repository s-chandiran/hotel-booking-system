import type { Knex } from "knex";
import { run } from "../sql.js";

/**
 * Demo scope (D-E, data-model.md §0; DATABASE.md §9d):
 *  1. number_sequences also serves booking (BK-) and payment (PAY-) references. Unique only, gaps allowed
 *     (Q11). The counter row is locked in the creating transaction, so concurrent creates never collide;
 *     uq_bookings_reference / uq_payments_reference stay the backstop.
 *     Existing properties get rows continuing after their highest existing reference (demo: BK-10431).
 *     No existing row changes. Properties created later get their rows from the seed or setup.
 *  2. idempotency_key on payments and bookings: a repeated submit (double click, retry) with the same key
 *     returns the original record instead of creating a second one.
 */
const startAfter = (table: string, prefix: string) => `
  SELECT p.id, ?, ?, ?, COALESCE((
    SELECT MAX(CAST(SUBSTRING(t.reference, ${prefix.length + 1}) AS UNSIGNED)) FROM ${table} t
    WHERE t.property_id = p.id AND t.reference REGEXP '^${prefix}[0-9]+$'), 10000) + 1
  FROM properties p`;

export async function up(knex: Knex): Promise<void> {
  await run(knex, "ALTER TABLE number_sequences MODIFY document_type ENUM('invoice','booking','payment') NOT NULL");
  await knex.raw(`INSERT INTO number_sequences (property_id, document_type, series, prefix, next_value) ${startAfter("bookings", "BK-")}`, ["booking", "BK", "BK-"]);
  await knex.raw(`INSERT INTO number_sequences (property_id, document_type, series, prefix, next_value) ${startAfter("payments", "PAY-")}`, ["payment", "PAY", "PAY-"]);
  await run(
    knex,
    "ALTER TABLE payments ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER external_ref, ADD UNIQUE KEY uq_payments_idempotency (property_id, idempotency_key)",
    "ALTER TABLE bookings ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER cancellation_reason, ADD UNIQUE KEY uq_bookings_idempotency (property_id, idempotency_key)",
  );
}

export async function down(knex: Knex): Promise<void> {
  await run(
    knex,
    "ALTER TABLE bookings DROP INDEX uq_bookings_idempotency, DROP COLUMN idempotency_key",
    "ALTER TABLE payments DROP INDEX uq_payments_idempotency, DROP COLUMN idempotency_key",
    "DELETE FROM number_sequences WHERE document_type IN ('booking','payment')",
    "ALTER TABLE number_sequences MODIFY document_type ENUM('invoice') NOT NULL",
  );
}
