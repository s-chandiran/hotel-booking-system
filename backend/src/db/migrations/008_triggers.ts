import type { Knex } from "knex";
import { run } from "../sql.js";

/**
 * Immutability and single-row guards (DATABASE.md §4, DB3). Each trigger rejects with SQLSTATE 45000.
 * Cross-row sums (F1.2–F1.4) are NOT here: the services enforce them under row locks (DB4).
 * `a <=> b` is MySQL's NULL-safe equality.
 */
const deny = (table: string, event: "UPDATE" | "DELETE"): string =>
  `CREATE TRIGGER trg_${table}_no_${event.toLowerCase()} BEFORE ${event} ON ${table} FOR EACH ROW
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} rows are immutable (${event} rejected)'`;

const unchanged = (cols: string[]): string => cols.map((c) => `NEW.${c} <=> OLD.${c}`).join(" AND ");

const APPEND_ONLY = ["invoice_lines", "invoice_tax_lines", "payment_allocations", "allocation_releases", "audit_events"];

const TRIGGERS: Array<[name: string, sql: string]> = [
  ...APPEND_ONLY.flatMap((t): Array<[string, string]> => [
    [`trg_${t}_no_update`, deny(t, "UPDATE")],
    [`trg_${t}_no_delete`, deny(t, "DELETE")],
  ]),
  ["trg_invoices_no_delete", deny("invoices", "DELETE")],
  ["trg_payments_no_delete", deny("payments", "DELETE")],
  ["trg_refunds_no_delete", deny("refunds", "DELETE")],

  // F4.2, F2.4: an issued invoice may only become void. Everything else stays as issued.
  [
    "trg_invoices_bu",
    `CREATE TRIGGER trg_invoices_bu BEFORE UPDATE ON invoices FOR EACH ROW
BEGIN
  IF OLD.status = 'void' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A void invoice cannot be changed';
  END IF;
  IF NEW.status <> 'void' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'An issued invoice can only be voided';
  END IF;
  IF NOT (${unchanged(["property_id", "booking_id", "invoice_type", "series", "sequence_number", "invoice_number", "issue_date", "issued_at", "net_amount", "tax_amount", "gross_amount", "rounding_rule", "replaces_invoice_id", "created_at", "created_by_user_id"])}) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issued invoice figures are immutable';
  END IF;
END`,
  ],

  // F1.7: payment facts are immutable. Status only pending -> success | failed.
  [
    "trg_payments_bu",
    `CREATE TRIGGER trg_payments_bu BEFORE UPDATE ON payments FOR EACH ROW
BEGIN
  IF NOT (${unchanged(["property_id", "booking_id", "reference", "method", "amount", "received_at", "external_ref", "created_at", "created_by_user_id"])}) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment figures are immutable';
  END IF;
  IF NOT (NEW.status <=> OLD.status) AND NOT (OLD.status = 'pending' AND NEW.status IN ('success','failed')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid payment status change';
  END IF;
END`,
  ],

  // R18: refund facts are immutable. Status only requested -> completed | rejected.
  [
    "trg_refunds_bu",
    `CREATE TRIGGER trg_refunds_bu BEFORE UPDATE ON refunds FOR EACH ROW
BEGIN
  IF NOT (${unchanged(["property_id", "payment_id", "reference", "amount", "method", "reason", "requested_at", "created_at", "created_by_user_id"])}) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Refund figures are immutable';
  END IF;
  IF NOT (NEW.status <=> OLD.status) AND NOT (OLD.status = 'requested' AND NEW.status IN ('completed','rejected')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid refund status change';
  END IF;
END`,
  ],

  // F4.3: a tax component used on any invoice may only be end-dated, never re-rated or deleted.
  [
    "trg_tax_components_bu",
    `CREATE TRIGGER trg_tax_components_bu BEFORE UPDATE ON tax_components FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM invoice_tax_lines WHERE tax_component_id = OLD.id)
     AND NOT (${unchanged(["property_id", "code", "name", "rate_percent", "applies_to", "apply_order", "effective_from"])}) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A used tax component can only be end-dated';
  END IF;
END`,
  ],
  [
    "trg_tax_components_bd",
    `CREATE TRIGGER trg_tax_components_bd BEFORE DELETE ON tax_components FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM invoice_tax_lines WHERE tax_component_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A used tax component cannot be deleted';
  END IF;
END`,
  ],

  // F1.6, R12: allocate only a successful payment, only to an issued (non-void) invoice of the same booking.
  [
    "trg_payment_allocations_bi",
    `CREATE TRIGGER trg_payment_allocations_bi BEFORE INSERT ON payment_allocations FOR EACH ROW
BEGIN
  DECLARE p_status VARCHAR(10);
  DECLARE p_booking BIGINT UNSIGNED;
  DECLARE i_status VARCHAR(10);
  DECLARE i_booking BIGINT UNSIGNED;
  SELECT status, booking_id INTO p_status, p_booking FROM payments WHERE id = NEW.payment_id;
  SELECT status, booking_id INTO i_status, i_booking FROM invoices WHERE id = NEW.invoice_id;
  IF p_status IS NULL OR p_status <> 'success' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only a successful payment can be allocated';
  END IF;
  IF i_status IS NULL OR i_status <> 'issued' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Allocation to a void invoice is not allowed';
  END IF;
  IF NOT (p_booking <=> i_booking) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment and invoice belong to different bookings';
  END IF;
END`,
  ],
];

export async function up(knex: Knex): Promise<void> {
  await run(knex, ...TRIGGERS.map(([, sql]) => sql));
}

export async function down(knex: Knex): Promise<void> {
  await run(knex, ...TRIGGERS.map(([name]) => `DROP TRIGGER IF EXISTS ${name}`));
}
