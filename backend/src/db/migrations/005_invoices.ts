import type { Knex } from "knex";
import { CREATED, fk, ID, ownedFks, PROPERTY, run, TABLE_OPTS, dropAll } from "../sql.js";

// DATABASE.md §3.5. Only issued invoices are stored (DB1), so every row has its legal number.
// Paid status (unpaid/partial/paid) is derived (v_invoice_balance). Only 'void' is stored.
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE invoices (
  ${ID},
  ${PROPERTY},
  booking_id BIGINT UNSIGNED NOT NULL,
  invoice_type ENUM('stay','penalty') NOT NULL,
  series VARCHAR(20) NOT NULL,
  sequence_number INT UNSIGNED NOT NULL,
  invoice_number VARCHAR(40) NOT NULL,
  issue_date DATE NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  net_amount DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) NOT NULL,
  gross_amount DECIMAL(12,2) NOT NULL,
  rounding_rule VARCHAR(30) NOT NULL,
  status ENUM('issued','void') NOT NULL DEFAULT 'issued',
  void_reason VARCHAR(500) NULL,
  voided_at DATETIME(3) NULL,
  voided_by_user_id BIGINT UNSIGNED NULL,
  replaces_invoice_id BIGINT UNSIGNED NULL,
  ${CREATED},
  UNIQUE KEY uq_invoices_sequence (property_id, series, sequence_number),
  UNIQUE KEY uq_invoices_number (property_id, invoice_number),
  KEY ix_invoices_booking (booking_id),
  KEY ix_invoices_issue_date (property_id, issue_date),
  CONSTRAINT ck_invoices_net CHECK (net_amount >= 0),
  CONSTRAINT ck_invoices_tax CHECK (tax_amount >= 0),
  CONSTRAINT ck_invoices_gross CHECK (gross_amount = net_amount + tax_amount),
  CONSTRAINT ck_invoices_void CHECK ((status = 'void') = (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  ${fk("invoices", "booking_id", "bookings")},
  ${fk("invoices", "voided_by_user_id", "user_accounts")},
  ${fk("invoices", "replaces_invoice_id", "invoices")},
  ${ownedFks("invoices").join(",\n  ")}
) ${TABLE_OPTS}`,
    `CREATE TABLE invoice_lines (
  ${ID},
  invoice_id BIGINT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  description VARCHAR(200) NOT NULL,
  quantity DECIMAL(8,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_net DECIMAL(12,2) NOT NULL,
  tax_category ENUM('room','penalty') NOT NULL,
  ${CREATED},
  UNIQUE KEY uq_invoice_lines_no (invoice_id, line_no),
  CONSTRAINT ck_invoice_lines_qty CHECK (quantity > 0),
  CONSTRAINT ck_invoice_lines_price CHECK (unit_price >= 0),
  CONSTRAINT ck_invoice_lines_net CHECK (line_net >= 0),
  ${fk("invoice_lines", "invoice_id", "invoices")},
  ${fk("invoice_lines", "created_by_user_id", "user_accounts")}
) ${TABLE_OPTS}`,
    // The tax snapshot (F4.1). The copied figures are authoritative; tax_component_id is traceability only.
    `CREATE TABLE invoice_tax_lines (
  ${ID},
  invoice_id BIGINT UNSIGNED NOT NULL,
  tax_component_id BIGINT UNSIGNED NULL,
  component_code VARCHAR(20) NOT NULL,
  component_name VARCHAR(80) NOT NULL,
  rate_percent DECIMAL(7,4) NOT NULL,
  taxable_base DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) NOT NULL,
  apply_order TINYINT UNSIGNED NOT NULL,
  ${CREATED},
  UNIQUE KEY uq_invoice_tax_lines_code (invoice_id, component_code),
  CONSTRAINT ck_invoice_tax_lines_rate CHECK (rate_percent >= 0),
  CONSTRAINT ck_invoice_tax_lines_base CHECK (taxable_base >= 0),
  CONSTRAINT ck_invoice_tax_lines_amount CHECK (tax_amount >= 0),
  ${fk("invoice_tax_lines", "invoice_id", "invoices")},
  ${fk("invoice_tax_lines", "tax_component_id", "tax_components")},
  ${fk("invoice_tax_lines", "created_by_user_id", "user_accounts")}
) ${TABLE_OPTS}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropAll(knex, "invoice_tax_lines", "invoice_lines", "invoices");
}
