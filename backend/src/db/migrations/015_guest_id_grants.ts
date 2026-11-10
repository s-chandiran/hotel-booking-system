import type { Knex } from "knex";
import { appUserName } from "../../config.js";
import { run } from "../sql.js";

/**
 * Extend app-user UPDATE grants for guest ID document columns added in 014.
 * 010 is left unchanged (forward-only migrations).
 */
export async function up(knex: Knex): Promise<void> {
  const { user, database } = appUserName();
  await run(
    knex,
    `GRANT UPDATE (id_document_type, id_document_number, id_document_number_last4) ON \`${database}\`.\`guests\` TO '${user}'@'%'`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const { user, database } = appUserName();
  await run(
    knex,
    `REVOKE UPDATE (id_document_type, id_document_number, id_document_number_last4) ON \`${database}\`.\`guests\` FROM '${user}'@'%'`,
  );
}
