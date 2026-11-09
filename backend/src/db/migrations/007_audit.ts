import type { Knex } from "knex";
import { fk, ID, run, TABLE_OPTS, dropAll } from "../sql.js";

// DATABASE.md §3.7. Append-only (trigger in 008). details must never hold PII, passwords, tokens or card data.
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE audit_events (
  ${ID},
  property_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  from_state VARCHAR(30) NULL,
  to_state VARCHAR(30) NULL,
  details JSON NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_events_entity (entity_type, entity_id),
  KEY ix_audit_events_time (property_id, occurred_at),
  ${fk("audit_events", "property_id", "properties")},
  ${fk("audit_events", "actor_user_id", "user_accounts")}
) ${TABLE_OPTS}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropAll(knex, "audit_events");
}
