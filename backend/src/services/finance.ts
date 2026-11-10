/**
 * Financial business events (data-model.md §6a, DATABASE.md §4). Every function is one transaction.
 *
 * Lock order (F1.9), always the same:
 *   booking → payments of that booking (id asc) → invoices of that booking (id asc)
 *   → number_sequences row (invoice issue) / refund row (refund decisions)
 * Every financial event locks the booking first, so events on one booking are serialised. Cross-row
 * limits (F1.2–F1.4) are checked after the locks, using locking reads (FOR SHARE), which always read
 * the latest committed rows.
 */
import type { Knex } from "knex";
import type { Db } from "../db/knex.js";
import { assert } from "../domain/errors.js";
import { fromMinor, lineTotal, min, percentOf, ROUNDING_RULE, sum, toMinor, type Minor } from "../domain/money.js";
import { audit, inTx, insertId, nowUtc, type Actor } from "./context.js";
import { isDuplicateOn, nextReference } from "./references.js";

type Trx = Knex.Transaction;
type PaymentMethod = "card" | "upi" | "cash" | "bank_transfer";

interface BookingRow { id: number; property_id: number; status: string }
interface PaymentRow { id: number; booking_id: number; amount: string; status: "pending" | "success" | "failed"; method: PaymentMethod }
interface InvoiceRow { id: number; booking_id: number; status: "issued" | "void"; gross_amount: string; invoice_type: "stay" | "penalty" }

// ---------- locking and figures ----------

async function lockBookingGraph(trx: Trx, actor: Actor, bookingId: number) {
  const booking = await trx<BookingRow>("bookings").where({ id: bookingId, property_id: actor.propertyId }).forUpdate().first();
  assert(booking, "BOOKING_NOT_FOUND", "Booking not found");
  const payments = await trx<PaymentRow>("payments").where({ booking_id: bookingId }).orderBy("id").forUpdate();
  const invoices = await trx<InvoiceRow>("invoices").where({ booking_id: bookingId }).orderBy("id").forUpdate();
  return { booking, payments, invoices };
}

async function sumRaw(trx: Trx, sql: string, bindings: readonly (string | number)[]): Promise<Minor> {
  const [rows] = (await trx.raw(sql, bindings)) as unknown as [Array<{ v: string | number | null }>];
  return toMinor(String(rows[0]?.v ?? "0"));
}

// No subqueries in locking reads: in MySQL a subquery inside SELECT … FOR SHARE is a non-locking
// snapshot read. Each total is therefore two flat locking queries (allocations, then releases).
async function netAllocated(trx: Trx, col: "payment_id" | "invoice_id", id: number): Promise<Minor> {
  const allocated = await sumRaw(trx, `SELECT COALESCE(SUM(amount),0) AS v FROM payment_allocations WHERE ${col} = ? FOR SHARE`, [id]);
  const released = await sumRaw(trx, `SELECT COALESCE(SUM(r.amount),0) AS v FROM allocation_releases r JOIN payment_allocations a ON a.id = r.payment_allocation_id WHERE a.${col} = ? FOR SHARE`, [id]);
  return allocated - released;
}
const allocatedToPayment = (trx: Trx, paymentId: number): Promise<Minor> => netAllocated(trx, "payment_id", paymentId);
const allocatedToInvoice = (trx: Trx, invoiceId: number): Promise<Minor> => netAllocated(trx, "invoice_id", invoiceId);

/** Requested + completed refunds: a pending refund reserves its amount (F1.4, DB7). */
const refundsReserved = (trx: Trx, paymentId: number): Promise<Minor> =>
  sumRaw(trx, "SELECT COALESCE(SUM(amount),0) AS v FROM refunds WHERE payment_id = ? AND status IN ('requested','completed') FOR SHARE", [paymentId]);

async function availableToAllocate(trx: Trx, p: PaymentRow): Promise<Minor> {
  if (p.status !== "success") return 0n;
  return toMinor(p.amount) - (await refundsReserved(trx, p.id)) - (await allocatedToPayment(trx, p.id));
}

async function invoiceOpen(trx: Trx, inv: InvoiceRow): Promise<Minor> {
  if (inv.status !== "issued") return 0n;
  return toMinor(inv.gross_amount) - (await allocatedToInvoice(trx, inv.id));
}

async function allocate(trx: Trx, actor: Actor, p: PaymentRow, inv: InvoiceRow, amount: Minor): Promise<void> {
  assert(amount > 0n, "INVALID_AMOUNT", "Allocation must be positive");
  assert(p.status === "success", "PAYMENT_NOT_SETTLED", "Only a successful payment can be allocated");
  assert(inv.status === "issued", "INVOICE_VOID", "Cannot allocate to a void invoice");
  assert(amount <= (await availableToAllocate(trx, p)), "ALLOCATION_EXCEEDS_PAYMENT", "Allocation exceeds the payment's unallocated amount"); // F1.2
  assert(amount <= (await invoiceOpen(trx, inv)), "ALLOCATION_EXCEEDS_INVOICE", "Allocation exceeds the invoice balance"); // F1.3
  const id = await insertId(trx("payment_allocations").insert({ payment_id: p.id, invoice_id: inv.id, amount: fromMinor(amount), allocated_at: nowUtc(), created_by_user_id: actor.userId }));
  await audit(trx, actor, { entityType: "payment_allocation", entityId: id, action: "allocate", details: { payment_id: p.id, invoice_id: inv.id, amount: fromMinor(amount) } });
}

/** Applies available payment money to open invoices, oldest first (R16, "payment recorded" event). */
async function autoAllocate(trx: Trx, actor: Actor, payments: PaymentRow[], invoices: InvoiceRow[]): Promise<void> {
  for (const inv of invoices) {
    let open = await invoiceOpen(trx, inv);
    for (const p of payments) {
      if (open <= 0n) break;
      const avail = await availableToAllocate(trx, p);
      if (avail <= 0n) continue;
      const amt = min(avail, open);
      await allocate(trx, actor, p, inv, amt);
      open -= amt;
    }
  }
}

async function releaseAllocations(trx: Trx, actor: Actor, where: { paymentId?: number; invoiceId?: number }, reason: "refund" | "invoice_void", limit: Minor | null, refundId: number | null): Promise<Minor> {
  const col = where.paymentId !== undefined ? "payment_id" : "invoice_id";
  const key = where.paymentId ?? where.invoiceId!;
  const [rows] = (await trx.raw(
    `SELECT a.id, a.amount - COALESCE(SUM(r.amount),0) AS net
     FROM payment_allocations a LEFT JOIN allocation_releases r ON r.payment_allocation_id = a.id
     WHERE a.${col} = ? GROUP BY a.id, a.amount ORDER BY a.id DESC FOR SHARE`,
    [key],
  )) as unknown as [Array<{ id: number; net: string }>];
  let remaining = limit;
  let released = 0n;
  for (const row of rows) {
    const net = toMinor(row.net);
    if (net <= 0n) continue;
    const amt = remaining === null ? net : min(net, remaining);
    if (amt <= 0n) break;
    await trx("allocation_releases").insert({ payment_allocation_id: row.id, amount: fromMinor(amt), reason, refund_id: refundId, released_at: nowUtc(), created_by_user_id: actor.userId });
    released += amt;
    if (remaining !== null) remaining -= amt;
  }
  return released;
}

async function findBookingIdOf(db: Db, actor: Actor, table: "payments" | "invoices", id: number): Promise<number> {
  // Deliberately a plain read: booking_id is immutable, and taking a shared lock here would be upgraded
  // to an exclusive lock inside lockBookingGraph (a deadlock risk). Every limit check later uses locking
  // reads, so the snapshot this opens is never used for a financial decision.
  const row = await db(table).where({ id, property_id: actor.propertyId }).first("booking_id");
  assert(row, table === "payments" ? "PAYMENT_NOT_FOUND" : "INVOICE_NOT_FOUND", `${table === "payments" ? "Payment" : "Invoice"} not found`);
  return row.booking_id as number;
}

// ---------- payments ----------

export interface RecordPaymentInput {
  bookingId: number;
  /** Omit to have the server generate the next `PAY-` reference (D-E). Only the seed supplies one. */
  reference?: string;
  method: PaymentMethod;
  amount: string;
  status: "pending" | "success";
  receivedAt?: Date;
  externalRef?: string | null;
  /** Same key again returns the original payment instead of recording it twice. */
  idempotencyKey?: string | null;
}

async function replayPayment(db: Db, actor: Actor, input: RecordPaymentInput): Promise<number | null> {
  const prior = await db("payments").where({ property_id: actor.propertyId, idempotency_key: input.idempotencyKey }).first("id", "booking_id", "amount", "method");
  if (!prior) return null;
  const same = prior.booking_id === input.bookingId && toMinor(String(prior.amount)) === toMinor(input.amount) && prior.method === input.method;
  assert(same, "IDEMPOTENCY_CONFLICT", "This request key was already used for a different payment");
  return prior.id as number;
}

export interface RecordPaymentResult {
  paymentId: number;
  /** Invoices that reached a zero open balance in this committed payment (one-shot notify). */
  newlyPaidInvoices: NewlyPaidInvoice[];
}

export interface NewlyPaidInvoice {
  invoiceId: number;
  invoiceNumber: string;
  guestName: string;
  bookingReference: string;
}

/** Money received for a booking, possibly before any invoice exists (an advance, Q23). */
export async function recordPayment(db: Db, actor: Actor, input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (input.idempotencyKey) {
    const prior = await replayPayment(db, actor, input);
    if (prior !== null) return { paymentId: prior, newlyPaidInvoices: [] };
  }
  try {
    return await insertPayment(db, actor, input);
  } catch (e) {
    // A concurrent request with the same key won the race: return its payment.
    if (input.idempotencyKey && isDuplicateOn(e, "uq_payments_idempotency")) {
      const prior = await replayPayment(db, actor, input);
      if (prior !== null) return { paymentId: prior, newlyPaidInvoices: [] };
    }
    throw e;
  }
}

/**
 * After allocation, mark issued invoices with zero open balance as notified exactly once
 * (audit action payment_paid_notified) so desktop SSE does not duplicate.
 */
async function collectNewlyPaidInvoices(trx: Trx, actor: Actor, bookingId: number, invoices: InvoiceRow[]): Promise<NewlyPaidInvoice[]> {
  const newly: NewlyPaidInvoice[] = [];
  for (const inv of invoices) {
    if (inv.status !== "issued") continue;
    const open = await invoiceOpen(trx, inv);
    if (open > 0n) continue;
    const prior = await trx("audit_events")
      .where({ property_id: actor.propertyId, entity_type: "invoice", entity_id: inv.id, action: "payment_paid_notified" })
      .first("id");
    if (prior) continue;
    const meta = await trx("invoices as i")
      .join("bookings as b", "b.id", "i.booking_id")
      .join("guests as g", "g.id", "b.guest_id")
      .where("i.id", inv.id)
      .first("i.invoice_number", "g.full_name", "b.reference");
    if (!meta) continue;
    await audit(trx, actor, { entityType: "invoice", entityId: inv.id, action: "payment_paid_notified", toState: "paid", details: { booking_id: bookingId } });
    newly.push({
      invoiceId: inv.id,
      invoiceNumber: String(meta.invoice_number),
      guestName: String(meta.full_name),
      bookingReference: String(meta.reference),
    });
  }
  return newly;
}

function insertPayment(db: Db, actor: Actor, input: RecordPaymentInput): Promise<RecordPaymentResult> {
  return inTx(db, async (trx) => {
    const { payments, invoices } = await lockBookingGraph(trx, actor, input.bookingId);
    const amount = toMinor(input.amount);
    assert(amount > 0n, "INVALID_AMOUNT", "Payment amount must be positive");
    const reference = input.reference ?? (await nextReference(trx, actor, "payment"));
    const id = await insertId(
      trx("payments").insert({
        property_id: actor.propertyId, booking_id: input.bookingId, reference, idempotency_key: input.idempotencyKey ?? null, method: input.method,
        amount: fromMinor(amount), status: input.status, received_at: input.receivedAt ?? nowUtc(), external_ref: input.externalRef ?? null, created_by_user_id: actor.userId,
      }),
    );
    await audit(trx, actor, { entityType: "payment", entityId: id, action: "record", toState: input.status, details: { booking_id: input.bookingId, amount: fromMinor(amount), method: input.method } });
    let newlyPaidInvoices: NewlyPaidInvoice[] = [];
    if (input.status === "success") {
      const p: PaymentRow = { id, booking_id: input.bookingId, amount: fromMinor(amount), status: "success", method: input.method };
      await autoAllocate(trx, actor, [...payments, p], invoices);
      newlyPaidInvoices = await collectNewlyPaidInvoices(trx, actor, input.bookingId, invoices);
    }
    return { paymentId: id, newlyPaidInvoices };
  });
}

/** pending → success | failed. A success is then applied to open invoices. */
export function settlePayment(db: Db, actor: Actor, input: { paymentId: number; outcome: "success" | "failed" }): Promise<void> {
  return inTx(db, async (trx) => {
    const bookingId = await findBookingIdOf(trx, actor, "payments", input.paymentId);
    const { payments, invoices } = await lockBookingGraph(trx, actor, bookingId);
    const p = payments.find((x) => x.id === input.paymentId)!;
    assert(p.status === "pending", "PAYMENT_NOT_PENDING", "Only a pending payment can be settled");
    await trx("payments").where({ id: p.id }).update({ status: input.outcome, updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "payment", entityId: p.id, action: "settle", fromState: "pending", toState: input.outcome });
    if (input.outcome === "success") {
      p.status = "success";
      await autoAllocate(trx, actor, payments, invoices);
    }
  });
}

// ---------- invoices ----------

export interface IssueInvoiceInput {
  bookingId: number;
  invoiceType: "stay" | "penalty";
  /** Business date in the property timezone (YYYY-MM-DD). Selects the tax components in effect. */
  issueDate: string;
  series: string;
  lines: Array<{ description: string; quantity: string; unitPrice: string }>;
  replacesInvoiceId?: number | null;
}

interface TaxComponentRow { id: number; code: string; name: string; rate_percent: string; apply_order: number }

/**
 * Issues an invoice: legal number, tax snapshot and auto-allocation in one transaction (F2, F4, R16).
 * Provisional rules from the approved assumptions:
 *  - stay invoice: booking not cancelled, at most one issued stay invoice per booking (Q7)
 *  - penalty invoice: booking cancelled (Q13)
 *  - every tax component in effect applies to the invoice net, rounded per component (Q6)
 */
export function issueInvoice(
  db: Db,
  actor: Actor,
  input: IssueInvoiceInput,
): Promise<{ invoiceId: number; invoiceNumber: string; newlyPaidInvoices: NewlyPaidInvoice[] }> {
  return inTx(db, async (trx) => {
    const { booking, payments, invoices } = await lockBookingGraph(trx, actor, input.bookingId);
    const category = input.invoiceType === "stay" ? "room" : "penalty";
    if (input.invoiceType === "stay") {
      assert(booking.status !== "cancelled", "BOOKING_CANCELLED", "A cancelled booking gets a penalty invoice, not a stay invoice");
      assert(!invoices.some((i) => i.invoice_type === "stay" && i.status === "issued"), "STAY_INVOICE_EXISTS", "This booking already has an issued stay invoice");
    } else {
      assert(booking.status === "cancelled", "BOOKING_NOT_CANCELLED", "Penalty invoices are only for cancelled bookings");
    }
    if (input.replacesInvoiceId != null) {
      const old = invoices.find((i) => i.id === input.replacesInvoiceId);
      assert(old && old.status === "void", "INVALID_REPLACEMENT", "Only a void invoice of the same booking can be replaced");
    }
    assert(input.lines.length > 0, "NO_LINES", "An invoice needs at least one line");

    const lines = input.lines.map((l, i) => {
      assert(l.description.trim().length > 0, "INVALID_LINE", "Line description is required");
      const unit = toMinor(l.unitPrice);
      assert(unit >= 0n, "INVALID_LINE", "Unit price cannot be negative");
      assert(toMinor(l.quantity) > 0n, "INVALID_LINE", "Quantity must be positive");
      return { line_no: i + 1, description: l.description, quantity: l.quantity, unit_price: fromMinor(unit), line_net: lineTotal(unit, l.quantity) };
    });
    const net = sum(lines.map((l) => l.line_net));

    const components: TaxComponentRow[] = await trx("tax_components")
      .where({ property_id: actor.propertyId, applies_to: category })
      .where("effective_from", "<=", input.issueDate)
      .where((q) => q.whereNull("effective_to").orWhere("effective_to", ">", input.issueDate))
      .orderBy([{ column: "apply_order" }, { column: "id" }]);
    assert(new Set(components.map((c) => c.code)).size === components.length, "TAX_CONFIG_AMBIGUOUS", "Two tax components with the same code are in effect");
    const taxLines = components.map((c) => ({ c, amount: percentOf(net, c.rate_percent) }));
    const tax = sum(taxLines.map((t) => t.amount));

    // F2.1: the sequence row lock makes a concurrent issuer wait; the unique key is the backstop.
    const seq = await trx("number_sequences").where({ property_id: actor.propertyId, document_type: "invoice", series: input.series }).forUpdate().first();
    assert(seq, "SEQUENCE_NOT_CONFIGURED", `No invoice number series ${input.series}`);
    const n = seq.next_value as number;
    await trx("number_sequences").where({ id: seq.id }).update({ next_value: n + 1, updated_at: nowUtc() });
    const invoiceNumber = `${seq.prefix as string}${String(n).padStart(5, "0")}`; // padding provisional (Q11)

    const invoiceId = await insertId(
      trx("invoices").insert({
        property_id: actor.propertyId, booking_id: booking.id, invoice_type: input.invoiceType, series: input.series, sequence_number: n, invoice_number: invoiceNumber,
        issue_date: input.issueDate, issued_at: nowUtc(), net_amount: fromMinor(net), tax_amount: fromMinor(tax), gross_amount: fromMinor(net + tax),
        rounding_rule: ROUNDING_RULE, replaces_invoice_id: input.replacesInvoiceId ?? null, created_by_user_id: actor.userId,
      }),
    );
    await trx("invoice_lines").insert(lines.map((l) => ({ invoice_id: invoiceId, line_no: l.line_no, description: l.description, quantity: l.quantity, unit_price: l.unit_price, line_net: fromMinor(l.line_net), tax_category: category, created_by_user_id: actor.userId })));
    if (taxLines.length) {
      await trx("invoice_tax_lines").insert(taxLines.map(({ c, amount }) => ({ invoice_id: invoiceId, tax_component_id: c.id, component_code: c.code, component_name: c.name, rate_percent: c.rate_percent, taxable_base: fromMinor(net), tax_amount: fromMinor(amount), apply_order: c.apply_order, created_by_user_id: actor.userId })));
    }
    await audit(trx, actor, { entityType: "invoice", entityId: invoiceId, action: "issue", toState: "issued", details: { booking_id: booking.id, invoice_number: invoiceNumber, gross: fromMinor(net + tax) } });

    const created: InvoiceRow = { id: invoiceId, booking_id: booking.id, status: "issued", gross_amount: fromMinor(net + tax), invoice_type: input.invoiceType };
    const allInvoices = [...invoices, created];
    await autoAllocate(trx, actor, payments, allInvoices);
    const newlyPaidInvoices = await collectNewlyPaidInvoices(trx, actor, booking.id, allInvoices);
    return { invoiceId, invoiceNumber, newlyPaidInvoices };
  });
}

/** issued → void. The number stays (F2.4). Allocated money returns to the booking's advance. */
export function voidInvoice(db: Db, actor: Actor, input: { invoiceId: number; reason: string }): Promise<void> {
  return inTx(db, async (trx) => {
    assert(input.reason.trim().length > 0, "REASON_REQUIRED", "A void reason is required");
    const bookingId = await findBookingIdOf(trx, actor, "invoices", input.invoiceId);
    const { invoices } = await lockBookingGraph(trx, actor, bookingId);
    const inv = invoices.find((i) => i.id === input.invoiceId)!;
    assert(inv.status === "issued", "INVOICE_VOID", "Invoice is already void");
    await releaseAllocations(trx, actor, { invoiceId: inv.id }, "invoice_void", null, null);
    await trx("invoices").where({ id: inv.id }).update({ status: "void", void_reason: input.reason, voided_at: nowUtc(), voided_by_user_id: actor.userId });
    await audit(trx, actor, { entityType: "invoice", entityId: inv.id, action: "void", fromState: "issued", toState: "void" });
  });
}

// ---------- refunds ----------

export interface RequestRefundInput {
  paymentId: number;
  /** Omit to have the server generate the next `RF-` reference. Only the seed supplies one. */
  reference?: string;
  amount: string;
  reason: string;
  /** Defaults to the original payment's method (Q8b assumption). */
  method?: PaymentMethod;
  /** Same key again returns the original refund request instead of creating a second one. */
  idempotencyKey?: string | null;
}

async function replayRefund(db: Db, actor: Actor, input: RequestRefundInput): Promise<number | null> {
  if (!input.idempotencyKey) return null;
  const prior = await db("refunds").where({ property_id: actor.propertyId, idempotency_key: input.idempotencyKey }).first("id", "payment_id", "amount", "reason");
  if (!prior) return null;
  const same = prior.payment_id === input.paymentId && toMinor(String(prior.amount)) === toMinor(input.amount) && String(prior.reason) === input.reason.trim();
  assert(same, "IDEMPOTENCY_CONFLICT", "This request key was already used for a different refund");
  return prior.id as number;
}

/** A new refund row; the original payment is never modified (R18). Releases allocations if needed (F1.5). */
export async function requestRefund(db: Db, actor: Actor, input: RequestRefundInput): Promise<number> {
  if (input.idempotencyKey) {
    const prior = await replayRefund(db, actor, input);
    if (prior !== null) return prior;
  }
  try {
    return await insertRefund(db, actor, input);
  } catch (e) {
    if (input.idempotencyKey && isDuplicateOn(e, "uq_refunds_idempotency")) {
      const prior = await replayRefund(db, actor, input);
      if (prior !== null) return prior;
    }
    throw e;
  }
}

function insertRefund(db: Db, actor: Actor, input: RequestRefundInput): Promise<number> {
  return inTx(db, async (trx) => {
    assert(input.reason.trim().length > 0, "REASON_REQUIRED", "A refund reason is required");
    const bookingId = await findBookingIdOf(trx, actor, "payments", input.paymentId);
    const { payments } = await lockBookingGraph(trx, actor, bookingId);
    const p = payments.find((x) => x.id === input.paymentId)!;
    assert(p.status === "success", "PAYMENT_NOT_SETTLED", "Only a successful payment can be refunded");
    const amount = toMinor(input.amount);
    assert(amount > 0n, "INVALID_AMOUNT", "Refund amount must be positive");
    const paid = toMinor(p.amount);
    const reserved = await refundsReserved(trx, p.id);
    assert(reserved + amount <= paid, "REFUND_EXCEEDS_PAYMENT", "Refunds would exceed the original payment"); // F1.4

    const reference = input.reference ?? (await nextReference(trx, actor, "refund"));
    const refundId = await insertId(
      trx("refunds").insert({
        property_id: actor.propertyId, payment_id: p.id, reference, amount: fromMinor(amount), method: input.method ?? p.method,
        reason: input.reason.trim(), idempotency_key: input.idempotencyKey ?? null, status: "requested", requested_at: nowUtc(), created_by_user_id: actor.userId,
      }),
    );
    const shortfall = (await allocatedToPayment(trx, p.id)) + reserved + amount - paid;
    if (shortfall > 0n) {
      const released = await releaseAllocations(trx, actor, { paymentId: p.id }, "refund", shortfall, refundId);
      assert(released === shortfall, "ALLOCATION_RELEASE_FAILED", "Could not release enough allocated money for the refund");
    }
    await audit(trx, actor, { entityType: "refund", entityId: refundId, action: "request", toState: "requested", details: { payment_id: p.id, amount: fromMinor(amount) } });
    return refundId;
  });
}

async function decideRefund(db: Db, actor: Actor, refundId: number, outcome: "completed" | "rejected"): Promise<void> {
  await inTx(db, async (trx) => {
    const ref = await trx("refunds").where({ id: refundId, property_id: actor.propertyId }).first("payment_id"); // payment_id is immutable
    assert(ref, "REFUND_NOT_FOUND", "Refund not found");
    const bookingId = await findBookingIdOf(trx, actor, "payments", ref.payment_id as number);
    const { payments, invoices } = await lockBookingGraph(trx, actor, bookingId);
    const refund = await trx("refunds").where({ id: refundId }).forUpdate().first("status");
    assert(refund?.status === "requested", "REFUND_NOT_PENDING", "Only a requested refund can be decided");
    await trx("refunds").where({ id: refundId }).update(
      outcome === "completed" ? { status: "completed", completed_at: nowUtc(), approved_by_user_id: actor.userId, updated_at: nowUtc() } : { status: "rejected", approved_by_user_id: actor.userId, updated_at: nowUtc() },
    );
    await audit(trx, actor, { entityType: "refund", entityId: refundId, action: outcome === "completed" ? "complete" : "reject", fromState: "requested", toState: outcome });
    // A rejected refund frees its reserved money, which goes back to open invoices.
    if (outcome === "rejected") await autoAllocate(trx, actor, payments, invoices);
  });
}

export const completeRefund = (db: Db, actor: Actor, refundId: number): Promise<void> => decideRefund(db, actor, refundId, "completed");
export const rejectRefund = (db: Db, actor: Actor, refundId: number): Promise<void> => decideRefund(db, actor, refundId, "rejected");
