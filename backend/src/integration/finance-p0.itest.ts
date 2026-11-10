/**
 * Gate 3b P0: financial safeguards under real concurrency, against MySQL, as the restricted app user.
 * Each refusal is recorded with the boundary that stopped it (service / grant / trigger / check / unique /
 * column), and every test ends with the independent invariant check from harness.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { toMinor } from "../domain/money.js";
import { completeRefund, issueInvoice, recordPayment, rejectRefund, requestRefund, settlePayment, voidInvoice, type IssueInvoiceInput } from "../services/finance.js";
import { createFixture, invariantViolations, parallel, printReport, record, refusal, settle, type Fixture } from "./harness.js";

let fx: Fixture;
const ISSUE_DATE = "2026-11-09";

const invoice = (bookingId: number, type: "stay" | "penalty" = "stay", unitPrice = "1000.00", description = "Room night"): IssueInvoiceInput => ({
  bookingId, invoiceType: type, issueDate: ISSUE_DATE, series: fx.series, lines: [{ description, quantity: "1", unitPrice }],
});
const pay = async (bookingId: number, amount: string, status: "success" | "pending" = "success") =>
  (await recordPayment(fx.db, fx.actor, { bookingId, reference: fx.ref("P"), method: "card", amount, status })).paymentId;
const refund = (paymentId: number, amount: string) => requestRefund(fx.db, fx.actor, { paymentId, reference: fx.ref("R"), amount, reason: "integration test" });

const nextValue = async (): Promise<number> =>
  (await fx.db("number_sequences").where({ property_id: fx.actor.propertyId, series: fx.series }).first("next_value")).next_value as number;
const invoiceBal = async (id: number) => fx.db("v_invoice_balance").where({ invoice_id: id }).first();
const paymentBal = async (id: number) => fx.db("v_payment_balance").where({ payment_id: id }).first();
const bookingBal = async (id: number) => fx.db("v_booking_balance").where({ booking_id: id }).first();
const minor = (v: unknown): bigint => toMinor(String(v));
const b = (r: { boundary: string; code: string }): string => `${r.boundary}: ${r.code}`;

beforeAll(async () => {
  fx = await createFixture();
});
afterEach(async () => {
  expect(await invariantViolations(fx.db, fx.actor.propertyId)).toEqual([]);
});
afterAll(async () => {
  printReport();
  await fx?.db.destroy();
});

describe("P0-1 invoice numbering", () => {
  it("10 concurrent issues on different bookings: unique, contiguous numbers", async () => {
    const bookings = await Promise.all(Array.from({ length: 10 }, () => fx.booking()));
    const before = await nextValue();
    const { ok, refused } = settle(await parallel(10, (i) => issueInvoice(fx.db, fx.actor, invoice(bookings[i]!))));
    expect(refused).toEqual([]);
    const nums = (await fx.db("invoices").whereIn("id", ok.map((r) => r.invoiceId)).orderBy("sequence_number").pluck("sequence_number")) as number[];
    expect(nums).toEqual(Array.from({ length: 10 }, (_, k) => before + k));
    expect(await nextValue()).toBe(before + 10);
    record("P0-1", "10 parallel issues, 10 bookings", `10 issued, numbers ${before}..${before + 9}, no gaps`, "sequence row lock (service); uq_invoices_sequence backstop");
  });

  it("5 concurrent stay invoices on one booking: one issued, the others consume no number", async () => {
    const bookingId = await fx.booking();
    const before = await nextValue();
    const { ok, refused } = settle(await parallel(5, () => issueInvoice(fx.db, fx.actor, invoice(bookingId))));
    expect(ok).toHaveLength(1);
    expect(refused).toEqual(Array(4).fill({ boundary: "service", code: "STAY_INVOICE_EXISTS" }));
    expect(await nextValue()).toBe(before + 1);
    record("P0-1", "5 parallel stay invoices, 1 booking", "1 issued, 4 refused, 1 number used", b(refused[0]!));
  });

  it("failed issues roll back their numbers while concurrent successes stay contiguous", async () => {
    const bookings = await Promise.all(Array.from({ length: 6 }, () => fx.booking()));
    const before = await nextValue();
    // Odd tasks fail inside the transaction, after the number was taken: a 201-char line description.
    const { ok, refused } = settle(await parallel(6, (i) => issueInvoice(fx.db, fx.actor, invoice(bookings[i]!, "stay", "1000.00", i % 2 ? "x".repeat(201) : "Room night"))));
    expect(ok).toHaveLength(3);
    expect(refused.map((r) => r.boundary)).toEqual(["column", "column", "column"]);
    expect(await nextValue()).toBe(before + 3);
    record("P0-1", "6 parallel issues, 3 fail after taking a number", "3 issued, 3 rolled back, numbers contiguous", `${b(refused[0]!)} → transaction rollback`);
  });

  it("an outer transaction rollback returns the number", async () => {
    const bookingId = await fx.booking();
    const before = await nextValue();
    await expect(
      fx.db.transaction(async (trx) => {
        await issueInvoice(trx, fx.actor, invoice(bookingId));
        throw new Error("abort after issue");
      }),
    ).rejects.toThrow("abort after issue");
    expect(await nextValue()).toBe(before);
    const { invoiceId } = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    expect((await fx.db("invoices").where({ id: invoiceId }).first("sequence_number")).sequence_number).toBe(before);
    record("P0-1", "issue then roll back the transaction", "number reused by the next issue, no gap", "transaction rollback");
  });

  it("a void number is kept and never reused", async () => {
    const bookingId = await fx.booking();
    const first = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    await voidInvoice(fx.db, fx.actor, { invoiceId: first.invoiceId, reason: "integration test" });
    const second = await issueInvoice(fx.db, fx.actor, { ...invoice(bookingId), replacesInvoiceId: first.invoiceId });
    const rows = await fx.db("invoices").whereIn("id", [first.invoiceId, second.invoiceId]).orderBy("id").select("status", "sequence_number", "invoice_number");
    expect(rows[0]).toMatchObject({ status: "void", invoice_number: first.invoiceNumber });
    expect(rows[1]!.sequence_number).toBe((rows[0]!.sequence_number as number) + 1);
    record("P0-1", "void, then issue the replacement", "void keeps its number, replacement gets the next one", "service");

    const dup = await refusal(
      fx.db("invoices").insert({
        property_id: fx.actor.propertyId, booking_id: bookingId, invoice_type: "stay", series: fx.series, sequence_number: rows[0]!.sequence_number, invoice_number: `${first.invoiceNumber}-X`,
        issue_date: ISSUE_DATE, issued_at: new Date(), net_amount: "1.00", tax_amount: "0.00", gross_amount: "1.00", rounding_rule: "half_up_component_2dp",
      }),
    );
    expect(dup.boundary).toBe("unique");
    record("P0-1", "direct INSERT reusing the void sequence number (app user)", "refused", b(dup));

    const revive = await refusal(fx.db("invoices").where({ id: first.invoiceId }).update({ status: "issued" }));
    expect(["trigger", "grant"]).toContain(revive.boundary);
    record("P0-1", "direct UPDATE void → issued (app user)", "refused", b(revive));
  });
});

describe("P0-2 over-allocation", () => {
  it("payment limit: 3 concurrent penalty invoices of 560 against one 1000 advance", async () => {
    const bookingId = await fx.booking({ status: "cancelled" });
    const paymentId = await pay(bookingId, "1000.00");
    const { ok, refused } = settle(await parallel(3, () => issueInvoice(fx.db, fx.actor, invoice(bookingId, "penalty", "500.00", "Cancellation penalty"))));
    expect(refused).toEqual([]);
    const p = await paymentBal(paymentId);
    expect(minor(p.allocated_amount)).toBe(100_000n);
    expect(minor(p.available_to_allocate)).toBe(0n);
    let due = 0n;
    for (const r of ok) due += minor((await invoiceBal(r.invoiceId)).balance_due);
    expect(due).toBe(168_000n - 100_000n);
    record("P0-2", "3 parallel invoices (1680) vs one 1000 payment", "allocated exactly 1000, 680 still due", "booking row lock + FOR SHARE totals (service)");
  });

  it("invoice limit: 5 concurrent payments of 500 against one 1120 invoice", async () => {
    const bookingId = await fx.booking();
    const { invoiceId } = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    const { refused } = settle(await parallel(5, () => pay(bookingId, "500.00")));
    expect(refused).toEqual([]);
    expect(minor((await invoiceBal(invoiceId)).allocated_amount)).toBe(112_000n);
    expect(minor((await bookingBal(bookingId)).advance_held)).toBe(250_000n - 112_000n);
    record("P0-2", "5 parallel payments (2500) vs one 1120 invoice", "invoice allocated exactly 1120, 1380 held as advance", "booking row lock + FOR SHARE totals (service)");
  });

  it("invoice limit: 4 concurrent settlements of pending payments", async () => {
    const bookingId = await fx.booking();
    const pending: number[] = [];
    for (let i = 0; i < 4; i++) pending.push(await pay(bookingId, "400.00", "pending"));
    const { invoiceId } = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    expect(minor((await invoiceBal(invoiceId)).allocated_amount)).toBe(0n);
    const { refused } = settle(await parallel(4, (i) => settlePayment(fx.db, fx.actor, { paymentId: pending[i]!, outcome: "success" })));
    expect(refused).toEqual([]);
    expect(minor((await invoiceBal(invoiceId)).allocated_amount)).toBe(112_000n);
    expect(minor((await bookingBal(bookingId)).advance_held)).toBe(160_000n - 112_000n);
    record("P0-2", "4 parallel settlements (1600) vs one 1120 invoice", "allocated exactly 1120, 480 advance", "booking row lock + FOR SHARE totals (service)");
  });

  it("documents the boundary: an over-allocating direct INSERT by the app user is not blocked by the DB", async () => {
    const bookingId = await fx.booking();
    const { invoiceId } = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    const paymentId = await pay(bookingId, "1120.00"); // fully allocated by the service
    let inserted = false;
    await fx.db
      .transaction(async (trx) => {
        await trx("payment_allocations").insert({ payment_id: paymentId, invoice_id: invoiceId, amount: "5000.00", allocated_at: new Date() });
        inserted = true;
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(inserted).toBe(true); // rolled back; nothing persisted
    record("P0-2", "direct INSERT over-allocating 5000 (app user, rolled back)", "ACCEPTED by the DB", "none: F1.2/F1.3 limits are service-only (trigger checks status and booking only)");
  });
});

describe("P0-3 over-refund", () => {
  let paymentId: number;
  let refunds: number[];

  it("5 concurrent refund requests of 300 on a 1000 payment: 3 accepted, 2 refused", async () => {
    const bookingId = await fx.booking();
    paymentId = await pay(bookingId, "1000.00");
    const { ok, refused } = settle(await parallel(5, () => refund(paymentId, "300.00")));
    refunds = ok;
    expect(ok).toHaveLength(3);
    expect(refused).toEqual(Array(2).fill({ boundary: "service", code: "REFUND_EXCEEDS_PAYMENT" }));
    expect(minor((await paymentBal(paymentId)).refunds_reserved)).toBe(90_000n);
    record("P0-3", "5 parallel refunds of 300 on a 1000 payment", "3 requested (900), 2 refused", b(refused[0]!));
  });

  it("2 concurrent completions of the same refund: one completes", async () => {
    const { ok, refused } = settle(await parallel(2, () => completeRefund(fx.db, fx.actor, refunds[0]!)));
    expect(ok).toHaveLength(1);
    expect(refused).toEqual([{ boundary: "service", code: "REFUND_NOT_PENDING" }]);
    record("P0-3", "2 parallel completions of one refund", "1 completed, 1 refused", b(refused[0]!));
  });

  it("concurrent reject and new request never exceed the payment", async () => {
    const [rej, req] = await Promise.allSettled([rejectRefund(fx.db, fx.actor, refunds[1]!), refund(paymentId, "400.00")]);
    expect(rej.status).toBe("fulfilled");
    const reserved = minor((await paymentBal(paymentId)).refunds_reserved);
    if (req.status === "fulfilled") expect(reserved).toBe(100_000n);
    else expect(reserved).toBe(60_000n);
    record("P0-3", "parallel reject(300) + request(400), 100 headroom", req.status === "fulfilled" ? "reject ran first, request accepted (reserved 1000)" : "request ran first and was refused (reserved 600)", req.status === "fulfilled" ? "service (ordered by booking lock)" : b(settle([req]).refused[0]!));
  });

  it("documents the boundary: a direct over-refund INSERT by the app user is not blocked by the DB", async () => {
    let inserted = false;
    await fx.db
      .transaction(async (trx) => {
        await trx("refunds").insert({ property_id: fx.actor.propertyId, payment_id: paymentId, reference: fx.ref("R"), amount: "99999.00", method: "card", reason: "test", status: "requested", requested_at: new Date() });
        inserted = true;
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(inserted).toBe(true);
    record("P0-3", "direct INSERT refund 99999 > payment (app user, rolled back)", "ACCEPTED by the DB", "none: F1.4 limit is service-only");
  });

  it("a direct UPDATE of a refund amount is refused", async () => {
    const r = await refusal(fx.db("refunds").where({ id: refunds[2]! }).update({ amount: "1.00" }));
    expect(["grant", "trigger"]).toContain(r.boundary);
    record("P0-3", "direct UPDATE refunds.amount (app user)", "refused", b(r));
  });
});

describe("P0-4 refund against an allocated payment", () => {
  it("a refund releases allocated money and reopens the invoice", async () => {
    const bookingId = await fx.booking();
    const { invoiceId } = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    const paymentId = await pay(bookingId, "2000.00"); // 1120 allocated, 880 advance
    const refundId = await refund(paymentId, "1500.00"); // needs 620 released
    expect(minor((await invoiceBal(invoiceId)).balance_due)).toBe(62_000n);
    let p = await paymentBal(paymentId);
    expect([minor(p.allocated_amount), minor(p.refunds_reserved), minor(p.available_to_allocate)]).toEqual([50_000n, 150_000n, 0n]);
    await completeRefund(fx.db, fx.actor, refundId);
    p = await paymentBal(paymentId);
    expect([minor(p.refunded_completed), minor(p.held_unallocated)]).toEqual([150_000n, 0n]);
    record("P0-4", "refund 1500 of a 2000 payment with 1120 allocated", "620 released, invoice 620 due, payment balanced", "service (release rows, append-only)");
  });

  it("2 concurrent refunds on a fully allocated payment: released once; reject re-allocates; void frees all", async () => {
    const bookingId = await fx.booking();
    const { invoiceId } = await issueInvoice(fx.db, fx.actor, invoice(bookingId));
    const paymentId = await pay(bookingId, "1120.00");
    const { ok, refused } = settle(await parallel(2, () => refund(paymentId, "600.00")));
    expect(ok).toHaveLength(1);
    expect(refused).toEqual([{ boundary: "service", code: "REFUND_EXCEEDS_PAYMENT" }]);
    expect(minor((await invoiceBal(invoiceId)).balance_due)).toBe(60_000n);
    record("P0-4", "2 parallel refunds of 600 on a fully allocated 1120 payment", "1 requested (600 released once), 1 refused", b(refused[0]!));

    await rejectRefund(fx.db, fx.actor, ok[0]!);
    expect(minor((await invoiceBal(invoiceId)).balance_due)).toBe(0n);
    await voidInvoice(fx.db, fx.actor, { invoiceId, reason: "integration test" });
    expect(minor((await paymentBal(paymentId)).held_unallocated)).toBe(112_000n);
    record("P0-4", "reject that refund, then void the invoice", "re-allocated 600, then all 1120 back to advance", "service");
  });

  it("refund concurrent with invoice issue on the same booking: same result in either order", async () => {
    const bookingId = await fx.booking();
    const paymentId = await pay(bookingId, "1000.00"); // advance
    const [inv, ref] = await Promise.allSettled([issueInvoice(fx.db, fx.actor, invoice(bookingId)), refund(paymentId, "800.00")]);
    expect([inv.status, ref.status]).toEqual(["fulfilled", "fulfilled"]);
    const invoiceId = (inv as PromiseFulfilledResult<{ invoiceId: number }>).value.invoiceId;
    expect(minor((await invoiceBal(invoiceId)).balance_due)).toBe(92_000n);
    expect(minor((await paymentBal(paymentId)).allocated_amount)).toBe(20_000n);
    record("P0-4", "parallel issue(1120) + refund(800) on a 1000 advance", "invoice 920 due, 200 allocated either way", "booking row lock (service)");
  });
});
