import type { Knex } from "knex";
import { run } from "../sql.js";

/**
 * Fix (Gate 3a finding): v_invoice_balance.balance_due returned the integer 0 for void invoices,
 * while every other row returns DECIMAL(…,2) ("0.00"). The CASE branch is cast so the column type is
 * DECIMAL for every row. 009 is never edited. CREATE OR REPLACE keeps the view's grants (migration 010).
 * Views that build on it (v_booking_balance, v_advances_held) need no change.
 */
const SELECT_HEAD = `SELECT i.id AS invoice_id, i.property_id, i.booking_id, i.invoice_type, i.invoice_number, i.issue_date, i.status,
       i.net_amount, i.tax_amount, i.gross_amount,
       COALESCE(x.allocated, 0) AS allocated_amount,`;
const SELECT_TAIL = `
       CASE WHEN i.status = 'void' THEN 'void'
            WHEN COALESCE(x.allocated, 0) = 0 THEN 'unpaid'
            WHEN COALESCE(x.allocated, 0) < i.gross_amount THEN 'partial'
            ELSE 'paid' END AS payment_status
FROM invoices i
LEFT JOIN (SELECT invoice_id, SUM(net_amount) AS allocated FROM v_allocation_net GROUP BY invoice_id) x ON x.invoice_id = i.id`;

export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE OR REPLACE VIEW v_invoice_balance AS
${SELECT_HEAD}
       CASE WHEN i.status = 'void' THEN CAST(0 AS DECIMAL(13,2)) ELSE i.gross_amount - COALESCE(x.allocated, 0) END AS balance_due,${SELECT_TAIL}`,
  );
}

/** Restores the 009 definition exactly. */
export async function down(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE OR REPLACE VIEW v_invoice_balance AS
${SELECT_HEAD}
       CASE WHEN i.status = 'void' THEN 0 ELSE i.gross_amount - COALESCE(x.allocated, 0) END AS balance_due,${SELECT_TAIL}`,
  );
}
