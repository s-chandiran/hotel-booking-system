import type { Knex } from "knex";
import { CREATED, fk, ID, ownedFks, PROPERTY, run, TABLE_OPTS, UPDATED, dropAll } from "../sql.js";

// DATABASE.md §3.6. Payments belong to a booking (Q23). Allocations link payments and invoices.
// Refunds are separate rows (R18). Releases reverse allocations without edits or negatives (DB2).
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE payments (
  ${ID},
  ${PROPERTY},
  booking_id BIGINT UNSIGNED NOT NULL,
  reference VARCHAR(20) NOT NULL,
  method ENUM('card','upi','cash','bank_transfer') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('pending','success','failed') NOT NULL,
  received_at DATETIME(3) NOT NULL,
  external_ref VARCHAR(100) NULL,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_payments_reference (property_id, reference),
  KEY ix_payments_booking (booking_id),
  CONSTRAINT ck_payments_amount CHECK (amount > 0),
  ${fk("payments", "booking_id", "bookings")},
  ${ownedFks("payments").join(",\n  ")}
) ${TABLE_OPTS}`,
    `CREATE TABLE payment_allocations (
  ${ID},
  payment_id BIGINT UNSIGNED NOT NULL,
  invoice_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  allocated_at DATETIME(3) NOT NULL,
  ${CREATED},
  KEY ix_payment_allocations_payment (payment_id),
  KEY ix_payment_allocations_invoice (invoice_id),
  CONSTRAINT ck_payment_allocations_amount CHECK (amount > 0),
  ${fk("payment_allocations", "payment_id", "payments")},
  ${fk("payment_allocations", "invoice_id", "invoices")},
  ${fk("payment_allocations", "created_by_user_id", "user_accounts")}
) ${TABLE_OPTS}`,
    `CREATE TABLE refunds (
  ${ID},
  ${PROPERTY},
  payment_id BIGINT UNSIGNED NOT NULL,
  reference VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('card','upi','cash','bank_transfer') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('requested','completed','rejected') NOT NULL DEFAULT 'requested',
  requested_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_refunds_reference (property_id, reference),
  KEY ix_refunds_payment (payment_id),
  CONSTRAINT ck_refunds_amount CHECK (amount > 0),
  CONSTRAINT ck_refunds_completed CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  ${fk("refunds", "payment_id", "payments")},
  ${fk("refunds", "approved_by_user_id", "user_accounts")},
  ${ownedFks("refunds").join(",\n  ")}
) ${TABLE_OPTS}`,
    `CREATE TABLE allocation_releases (
  ${ID},
  payment_allocation_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason ENUM('refund','invoice_void','correction') NOT NULL,
  refund_id BIGINT UNSIGNED NULL,
  released_at DATETIME(3) NOT NULL,
  ${CREATED},
  KEY ix_allocation_releases_allocation (payment_allocation_id),
  CONSTRAINT ck_allocation_releases_amount CHECK (amount > 0),
  CONSTRAINT ck_allocation_releases_refund CHECK (reason <> 'refund' OR refund_id IS NOT NULL),
  ${fk("allocation_releases", "payment_allocation_id", "payment_allocations")},
  ${fk("allocation_releases", "refund_id", "refunds")},
  ${fk("allocation_releases", "created_by_user_id", "user_accounts")}
) ${TABLE_OPTS}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropAll(knex, "allocation_releases", "refunds", "payment_allocations", "payments");
}
