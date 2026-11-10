import type { Knex } from "knex";
import { run } from "../sql.js";

/**
 * Guest ID proof for police / front-desk reference (demo scope of Q19).
 * Full number is stored for authorised staff flows; list APIs return a masked form.
 * Guests remain undeletable — retain at least one year for police reference.
 */
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `ALTER TABLE guests
  ADD COLUMN id_document_type ENUM('aadhaar','passport','driving_licence') NULL AFTER country_code,
  ADD COLUMN id_document_number VARCHAR(64) NULL AFTER id_document_type,
  ADD COLUMN id_document_number_last4 CHAR(4) NULL AFTER id_document_number`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await run(
    knex,
    `ALTER TABLE guests
  DROP COLUMN id_document_number_last4,
  DROP COLUMN id_document_number,
  DROP COLUMN id_document_type`,
  );
}
