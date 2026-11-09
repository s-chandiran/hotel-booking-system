/**
 * Gate 3b focused P1 (demo journey): T1 booking transitions, T2 occupancy, T2b direct status
 * manipulation, T3 overlap, T4 check-in validation and checkout effects. Runs against MySQL as the
 * restricted app user. No implementation is exercised beyond the existing services.
 */
import type { Knex } from "knex";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cancelBooking, checkIn, checkOut, confirmBooking, createBooking } from "../services/bookings.js";
import { insertId } from "../services/context.js";
import { boundaryOf, createFixture, invariantViolations, parallel, printReport, record, refusal, settle, type Boundary, type Fixture } from "./harness.js";

let fx: Fixture;
let dayCursor = 0;
/** Distinct dates per call (2031+), so tests never clash unless they share dates on purpose. */
const dates = (nights = 2): { start: string; end: string } => {
  const start = new Date(Date.UTC(2031, 0, 1) + dayCursor * 86_400_000);
  dayCursor += nights + 1;
  return { start: start.toISOString().slice(0, 10), end: new Date(start.getTime() + nights * 86_400_000).toISOString().slice(0, 10) };
};
const book = (o: { status?: "pending" | "confirmed"; roomId?: number | null; start: string; end: string; roomTypeId?: number; guests?: number }) =>
  createBooking(fx.db, fx.actor, {
    reference: fx.ref("B"), guestId: fx.guestId, roomTypeId: o.roomTypeId ?? fx.roomTypeId, roomId: o.roomId ?? null,
    checkInDate: o.start, checkOutDate: o.end, guestsCount: o.guests ?? 1, source: "direct", status: o.status ?? "confirmed",
  });
let roomNo = 100;
const addRoom = (o: { roomTypeId?: number; outOfService?: boolean } = {}) =>
  insertId(fx.db("rooms").insert({ property_id: fx.actor.propertyId, room_type_id: o.roomTypeId ?? fx.roomTypeId, number: `X${roomNo++}`, floor: 1, is_out_of_service: o.outOfService ?? false }));
const roomStatus = (db: Knex | Knex.Transaction, roomId: number) => db("v_room_status").where({ room_id: roomId }).first("status", "housekeeping_status", "current_booking_id");
const b = (r: { boundary: string; code: string }): string => `${r.boundary}: ${r.code}`;
const svc = (code: string) => ({ boundary: "service", code });

/** Runs fn in a transaction that is always rolled back. "accepted" = the DB let it through. */
const ROLLBACK = new Error("rollback");
async function inRollback(fn: (trx: Knex.Transaction) => Promise<unknown>): Promise<"accepted" | { boundary: Boundary; code: string }> {
  try {
    await fx.db.transaction(async (trx) => {
      await fn(trx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK) return "accepted";
    return boundaryOf(e);
  }
  return "accepted";
}

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

describe("T1 invalid booking transitions are refused by the service", () => {
  it("walks pending → confirmed → checked_in → checked_out and refuses every invalid move", async () => {
    const room = await addRoom();
    const d = dates();
    const id = await book({ status: "pending", ...d });
    const expectRefused = async (label: string, p: Promise<unknown>, code = "INVALID_TRANSITION") => {
      const r = await refusal(p);
      expect(r, label).toEqual(svc(code));
      record("T1", label, "refused", b(r));
    };

    await expectRefused("check in a pending booking", checkIn(fx.db, fx.actor, { bookingId: id, roomId: room }));
    await expectRefused("check out a pending booking", checkOut(fx.db, fx.actor, { bookingId: id }));
    await confirmBooking(fx.db, fx.actor, id);
    await expectRefused("confirm a confirmed booking", confirmBooking(fx.db, fx.actor, id));
    await expectRefused("check out a confirmed booking", checkOut(fx.db, fx.actor, { bookingId: id }));
    await expectRefused("check in without a room", checkIn(fx.db, fx.actor, { bookingId: id }), "ROOM_REQUIRED");
    await checkIn(fx.db, fx.actor, { bookingId: id, roomId: room });
    await expectRefused("check in a checked-in booking", checkIn(fx.db, fx.actor, { bookingId: id, roomId: room }));
    await expectRefused("confirm a checked-in booking", confirmBooking(fx.db, fx.actor, id));
    await expectRefused("cancel a checked-in booking", cancelBooking(fx.db, fx.actor, { bookingId: id, reason: "test" }));
    await checkOut(fx.db, fx.actor, { bookingId: id });
    await expectRefused("check out a checked-out booking", checkOut(fx.db, fx.actor, { bookingId: id }));
    await expectRefused("check in a checked-out booking", checkIn(fx.db, fx.actor, { bookingId: id, roomId: room }));
    await expectRefused("cancel a checked-out booking", cancelBooking(fx.db, fx.actor, { bookingId: id, reason: "test" }));

    const c = await book({ status: "pending", ...dates() });
    await expect(refusal(Promise.resolve().then(() => cancelBooking(fx.db, fx.actor, { bookingId: c, reason: "  " })))).resolves.toEqual(svc("REASON_REQUIRED"));
    record("T1", "cancel with a blank reason", "refused", "service: REASON_REQUIRED");
    await cancelBooking(fx.db, fx.actor, { bookingId: c, reason: "test" });
    await expectRefused("confirm a cancelled booking", confirmBooking(fx.db, fx.actor, c));
    await expectRefused("check in a cancelled booking", checkIn(fx.db, fx.actor, { bookingId: c, roomId: room }));
    await expectRefused("cancel a cancelled booking", cancelBooking(fx.db, fx.actor, { bookingId: c, reason: "test" }));

    const audits = await fx.db("audit_events").where({ property_id: fx.actor.propertyId, entity_type: "booking", entity_id: id }).orderBy("id").pluck("action");
    expect(audits).toEqual(["create", "confirmed", "check_in", "check_out"]);
    record("T1", "audit trail of the valid moves", "create, confirmed, check_in, check_out only", "service (audit_events)");
  });
});

describe("T2 one occupant per room", () => {
  it("2 parallel check-ins of overlapping bookings into one room: one succeeds", async () => {
    const room = await addRoom();
    const d = dates();
    const a = await book(d);
    const c = await book(d);
    const { ok, refused } = settle(await parallel(2, (i) => checkIn(fx.db, fx.actor, { bookingId: [a, c][i]!, roomId: room })));
    expect(ok).toHaveLength(1);
    expect(refused).toEqual([svc("ROOM_OCCUPIED")]); // the occupancy check runs before the date-overlap check
    expect((await roomStatus(fx.db, room)).status).toBe("occupied");
    record("T2", "2 parallel check-ins, same room, same dates", "1 checked in, 1 refused", b(refused[0]!));
  });

  it("check-in of a non-overlapping booking while the room is still occupied", async () => {
    const room = await addRoom();
    const a = await book(dates());
    const later = await book(dates()); // later dates, no overlap with a
    await checkIn(fx.db, fx.actor, { bookingId: a, roomId: room });
    const r = await refusal(checkIn(fx.db, fx.actor, { bookingId: later, roomId: room }));
    expect(r).toEqual(svc("ROOM_OCCUPIED"));
    record("T2", "check in a later booking while the room is still occupied (no date overlap)", "refused", `${b(r)} (explicit occupancy check; the unique key stays the backstop)`);
  });

  it("2 parallel non-overlapping check-ins into one free room: one succeeds", async () => {
    const room = await addRoom();
    const a = await book(dates());
    const c = await book(dates());
    const { ok, refused } = settle(await parallel(2, (i) => checkIn(fx.db, fx.actor, { bookingId: [a, c][i]!, roomId: room })));
    expect(ok).toHaveLength(1);
    expect(refused).toEqual([svc("ROOM_OCCUPIED")]);
    record("T2", "2 parallel check-ins, same room, different dates", "1 checked in, 1 refused", b(refused[0]!));
  });
});

describe("T2b direct booking-status manipulation by the app user (each rolled back)", () => {
  it("records what the DB accepts and refuses", async () => {
    const free = await addRoom();
    const occupied = await addRoom();
    const oos = await addRoom({ outOfService: true });
    const dlxType = await insertId(fx.db("room_types").insert({ property_id: fx.actor.propertyId, code: "DLX", name: "Deluxe", base_rate: "2000.00", capacity: 2 }));
    const dlxRoom = await addRoom({ roomTypeId: dlxType });

    const inHouse = await book(dates());
    await checkIn(fx.db, fx.actor, { bookingId: inHouse, roomId: occupied });
    const pending = await book({ status: "pending", ...dates() });
    const confirmed = await book(dates());
    const cancelled = await book(dates());
    await cancelBooking(fx.db, fx.actor, { bookingId: cancelled, reason: "test" });
    const doneRoom = await addRoom();
    const done = await book(dates());
    await checkIn(fx.db, fx.actor, { bookingId: done, roomId: doneRoom });
    await checkOut(fx.db, fx.actor, { bookingId: done });
    const upd = (trx: Knex.Transaction, id: number, patch: Record<string, unknown>) => trx("bookings").where({ id }).update(patch);

    let oosView: unknown;
    let hkAfter: unknown;
    const cases: Array<[string, (trx: Knex.Transaction) => Promise<unknown>, "accepted" | Boundary]> = [
      ["cancelled → checked_in (free room)", (t) => upd(t, cancelled, { status: "checked_in", room_id: free }), "accepted"],
      ["checked_out → checked_in (reopen a finished stay)", (t) => upd(t, done, { status: "checked_in" }), "accepted"],
      ["pending → checked_out (skip the stay)", (t) => upd(t, pending, { status: "checked_out", room_id: free }), "accepted"],
      ["checked_in → checked_out without the housekeeping update", async (t) => { await upd(t, inHouse, { status: "checked_out" }); hkAfter = (await roomStatus(t, occupied)).housekeeping_status; }, "accepted"],
      ["confirmed → checked_in into an out-of-service room", async (t) => { await upd(t, confirmed, { status: "checked_in", room_id: oos }); oosView = await roomStatus(t, oos); }, "accepted"],
      ["confirmed → checked_in into a room of another type", (t) => upd(t, confirmed, { status: "checked_in", room_id: dlxRoom }), "accepted"],
      ["move an in-house guest to another free room", (t) => upd(t, inHouse, { room_id: free }), "accepted"],
      ["change nightly_rate / room_total of an in-house booking", (t) => upd(t, inHouse, { nightly_rate: "1.00", room_total: "2.00" }), "accepted"],
      ["confirmed → checked_in into an occupied room", (t) => upd(t, confirmed, { status: "checked_in", room_id: occupied }), "unique"],
      ["checked_in with no room", (t) => upd(t, confirmed, { status: "checked_in", room_id: null }), "check"],
      ["check-out date before check-in date", (t) => upd(t, confirmed, { check_out_date: "2000-01-01" }), "check"],
      ["status outside the enum", (t) => upd(t, confirmed, { status: "no_show" }), "column"],
      ["change the booking's reference or guest", (t) => upd(t, confirmed, { reference: "HACK" }), "grant"],
    ];
    for (const [label, fn, expected] of cases) {
      const r = await inRollback(fn);
      const got = r === "accepted" ? "accepted" : r.boundary;
      expect(got, label).toBe(expected);
      record("T2b", label, r === "accepted" ? "ACCEPTED by the DB" : "refused", r === "accepted" ? "none (service-only rule)" : b(r));
    }
    expect(hkAfter).toBe("clean");
    expect(oosView).toMatchObject({ status: "maintenance" });
    record("T2b", "side effect: direct check-out leaves housekeeping", `stays '${String(hkAfter)}' (service would set dirty)`, "none");
    record("T2b", "side effect: guest checked in to an out-of-service room", "v_room_status shows 'maintenance', the occupancy is hidden", "none");
    const audits = await fx.db("audit_events").where({ property_id: fx.actor.propertyId, entity_type: "booking", entity_id: confirmed }).pluck("action");
    expect(audits).toEqual(["create"]);
    record("T2b", "audit trail of direct changes", "none written (audit is service-only)", "none");
  });
});

describe("T3 date overlap on an assigned room", () => {
  it("refuses an overlapping booking and allows a back-to-back one", async () => {
    const room = await addRoom();
    const d = dates(3);
    await book({ roomId: room, ...d });
    const mid = new Date(Date.parse(`${d.start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const r = await refusal(book({ roomId: room, start: mid, end: d.end }));
    expect(r).toEqual(svc("ROOM_UNAVAILABLE"));
    record("T3", "create an overlapping booking on an assigned room", "refused", b(r));
    const after = new Date(Date.parse(`${d.end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    await expect(book({ roomId: room, start: d.end, end: after })).resolves.toBeTypeOf("number");
    record("T3", "back-to-back booking (arrives on the other's departure day)", "accepted", "—");
  });

  it("4 parallel creates for one room and the same dates: one succeeds", async () => {
    const room = await addRoom();
    const d = dates();
    const { ok, refused } = settle(await parallel(4, () => book({ roomId: room, ...d })));
    expect(ok).toHaveLength(1);
    expect(refused).toEqual(Array(3).fill(svc("ROOM_UNAVAILABLE")));
    record("T3", "4 parallel creates, same room, same dates", "1 created, 3 refused", b(refused[0]!));
  });

  it("check-in assignment (D-F) respects another booking already assigned to the room", async () => {
    const room = await addRoom();
    const d = dates();
    await book({ roomId: room, ...d });
    const walkUp = await book(d);
    const r = await refusal(checkIn(fx.db, fx.actor, { bookingId: walkUp, roomId: room }));
    expect(r).toEqual(svc("ROOM_UNAVAILABLE"));
    record("T3", "assign at check-in a room held by another booking for those dates", "refused", b(r));
  });
});

describe("T4 check-in validation and checkout effects", () => {
  it("refuses out-of-service and wrong-type rooms, over-capacity and bad dates", async () => {
    const oos = await addRoom({ outOfService: true });
    const dlxType = await insertId(fx.db("room_types").insert({ property_id: fx.actor.propertyId, code: "DLX2", name: "Deluxe 2", base_rate: "2000.00", capacity: 2 }));
    const dlxRoom = await addRoom({ roomTypeId: dlxType });
    const id = await book(dates());
    const cases: Array<[string, () => Promise<unknown>, string]> = [
      ["check in to an out-of-service room", () => checkIn(fx.db, fx.actor, { bookingId: id, roomId: oos }), "ROOM_OUT_OF_SERVICE"],
      ["check in to a room of another type", () => checkIn(fx.db, fx.actor, { bookingId: id, roomId: dlxRoom }), "ROOM_TYPE_MISMATCH"],
      ["create with more guests than capacity", () => book({ ...dates(), guests: 3 }), "OVER_CAPACITY"],
      ["create with check-out before check-in", () => book({ start: "2031-06-10", end: "2031-06-09" }), "INVALID_DATES"],
      ["create with zero nights", () => book({ start: "2031-06-10", end: "2031-06-10" }), "INVALID_DATES"],
    ];
    for (const [label, p, code] of cases) {
      const r = await refusal(p());
      expect(r, label).toEqual(svc(code));
      record("T4", label, "refused", b(r));
    }
  });

  it("checkout frees the room as Available + Dirty (D-H)", async () => {
    const room = await addRoom();
    const id = await book(dates());
    expect((await roomStatus(fx.db, room)).status).toBe("available");
    await checkIn(fx.db, fx.actor, { bookingId: id, roomId: room });
    expect(await roomStatus(fx.db, room)).toMatchObject({ status: "occupied", current_booking_id: id, housekeeping_status: "clean" });
    await checkOut(fx.db, fx.actor, { bookingId: id });
    expect(await roomStatus(fx.db, room)).toMatchObject({ status: "available", current_booking_id: null, housekeeping_status: "dirty" });
    record("T4", "check in, then check out", "occupied → available + dirty", "service + v_room_status");
  });
});
