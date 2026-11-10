/**
 * Controlled refunds: admin request → complete/reject, idempotency, role gate, over-refund cap.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBooking } from "../services/bookings.js";
import { recordPayment } from "../services/finance.js";
import { startApi, type Api } from "./api-client.js";
import { createFixture, printReport, record, type Fixture } from "./harness.js";

let fx: Fixture;
let api: Api;
let admin: string;
let desk: string;
let n = 0;
const key = () => `rk${fx.tag}${String(++n).padStart(4, "0")}`;

beforeAll(async () => {
  fx = await createFixture();
  api = await startApi(fx);
  admin = await api.tokenFor("admin");
  desk = await api.tokenFor("front_desk");
});
afterAll(async () => {
  printReport();
  await api?.close();
  await fx?.db.destroy();
});

async function successPayment(amount = "1000.00"): Promise<number> {
  const bookingId = await createBooking(fx.db, fx.actor, {
    guestId: fx.guestId,
    roomTypeId: fx.roomTypeId,
    checkInDate: "2031-06-01",
    checkOutDate: "2031-06-02",
    guestsCount: 1,
    source: "direct",
    status: "confirmed",
  });
  return (await recordPayment(fx.db, fx.actor, {
    bookingId,
    method: "cash",
    amount,
    status: "success",
    idempotencyKey: key(),
  })).paymentId;
}

describe("refunds", () => {
  it("front_desk cannot request a refund", async () => {
    const paymentId = await successPayment("500.00");
    api.expectError(
      await api.call("POST", `/api/payments/${paymentId}/refund`, {
        token: desk,
        body: { amount: "100.00", reason: "Test", idempotencyKey: key() },
      }),
      403,
      "FORBIDDEN",
    );
    record("Payments", "front_desk refund request", "403 FORBIDDEN", "requireRole(admin)");
  });

  it("admin requests, completes, and idempotent retry returns the same refund", async () => {
    const paymentId = await successPayment("2000.00");
    const idem = key();
    const first = await api.call("POST", `/api/payments/${paymentId}/refund`, {
      token: admin,
      body: { amount: "500.00", reason: "Goodwill AC fault", idempotencyKey: idem },
    });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe("requested");
    expect(String(first.body.reference)).toMatch(/^RF/);

    const replay = await api.call("POST", `/api/payments/${paymentId}/refund`, {
      token: admin,
      body: { amount: "500.00", reason: "Goodwill AC fault", idempotencyKey: idem },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);

    const done = await api.call("POST", `/api/refunds/${first.body.id}/complete`, { token: admin, body: {} });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("completed");

    const list = await api.call("GET", "/api/refunds", { token: admin });
    expect(list.status).toBe(200);
    expect(list.body.find((r: { id: string }) => r.id === first.body.id)?.status).toBe("completed");

    const pays = await api.call("GET", "/api/payments", { token: admin });
    const row = pays.body.find((p: { id: string }) => p.id === String(paymentId));
    expect(row.refundedAmount).toBe(500);
    expect(row.refundableAmount).toBe(1500);

    record("Payments", "admin refund request+complete+idempotency", "RF created, completed, payment caps updated", "service+API");
  });

  it("rejects a refund that would exceed the payment", async () => {
    const paymentId = await successPayment("300.00");
    api.expectError(
      await api.call("POST", `/api/payments/${paymentId}/refund`, {
        token: admin,
        body: { amount: "400.00", reason: "Too much", idempotencyKey: key() },
      }),
      422,
      "REFUND_EXCEEDS_PAYMENT",
    );
    record("Payments", "over-refund request", "422 REFUND_EXCEEDS_PAYMENT", "service");
  });

  it("admin can reject a requested refund", async () => {
    const paymentId = await successPayment("800.00");
    const created = await api.call("POST", `/api/payments/${paymentId}/refund`, {
      token: admin,
      body: { amount: "200.00", reason: "Guest changed mind", idempotencyKey: key() },
    });
    expect(created.status).toBe(201);
    const rejected = await api.call("POST", `/api/refunds/${created.body.id}/reject`, { token: admin, body: {} });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    const pays = await api.call("GET", "/api/payments", { token: admin });
    expect(pays.body.find((p: { id: string }) => p.id === String(paymentId)).refundableAmount).toBe(800);
    record("Payments", "admin reject refund", "status rejected, refundable restored", "service");
  });
});
