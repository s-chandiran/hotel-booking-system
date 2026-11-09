import type { Knex } from "knex";
import { appUserName } from "../../config.js";
import { run } from "../sql.js";

/**
 * Least-privilege grants for the application DB user (DATABASE.md §4, F1.7, DB3).
 * SELECT + INSERT on domain tables, UPDATE only on the listed columns, and no DELETE anywhere.
 * The user itself is created by docker/db-init/01-users.sh. This migration runs as the migrator,
 * which holds GRANT OPTION on the schema.
 */
const UPDATABLE: Record<string, string[]> = {
  properties: ["name", "address", "phone", "email", "country_code", "currency", "timezone", "check_in_time", "check_out_time", "updated_at"],
  staff_members: ["full_name", "email", "job_title", "is_active", "updated_at"],
  user_accounts: ["password_hash", "role", "staff_member_id", "is_active", "last_login_at", "updated_at"],
  room_types: ["name", "base_rate", "capacity", "is_active", "updated_at"],
  rooms: ["room_type_id", "floor", "is_out_of_service", "housekeeping_status", "updated_at"],
  guests: ["full_name", "email", "phone", "country_code", "is_vip", "updated_at"],
  bookings: ["room_id", "status", "guests_count", "check_in_date", "check_out_date", "nightly_rate", "room_total", "expected_arrival_time", "checked_in_at", "checked_out_at", "cancelled_at", "cancellation_reason", "updated_at"],
  tax_components: ["effective_to"],
  number_sequences: ["next_value", "updated_at"],
  invoices: ["status", "void_reason", "voided_at", "voided_by_user_id"],
  payments: ["status", "updated_at"],
  refunds: ["status", "completed_at", "approved_by_user_id", "updated_at"],
  // Append-only: no UPDATE at all.
  invoice_lines: [],
  invoice_tax_lines: [],
  payment_allocations: [],
  allocation_releases: [],
  audit_events: [],
};
const VIEWS = ["v_allocation_net", "v_invoice_balance", "v_payment_balance", "v_booking_balance", "v_advances_held", "v_room_status"];
const READ_ONLY = ["knex_migrations", "knex_migrations_lock"];

function statements(verb: "GRANT" | "REVOKE"): string[] {
  const { user, database } = appUserName();
  const to = verb === "GRANT" ? "TO" : "FROM";
  const who = `'${user}'@'%'`;
  const on = (t: string) => `\`${database}\`.\`${t}\``;
  const out: string[] = [];
  for (const [table, cols] of Object.entries(UPDATABLE)) {
    out.push(`${verb} SELECT, INSERT ON ${on(table)} ${to} ${who}`);
    if (cols.length) out.push(`${verb} UPDATE (${cols.join(", ")}) ON ${on(table)} ${to} ${who}`);
  }
  for (const t of [...VIEWS, ...READ_ONLY]) out.push(`${verb} SELECT ON ${on(t)} ${to} ${who}`);
  return out;
}

export async function up(knex: Knex): Promise<void> {
  await run(knex, ...statements("GRANT"));
}

export async function down(knex: Knex): Promise<void> {
  await run(knex, ...statements("REVOKE"));
}
