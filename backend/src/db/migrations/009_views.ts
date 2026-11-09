import type { Knex } from "knex";
import { run } from "../sql.js";

/**
 * Derived values (DATABASE.md §5): one definition shared by every screen and report.
 * - available_to_allocate counts pending refunds as reserved (DB7).
 * - held_unallocated / advance_held = money received, not refunded, not yet applied to an invoice:
 *   a liability to the guest, never revenue (F3.1).
 */
const VIEWS: Array<[name: string, sql: string]> = [
  [
    "v_allocation_net",
    `CREATE VIEW v_allocation_net AS
SELECT a.id AS allocation_id, a.payment_id, a.invoice_id,
       a.amount - COALESCE((SELECT SUM(r.amount) FROM allocation_releases r WHERE r.payment_allocation_id = a.id), 0) AS net_amount
FROM payment_allocations a`,
  ],
  [
    "v_invoice_balance",
    `CREATE VIEW v_invoice_balance AS
SELECT i.id AS invoice_id, i.property_id, i.booking_id, i.invoice_type, i.invoice_number, i.issue_date, i.status,
       i.net_amount, i.tax_amount, i.gross_amount,
       COALESCE(x.allocated, 0) AS allocated_amount,
       CASE WHEN i.status = 'void' THEN 0 ELSE i.gross_amount - COALESCE(x.allocated, 0) END AS balance_due,
       CASE WHEN i.status = 'void' THEN 'void'
            WHEN COALESCE(x.allocated, 0) = 0 THEN 'unpaid'
            WHEN COALESCE(x.allocated, 0) < i.gross_amount THEN 'partial'
            ELSE 'paid' END AS payment_status
FROM invoices i
LEFT JOIN (SELECT invoice_id, SUM(net_amount) AS allocated FROM v_allocation_net GROUP BY invoice_id) x ON x.invoice_id = i.id`,
  ],
  [
    "v_payment_balance",
    `CREATE VIEW v_payment_balance AS
SELECT p.id AS payment_id, p.property_id, p.booking_id, p.reference, p.method, p.status, p.amount, p.received_at,
       COALESCE(rc.total, 0) AS refunded_completed,
       COALESCE(rr.total, 0) AS refunds_reserved,
       COALESCE(al.total, 0) AS allocated_amount,
       CASE WHEN p.status = 'success' THEN p.amount - COALESCE(rr.total, 0) - COALESCE(al.total, 0) ELSE 0 END AS available_to_allocate,
       CASE WHEN p.status = 'success' THEN p.amount - COALESCE(rc.total, 0) - COALESCE(al.total, 0) ELSE 0 END AS held_unallocated,
       CASE WHEN COALESCE(rc.total, 0) = 0 THEN 'none' WHEN rc.total < p.amount THEN 'partial' ELSE 'full' END AS refund_state
FROM payments p
LEFT JOIN (SELECT payment_id, SUM(amount) AS total FROM refunds WHERE status = 'completed' GROUP BY payment_id) rc ON rc.payment_id = p.id
LEFT JOIN (SELECT payment_id, SUM(amount) AS total FROM refunds WHERE status IN ('requested','completed') GROUP BY payment_id) rr ON rr.payment_id = p.id
LEFT JOIN (SELECT payment_id, SUM(net_amount) AS total FROM v_allocation_net GROUP BY payment_id) al ON al.payment_id = p.id`,
  ],
  [
    "v_booking_balance",
    `CREATE VIEW v_booking_balance AS
SELECT b.id AS booking_id, b.property_id, b.room_total,
       COALESCE(pb.received_net, 0) AS received_net,
       COALESCE(pb.advance_held, 0) AS advance_held,
       COALESCE(ib.invoiced_gross, 0) AS invoiced_gross,
       COALESCE(ib.balance_due, 0) AS invoice_balance_due,
       COALESCE(ib.invoice_count, 0) AS invoice_count
FROM bookings b
LEFT JOIN (SELECT booking_id,
                  SUM(CASE WHEN status = 'success' THEN amount - refunded_completed ELSE 0 END) AS received_net,
                  SUM(held_unallocated) AS advance_held
           FROM v_payment_balance GROUP BY booking_id) pb ON pb.booking_id = b.id
LEFT JOIN (SELECT booking_id,
                  SUM(CASE WHEN status = 'issued' THEN gross_amount ELSE 0 END) AS invoiced_gross,
                  SUM(balance_due) AS balance_due,
                  SUM(CASE WHEN status = 'issued' THEN 1 ELSE 0 END) AS invoice_count
           FROM v_invoice_balance GROUP BY booking_id) ib ON ib.booking_id = b.id`,
  ],
  [
    "v_advances_held",
    `CREATE VIEW v_advances_held AS
SELECT property_id, SUM(advance_held) AS advances_held
FROM v_booking_balance GROUP BY property_id`,
  ],
  [
    "v_room_status",
    `CREATE VIEW v_room_status AS
SELECT r.id AS room_id, r.property_id, r.number, r.floor, r.room_type_id, r.housekeeping_status,
       CASE WHEN r.is_out_of_service THEN 'maintenance' WHEN b.id IS NOT NULL THEN 'occupied' ELSE 'available' END AS status,
       b.id AS current_booking_id
FROM rooms r
LEFT JOIN bookings b ON b.occupied_room_id = r.id`,
  ],
];

export async function up(knex: Knex): Promise<void> {
  await run(knex, ...VIEWS.map(([, sql]) => sql));
}

export async function down(knex: Knex): Promise<void> {
  await run(knex, ...[...VIEWS].reverse().map(([name]) => `DROP VIEW IF EXISTS ${name}`));
}
