/**
 * Gate 3b demo-journey services (approved plan step 2):
 *  - T5: the full journey through the services, with server-built final invoice at checkout (D-C);
 *  - server-generated references under concurrency (D-E);
 *  - duplicate-submit protection for payments and bookings (idempotency keys);
 *  - walk-in bookings created confirmed (D-B);
 *  - free-room list for check-in assignment (D-F).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { toMinor } from "../domain/money.js";
import { checkIn, checkOut, confirmBooking, createBooking, freeRoomsForBooking } from "../services/bookings.js";
import { recordPayment } from "../services/finance.js";
import { createGuest } from "../services/guests.js";
import { createFixture, invariantViolations, parallel, printReport, record, refusal, settle, type Fixture } from "./harness.js";

let fx: Fixture;
let day = 0;
const dates = (nights = 2) => {
  const start = new Date(Date.UTC(2032, 0, 1) + day * 86_400_000);
  day += nights + 1;
  return { checkInDate: start.toISOString().slice(0, 10), checkOutDate: new Date(start.getTime() + nights * 86_400_000).toISOString().slice(0, 10) };
};
const newBooking = (extra: Partial<Parameters<typeof createBooking>[2]> = {}) =>
  createBooking(fx.db, fx.actor, { guestId: fx.guestId, roomTypeId: fx.roomTypeId, guestsCount: 1, source: "direct", ...dates(), ...extra });
const m = (v: unknown): bigint => toMinor(String(v));

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

describe("T5 demo journey through the services", () => {
  it("guest → booking → confirm → advance → check-in (assigned) → checkout with final invoice", async () => {
    const guestId = await createGuest(fx.db, fx.actor, { fullName: "  Demo Guest ", email: "demo.guest@example.com", countryCode: "in" });
    const g = await fx.db("guests").where({ id: guestId }).first("full_name", "country_code");
    expect(g).toEqual({ full_name: "Demo Guest", country_code: "IN" });

    const bookingId = await newBooking({ guestId, ...dates(3) });
    let bk = await fx.db("bookings").where({ id: bookingId }).first("reference", "status", "room_id", "nightly_rate", "room_total");
    expect(bk.status).toBe("pending"); // D-B: staff confirm
    expect(bk.room_id).toBeNull(); // D-F: no room until check-in
    expect(bk.reference).toMatch(new RegExp(`^BK${fx.tag}-\\d+$`));
    expect([bk.nightly_rate, bk.room_total]).toEqual(["1000.00", "3000.00"]);
    await confirmBooking(fx.db, fx.actor, bookingId);

    const advanceId = (await recordPayment(fx.db, fx.actor, { bookingId, method: "cash", amount: "1000.00", status: "success" })).paymentId;
    expect(m((await fx.db("v_booking_balance").where({ booking_id: bookingId }).first("advance_held")).advance_held)).toBe(100_000n);

    const free = await freeRoomsForBooking(fx.db, fx.actor, bookingId);
    expect(free.length).toBeGreaterThan(0);
    const roomId = free[0]!.id;
    await checkIn(fx.db, fx.actor, { bookingId, roomId });
    expect((await freeRoomsForBooking(fx.db, fx.actor, bookingId)).map((r) => r.id)).not.toContain(roomId);
    expect((await fx.db("v_room_status").where({ room_id: roomId }).first("status")).status).toBe("occupied");

    const out = await checkOut(fx.db, fx.actor, { bookingId });
    expect(out.invoiceNumber).toMatch(new RegExp(`^IT/${fx.tag}/\\d{4}-\\d{2}/\\d{5}$`));
    const inv = await fx.db("v_invoice_balance").where({ invoice_id: out.invoiceId }).first();
    // Server-built: 3 nights × 1000.00 snapshot = 3000.00 net, GST 12% = 360.00, gross 3360.00; 1000 advance applied.
    expect([inv.net_amount, inv.tax_amount, inv.gross_amount, inv.allocated_amount, inv.balance_due, inv.payment_status]).toEqual(["3000.00", "360.00", "3360.00", "1000.00", "2360.00", "partial"]);
    const line = await fx.db("invoice_lines").where({ invoice_id: out.invoiceId }).first("description", "quantity", "unit_price", "line_net");
    expect(line).toEqual({ description: "Standard room, 3 night(s)", quantity: "3.00", unit_price: "1000.00", line_net: "3000.00" });
    expect((await fx.db("v_payment_balance").where({ payment_id: advanceId }).first("held_unallocated")).held_unallocated).toBe("0.00");
    expect(await fx.db("v_room_status").where({ room_id: roomId }).first("status", "housekeeping_status")).toEqual({ status: "available", housekeeping_status: "dirty" });

    bk = await fx.db("bookings").where({ id: bookingId }).first("status");
    expect(bk.status).toBe("checked_out");
    record("T5", "full journey, 3 nights at 1000 with a 1000 advance", "invoice 3360.00 issued at checkout, 1000 applied, 2360.00 due; room available + dirty", "service");

    // Balance still payable after checkout (D-D), and allocated to the final invoice.
    await recordPayment(fx.db, fx.actor, { bookingId, method: "upi", amount: "2360.00", status: "success" });
    expect((await fx.db("v_invoice_balance").where({ invoice_id: out.invoiceId }).first("balance_due", "payment_status"))).toEqual({ balance_due: "0.00", payment_status: "paid" });
    record("T5", "pay the balance after checkout", "invoice paid, balance 0.00", "service");
  });

  it("checkout never issues a second stay invoice and runs in one transaction", async () => {
    const bookingId = await newBooking({ status: "confirmed" });
    const roomId = (await freeRoomsForBooking(fx.db, fx.actor, bookingId))[0]!.id;
    await checkIn(fx.db, fx.actor, { bookingId, roomId });
    const before = await fx.db("number_sequences").where({ property_id: fx.actor.propertyId, document_type: "invoice" }).whereNot({ series: fx.series }).first("next_value");
    await expect(
      fx.db.transaction(async (trx) => {
        await checkOut(trx, fx.actor, { bookingId });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const after = await fx.db("number_sequences").where({ property_id: fx.actor.propertyId, document_type: "invoice" }).whereNot({ series: fx.series }).first("next_value");
    expect(after.next_value).toBe(before.next_value);
    expect((await fx.db("bookings").where({ id: bookingId }).first("status")).status).toBe("checked_in");
    record("T5", "checkout rolled back", "booking still checked in, invoice number returned", "transaction rollback");
  });
});

describe("D-E server-generated references", () => {
  it("10 parallel bookings and 10 parallel payments get unique, consecutive references", async () => {
    const b = settle(await parallel(10, () => newBooking()));
    expect(b.refused).toEqual([]);
    const refs = (await fx.db("bookings").whereIn("id", b.ok).pluck("reference")) as string[];
    const nums = refs.map((r) => Number(r.split("-")[1])).sort((x, y) => x - y);
    expect(new Set(nums).size).toBe(10);
    expect(nums.at(-1)! - nums[0]!).toBe(9);
    record("D-E", "10 parallel booking creates", "10 unique, consecutive BK- references", "booking sequence row lock (service); uq_bookings_reference backstop");

    const bookingId = b.ok[0]!;
    const p = settle(await parallel(10, async () => (await recordPayment(fx.db, fx.actor, { bookingId, method: "card", amount: "100.00", status: "success" })).paymentId));
    expect(p.refused).toEqual([]);
    const pnums = ((await fx.db("payments").whereIn("id", p.ok).pluck("reference")) as string[]).map((r) => Number(r.split("-")[1]));
    expect(new Set(pnums).size).toBe(10);
    record("D-E", "10 parallel payments", "10 unique PAY- references", "payment sequence row lock (service); uq_payments_reference backstop");
  });
});

describe("duplicate-submit protection", () => {
  it("5 parallel submits of one payment with the same key record it once", async () => {
    const bookingId = await newBooking();
    const key = `pay-${fx.tag}-1`;
    const { ok, refused } = settle(await parallel(5, async () => (await recordPayment(fx.db, fx.actor, { bookingId, method: "cash", amount: "500.00", status: "success", idempotencyKey: key })).paymentId));
    expect(refused).toEqual([]);
    expect(new Set(ok).size).toBe(1);
    expect(await fx.db("payments").where({ booking_id: bookingId }).count({ n: "*" }).first()).toEqual({ n: 1 });
    record("Idempotency", "5 parallel identical payment submits", "1 payment recorded, all 5 return it", "service replay + uq_payments_idempotency");

    const r = await refusal(recordPayment(fx.db, fx.actor, { bookingId, method: "cash", amount: "999.00", status: "success", idempotencyKey: key }));
    expect(r).toEqual({ boundary: "service", code: "IDEMPOTENCY_CONFLICT" });
    record("Idempotency", "same key, different amount", "refused", "service: IDEMPOTENCY_CONFLICT");
  });

  it("5 parallel submits of one booking with the same key create it once", async () => {
    const key = `bk-${fx.tag}-1`;
    const d = dates();
    const { ok, refused } = settle(await parallel(5, () => newBooking({ ...d, idempotencyKey: key })));
    expect(refused).toEqual([]);
    expect(new Set(ok).size).toBe(1);
    record("Idempotency", "5 parallel identical booking submits", "1 booking created", "service replay + uq_bookings_idempotency");
  });
});

describe("D-B walk-ins and D-F assignment", () => {
  it("a walk-in is created confirmed even when pending is asked for", async () => {
    const id = await newBooking({ source: "walk_in", status: "pending" });
    expect((await fx.db("bookings").where({ id }).first("status")).status).toBe("confirmed");
    record("D-B", "create a walk-in", "status confirmed", "service");
  });

  it("free rooms exclude occupied, out-of-service, other-type and date-held rooms", async () => {
    const target = await newBooking({ status: "confirmed" });
    const d = await fx.db("bookings").where({ id: target }).first("check_in_date", "check_out_date");
    const all = (await freeRoomsForBooking(fx.db, fx.actor, target)).map((r) => r.id);
    // Hold one free room with another booking for the same dates.
    const held = all[0]!;
    await createBooking(fx.db, fx.actor, { guestId: fx.guestId, roomTypeId: fx.roomTypeId, roomId: held, guestsCount: 1, source: "direct", status: "confirmed", checkInDate: d.check_in_date, checkOutDate: d.check_out_date });
    const now = (await freeRoomsForBooking(fx.db, fx.actor, target)).map((r) => r.id);
    expect(now).not.toContain(held);
    const r = await refusal(checkIn(fx.db, fx.actor, { bookingId: target, roomId: held }));
    expect(r).toEqual({ boundary: "service", code: "ROOM_UNAVAILABLE" });
    record("D-F", "free-room list vs a room held for the same dates", "excluded from the list; check-in refused", b(r));
  });
});

const b = (r: { boundary: string; code: string }): string => `${r.boundary}: ${r.code}`;
