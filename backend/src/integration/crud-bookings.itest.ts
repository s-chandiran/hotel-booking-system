/**
 * CRUD increment 2: Reservations. Update (permitted details), cancel, invalid input, status guards, overlap,
 * concurrency, audit, and the effect on other screens' data. No delete exists: cancel is the archive.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createBooking } from "../services/bookings.js";
import { startApi, type Api } from "./api-client.js";
import { createFixture, invariantViolations, parallel, printReport, record, refusal, settle, type Fixture } from "./harness.js";

let fx: Fixture;
let api: Api;
let fd: string;
let day = 0;
const dates = (nights = 2) => {
  const start = new Date(Date.UTC(2038, 0, 1) + day * 86_400_000);
  day += nights + 3;
  return { checkInDate: start.toISOString().slice(0, 10), checkOutDate: new Date(start.getTime() + nights * 86_400_000).toISOString().slice(0, 10) };
};
const key = () => `k${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const create = async (extra: Record<string, unknown> = {}) =>
  (await api.call("POST", "/api/bookings", { token: fd, body: { guestId: fx.guestId, roomTypeId: fx.roomTypeId, guestsCount: 1, source: "direct", ...dates(), idempotencyKey: key(), ...extra } })).body.id as string;
const detail = async (id: string) => (await api.call("GET", `/api/bookings/${id}`, { token: fd })).body;
const patch = (id: string, body: unknown, token = fd) => api.call("PATCH", `/api/bookings/${id}`, { token, body });
const cancel = (id: string, body: unknown = { reason: "Guest changed plans" }, token = fd) => api.call("POST", `/api/bookings/${id}/cancel`, { token, body });

beforeAll(async () => {
  fx = await createFixture();
  api = await startApi(fx);
  fd = await api.tokenFor("front_desk");
});
afterEach(async () => {
  expect(await invariantViolations(fx.db, fx.actor.propertyId)).toEqual([]);
});
afterAll(async () => {
  printReport();
  await api?.close();
  await fx?.db.destroy();
});

describe("update", () => {
  it("changes dates, guests and arrival time; the total follows the stored rate", async () => {
    const id = await create(dates(2));
    expect((await detail(id)).total).toBe(2000);
    const d = dates(4);
    const r = await patch(id, { ...d, guestsCount: 2, expectedArrivalTime: "15:30" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nights: 4, total: 4000 });
    expect(await detail(id)).toMatchObject({ checkIn: d.checkInDate, checkOut: d.checkOutDate, guests: 2, arrivalTime: "15:30", total: 4000 });
    expect((await patch(id, { expectedArrivalTime: null })).status).toBe(200);
    expect((await detail(id)).arrivalTime).toBe("");
    // The rate is a snapshot: a later change to the room type's price does not reprice the booking.
    await fx.db("room_types").where({ id: fx.roomTypeId }).update({ base_rate: "9999.00" });
    expect((await patch(id, { guestsCount: 1 })).body.total).toBe(4000);
    await fx.db("room_types").where({ id: fx.roomTypeId }).update({ base_rate: "1000.00" });
    record("Reservations", "update dates/guests/arrival", "saved, total recomputed from the stored rate (4 × 1000)", "service");
  });

  it("refuses invalid input and anything that could set price, status or references", async () => {
    const id = await create();
    const cases: Array<[string, unknown, number, string]> = [
      ["empty body", {}, 400, "VALIDATION"], ["status", { status: "checked_in" }, 400, "VALIDATION"], ["nightlyRate", { nightlyRate: "1.00" }, 400, "VALIDATION"],
      ["roomTotal", { roomTotal: "1.00" }, 400, "VALIDATION"], ["reference", { reference: "BK-1" }, 400, "VALIDATION"], ["roomTypeId", { roomTypeId: 1 }, 400, "VALIDATION"],
      ["roomId", { roomId: 1 }, 400, "VALIDATION"], ["bad date", { checkInDate: "2038-13-40" }, 400, "VALIDATION"], ["guests 0", { guestsCount: 0 }, 400, "VALIDATION"],
      ["check-out before check-in", { checkOutDate: "2000-01-01" }, 422, "INVALID_DATES"], ["over capacity", { guestsCount: 3 }, 422, "OVER_CAPACITY"],
    ];
    for (const [label, body, status, code] of cases) {
      api.expectError(await patch(id, body), status, code);
      record("Reservations", `update with ${label}`, `${status} ${code}`, status === 400 ? "API validation (zod strict)" : "service");
    }
    const before = await detail(id);
    api.expectError(await patch(id, { guestsCount: before.guests }), 400, "NOTHING_TO_CHANGE");
    expect(await detail(id)).toMatchObject({ total: before.total, checkIn: before.checkIn, guests: before.guests });
  });

  it("only pending or confirmed bookings without an invoice can be edited", async () => {
    const stays = await create();
    const roomId = (await api.call("GET", `/api/bookings/${stays}/free-rooms`, { token: fd })).body[0].id;
    await api.call("POST", `/api/bookings/${stays}/confirm`, { token: fd, body: {} });
    await api.call("POST", `/api/bookings/${stays}/check-in`, { token: fd, body: { roomId } });
    api.expectError(await patch(stays, { guestsCount: 2 }), 409, "BOOKING_NOT_EDITABLE");
    await api.call("POST", `/api/bookings/${stays}/check-out`, { token: fd, body: {} });
    api.expectError(await patch(stays, { guestsCount: 2 }), 409, "BOOKING_NOT_EDITABLE");
    const cancelled = await create();
    await cancel(cancelled);
    api.expectError(await patch(cancelled, { guestsCount: 2 }), 409, "BOOKING_NOT_EDITABLE");
    record("Reservations", "update a checked-in / checked-out / cancelled booking", "409 BOOKING_NOT_EDITABLE", "service");
  });

  it("re-checks room overlap for a booking that already has a room", async () => {
    const room = fx.roomIds[0]!;
    const a = dates(2);
    const b = dates(2);
    await createBooking(fx.db, fx.actor, { guestId: fx.guestId, roomTypeId: fx.roomTypeId, roomId: room, guestsCount: 1, source: "direct", status: "confirmed", ...a });
    const mine = await createBooking(fx.db, fx.actor, { guestId: fx.guestId, roomTypeId: fx.roomTypeId, roomId: room, guestsCount: 1, source: "direct", status: "confirmed", ...b });
    api.expectError(await patch(String(mine), { checkInDate: a.checkInDate, checkOutDate: a.checkOutDate }), 409, "ROOM_UNAVAILABLE");
    record("Reservations", "move an assigned booking onto another booking's dates", "409 ROOM_UNAVAILABLE", "service (room lock + overlap)");
  });

  it("needs a session and respects the property", async () => {
    const id = await create();
    api.expectError(await api.call("PATCH", `/api/bookings/${id}`, { body: { guestsCount: 2 } }), 401, "UNAUTHORIZED");
    api.expectError(await patch("99999999", { guestsCount: 1 }), 404, "BOOKING_NOT_FOUND");
    record("Reservations", "update without token / unknown booking", "401 / 404", "API auth, service");
  });
});

describe("cancel", () => {
  it("cancels a pending booking and an advance stays held, not refunded", async () => {
    const id = await create();
    await api.call("POST", "/api/payments", { token: fd, body: { bookingId: id, method: "cash", amount: "500.00", idempotencyKey: key() } });
    const r = await cancel(id, { reason: "Guest changed travel plans" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "cancelled", advanceHeld: 500 });
    expect(await detail(id)).toMatchObject({ status: "cancelled", advanceHeld: 500, received: 500 });
    const list = (await api.call("GET", "/api/bookings", { token: fd })).body.find((b: { id: string }) => b.id === id);
    expect(list.status).toBe("cancelled");
    const dash = (await api.call("GET", "/api/dashboard", { token: fd })).body;
    expect(dash.recentBookings.some((b: { id: string }) => b.id === id)).toBe(false);
    expect(await fx.db("refunds").where({ property_id: fx.actor.propertyId }).count({ n: "*" }).first()).toEqual({ n: 0 });
    const audits = await fx.db("audit_events").where({ entity_type: "booking", entity_id: Number(id) }).orderBy("id").pluck("action");
    expect(audits).toEqual(["create", "cancelled"]);
    record("Reservations", "cancel a pending booking with a 500 advance", "cancelled, advance still held, no refund created, audited", "service");
  });

  it("refuses a blank reason, a repeat cancel and cancelling a stay in progress", async () => {
    const id = await create();
    api.expectError(await cancel(id, { reason: "   " }), 400, "VALIDATION");
    api.expectError(await cancel(id, {}), 400, "VALIDATION");
    api.expectError(await cancel(id, { reason: "x", extra: 1 }), 400, "VALIDATION");
    await cancel(id);
    api.expectError(await cancel(id), 409, "INVALID_TRANSITION");
    const live = await create();
    const roomId = (await api.call("GET", `/api/bookings/${live}/free-rooms`, { token: fd })).body[0].id;
    await api.call("POST", `/api/bookings/${live}/confirm`, { token: fd, body: {} });
    await api.call("POST", `/api/bookings/${live}/check-in`, { token: fd, body: { roomId } });
    api.expectError(await cancel(live), 409, "INVALID_TRANSITION");
    api.expectError(await api.call("POST", `/api/bookings/${live}/cancel`, { body: { reason: "x" } }), 401, "UNAUTHORIZED");
    record("Reservations", "cancel: blank reason / twice / checked in / no token", "400 / 409 / 409 / 401", "API validation, service, API auth");
  });

  it("a parallel cancel and confirm: exactly one wins, the booking is never both", async () => {
    const id = await create();
    const results = await Promise.all([cancel(id), api.call("POST", `/api/bookings/${id}/confirm`, { token: fd, body: {} })]);
    const statuses = results.map((r) => r.status).sort();
    const final = (await detail(id)).status;
    if (final === "cancelled") expect(statuses).toEqual([200, 409]); // confirm ran first and cancel still allowed, or confirm refused
    expect(["cancelled", "confirmed"]).toContain(final);
    // Both orders are legal: confirm→cancel (both 200, final cancelled) or cancel→confirm (confirm 409, final cancelled).
    expect(final === "cancelled" || statuses.join() === "200,409").toBe(true);
    const direct = settle(await parallel(4, () => import("../services/bookings.js").then((m) => m.cancelBooking(fx.db, fx.actor, { bookingId: Number(id), reason: "dup" }))));
    expect(direct.ok.length).toBe(0); // already cancelled
    record("Reservations", "parallel cancel + confirm, then 4 parallel cancels", `final ${final}; later cancels all refused`, "service (booking row lock)");
    const twin = await create();
    const many = settle(await parallel(5, () => import("../services/bookings.js").then((m) => m.cancelBooking(fx.db, fx.actor, { bookingId: Number(twin), reason: "race" }))));
    expect(many.ok).toHaveLength(1);
    expect(many.refused).toEqual(Array(4).fill({ boundary: "service", code: "INVALID_TRANSITION" }));
    record("Reservations", "5 parallel cancels of one booking", "1 cancelled, 4 refused", "service (booking row lock)");
  });

  it("no delete: the DB refuses it", async () => {
    const id = await create();
    const del = await refusal(fx.db("bookings").where({ id: Number(id) }).delete());
    expect(del.boundary).toBe("grant");
    record("Reservations", "direct DELETE of a booking (app user)", "refused", `${del.boundary}: ${del.code}`);
  });
});
