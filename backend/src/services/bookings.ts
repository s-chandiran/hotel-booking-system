/**
 * Booking lifecycle events (data-model.md §7, §8). Each function is one transaction.
 * Room status is never written. "Occupied" follows from status = checked_in (D2). Overlap (R8) is
 * checked with the room row locked. The generated unique column bookings.occupied_room_id is the DB
 * backstop against two checked-in guests in one room.
 *
 * Not enforced yet (decided with the mutation APIs): the early check-in date rule (Q20) and
 * maintenance with future bookings (Q21).
 */
import type { Knex } from "knex";
import type { Db } from "../db/knex.js";
import { assert } from "../domain/errors.js";
import { businessDate, financialYear } from "../domain/dates.js";
import { fromMinor, toMinor } from "../domain/money.js";
import { audit, inTx, insertId, nowUtc, type Actor } from "./context.js";
import { issueInvoice } from "./finance.js";
import { isDuplicateOn, nextReference } from "./references.js";

type Trx = Knex.Transaction;
export type BookingSource = "direct" | "booking_com" | "expedia" | "walk_in" | "phone";

const ACTIVE = ["pending", "confirmed", "checked_in"];

export function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  assert(Number.isFinite(ms), "INVALID_DATES", "Dates must be YYYY-MM-DD");
  const nights = ms / 86_400_000;
  assert(Number.isInteger(nights) && nights > 0, "INVALID_DATES", "Check-out must be after check-in"); // R5
  return nights;
}

async function lockRoom(trx: Trx, actor: Actor, roomId: number) {
  const room = await trx("rooms").where({ id: roomId, property_id: actor.propertyId }).forUpdate().first();
  assert(room, "ROOM_NOT_FOUND", "Room not found");
  return room as { id: number; room_type_id: number; is_out_of_service: number | boolean };
}

async function assertRoomFree(trx: Trx, roomId: number, checkIn: string, checkOut: string, excludeBookingId: number | null): Promise<void> {
  const q = trx("bookings").where("room_id", roomId).whereIn("status", ACTIVE).where("check_in_date", "<", checkOut).where("check_out_date", ">", checkIn);
  if (excludeBookingId !== null) q.whereNot("id", excludeBookingId);
  const clash = await q.forShare().first("id");
  assert(!clash, "ROOM_UNAVAILABLE", "The room is already booked for these dates"); // R8
}

async function lockBooking(trx: Trx, actor: Actor, bookingId: number) {
  const b = await trx("bookings").where({ id: bookingId, property_id: actor.propertyId }).forUpdate().first();
  assert(b, "BOOKING_NOT_FOUND", "Booking not found");
  return b as { id: number; status: string; room_id: number | null; room_type_id: number; check_in_date: string; check_out_date: string; nightly_rate: string };
}

export interface CreateBookingInput {
  /** Omit to have the server generate the next `BK-` reference (D-E). Only the seed supplies one. */
  reference?: string;
  guestId: number;
  roomTypeId: number;
  roomId?: number | null;
  checkInDate: string;
  checkOutDate: string;
  guestsCount: number;
  source: BookingSource;
  /** Defaults to pending (staff confirm, D-B). A walk-in is always created confirmed. */
  status?: "pending" | "confirmed";
  expectedArrivalTime?: string | null;
  /** Same key again returns the original booking instead of creating a second one. */
  idempotencyKey?: string | null;
}

interface BookingKeyRow { id: number; guest_id: number; room_type_id: number; check_in_date: string; check_out_date: string; guests_count: number }

async function replayBooking(db: Db, actor: Actor, input: CreateBookingInput): Promise<number | null> {
  const prior: BookingKeyRow | undefined = await db("bookings").where({ property_id: actor.propertyId, idempotency_key: input.idempotencyKey }).first("id", "guest_id", "room_type_id", "check_in_date", "check_out_date", "guests_count");
  if (!prior) return null;
  const same = prior.guest_id === input.guestId && prior.room_type_id === input.roomTypeId && prior.check_in_date === input.checkInDate && prior.check_out_date === input.checkOutDate && prior.guests_count === input.guestsCount;
  assert(same, "IDEMPOTENCY_CONFLICT", "This request key was already used for a different booking");
  return prior.id;
}

export async function createBooking(db: Db, actor: Actor, input: CreateBookingInput): Promise<number> {
  if (input.idempotencyKey) {
    const prior = await replayBooking(db, actor, input);
    if (prior !== null) return prior;
  }
  try {
    return await insertBooking(db, actor, input);
  } catch (e) {
    // A concurrent request with the same key won the race: return its booking.
    if (input.idempotencyKey && isDuplicateOn(e, "uq_bookings_idempotency")) {
      const prior = await replayBooking(db, actor, input);
      if (prior !== null) return prior;
    }
    throw e;
  }
}

function insertBooking(db: Db, actor: Actor, input: CreateBookingInput): Promise<number> {
  const status = input.source === "walk_in" ? "confirmed" : (input.status ?? "pending"); // D-B
  return inTx(db, async (trx) => {
    const guest = await trx("guests").where({ id: input.guestId, property_id: actor.propertyId }).first("id");
    assert(guest, "GUEST_NOT_FOUND", "Guest not found");
    const type = await trx("room_types").where({ id: input.roomTypeId, property_id: actor.propertyId, is_active: true }).first();
    assert(type, "ROOM_TYPE_NOT_FOUND", "Room type not found");
    assert(input.guestsCount >= 1 && input.guestsCount <= Number(type.capacity), "OVER_CAPACITY", "Guests exceed the room type capacity"); // R7
    const nights = nightsBetween(input.checkInDate, input.checkOutDate);
    if (input.roomId != null) {
      const room = await lockRoom(trx, actor, input.roomId);
      assert(room.room_type_id === input.roomTypeId, "ROOM_TYPE_MISMATCH", "The room is not of the booked type");
      assert(!room.is_out_of_service, "ROOM_OUT_OF_SERVICE", "The room is out of service");
      await assertRoomFree(trx, room.id, input.checkInDate, input.checkOutDate, null);
    }
    const rate = toMinor(String(type.base_rate)); // snapshot (DB8)
    const reference = input.reference ?? (await nextReference(trx, actor, "booking")); // lock taken last
    const id = await insertId(
      trx("bookings").insert({
        property_id: actor.propertyId, reference, idempotency_key: input.idempotencyKey ?? null, guest_id: input.guestId, room_type_id: input.roomTypeId, room_id: input.roomId ?? null,
        check_in_date: input.checkInDate, check_out_date: input.checkOutDate, guests_count: input.guestsCount, source: input.source, status,
        nightly_rate: fromMinor(rate), room_total: fromMinor(rate * BigInt(nights)), expected_arrival_time: input.expectedArrivalTime ?? null, created_by_user_id: actor.userId,
      }),
    );
    await audit(trx, actor, { entityType: "booking", entityId: id, action: "create", toState: status, details: { nights } });
    return id;
  });
}

async function transition(trx: Trx, actor: Actor, bookingId: number, from: string[], to: string, patch: Record<string, unknown>): Promise<void> {
  const b = await lockBooking(trx, actor, bookingId);
  assert(from.includes(b.status), "INVALID_TRANSITION", `Booking cannot move from ${b.status} to ${to}`);
  await trx("bookings").where({ id: bookingId }).update({ ...patch, status: to, updated_at: nowUtc() });
  await audit(trx, actor, { entityType: "booking", entityId: bookingId, action: to, fromState: b.status, toState: to });
}

export const confirmBooking = (db: Db, actor: Actor, bookingId: number): Promise<void> => inTx(db, (trx) => transition(trx, actor, bookingId, ["pending"], "confirmed", {}));

/** confirmed → checked_in. Assigns the room if it isn't already, and the room becomes occupied (derived). */
export function checkIn(db: Db, actor: Actor, input: { bookingId: number; roomId?: number | null; at?: Date }): Promise<void> {
  return inTx(db, async (trx) => {
    const b = await lockBooking(trx, actor, input.bookingId); // lock order: booking → room
    assert(b.status === "confirmed", "INVALID_TRANSITION", `Booking cannot be checked in from ${b.status}`);
    const roomId = input.roomId ?? b.room_id;
    assert(roomId != null, "ROOM_REQUIRED", "A room must be assigned at check-in"); // Q3
    const room = await lockRoom(trx, actor, roomId);
    assert(room.room_type_id === b.room_type_id, "ROOM_TYPE_MISMATCH", "The room is not of the booked type");
    assert(!room.is_out_of_service, "ROOM_OUT_OF_SERVICE", "The room is out of service");
    // The previous guest may still be in the room past their dates (T2): checked explicitly under the room lock.
    const occupant = await trx("bookings").where({ occupied_room_id: room.id }).whereNot("id", b.id).forShare().first("id");
    assert(!occupant, "ROOM_OCCUPIED", "The room is still occupied by another guest");
    await assertRoomFree(trx, room.id, b.check_in_date, b.check_out_date, b.id);
    await trx("bookings").where({ id: b.id }).update({ status: "checked_in", room_id: room.id, checked_in_at: input.at ?? nowUtc(), updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "booking", entityId: b.id, action: "check_in", fromState: "confirmed", toState: "checked_in", details: { room_id: room.id } });
  });
}

export interface CheckOutResult {
  invoiceId: number | null;
  invoiceNumber: string | null;
}

/**
 * checked_in → checked_out. The room is freed (derived) and housekeeping becomes dirty (D-H). A balance
 * never blocks (D-D). The final stay invoice is issued in the same transaction (D-C): its one line is
 * built here from the booking's own snapshot (nights × nightly_rate), never from client input. It is
 * skipped when an issued stay invoice already exists, or when `finalInvoice` is false (the demo seed
 * issues its historical invoices itself).
 * Lock order: booking → room → (issueInvoice) payments → invoices → invoice sequence.
 */
export function checkOut(db: Db, actor: Actor, input: { bookingId: number; at?: Date; finalInvoice?: boolean }): Promise<CheckOutResult> {
  return inTx(db, async (trx) => {
    const b = await lockBooking(trx, actor, input.bookingId);
    assert(b.status === "checked_in", "INVALID_TRANSITION", `Booking cannot be checked out from ${b.status}`);
    await lockRoom(trx, actor, b.room_id!);
    const at = input.at ?? nowUtc();
    await trx("bookings").where({ id: b.id }).update({ status: "checked_out", checked_out_at: at, updated_at: nowUtc() });
    await trx("rooms").where({ id: b.room_id! }).update({ housekeeping_status: "dirty", updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "booking", entityId: b.id, action: "check_out", fromState: "checked_in", toState: "checked_out" });
    if (input.finalInvoice === false) return { invoiceId: null, invoiceNumber: null };

    const existing = await trx("invoices").where({ booking_id: b.id, invoice_type: "stay", status: "issued" }).first("id");
    if (existing) return { invoiceId: null, invoiceNumber: null };
    const property = await trx("properties").where({ id: actor.propertyId }).first("timezone");
    const type = await trx("room_types").where({ id: b.room_type_id }).first("name");
    const issueDate = businessDate(at, property.timezone as string);
    const nights = nightsBetween(b.check_in_date, b.check_out_date);
    const inv = await issueInvoice(trx, actor, {
      bookingId: b.id, invoiceType: "stay", issueDate, series: financialYear(issueDate),
      lines: [{ description: `${type.name as string} room, ${nights} night(s)`, quantity: `${nights}.00`, unitPrice: String(b.nightly_rate) }],
    });
    return { invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber };
  });
}

/**
 * Rooms a confirmed booking can be checked in to (D-F): the booked type, in service, not occupied
 * now, and not held by another active booking for overlapping dates. Read-only; checkIn re-checks
 * everything under locks.
 */
export async function freeRoomsForBooking(db: Db, actor: Actor, bookingId: number): Promise<Array<{ id: number; number: string; floor: number | null; housekeeping_status: string }>> {
  const b = await db("bookings").where({ id: bookingId, property_id: actor.propertyId }).first("id", "room_type_id", "check_in_date", "check_out_date");
  assert(b, "BOOKING_NOT_FOUND", "Booking not found");
  return db("rooms as r")
    .where({ "r.property_id": actor.propertyId, "r.room_type_id": b.room_type_id, "r.is_out_of_service": false })
    .whereNotExists((q) => q.select(db.raw("1")).from("bookings as o").whereRaw("o.occupied_room_id = r.id"))
    .whereNotExists((q) =>
      q.select(db.raw("1")).from("bookings as o").whereRaw("o.room_id = r.id").whereIn("o.status", ACTIVE).whereNot("o.id", b.id)
        .where("o.check_in_date", "<", b.check_out_date).where("o.check_out_date", ">", b.check_in_date),
    )
    .orderBy("r.number")
    .select("r.id", "r.number", "r.floor", "r.housekeeping_status");
}

/** pending/confirmed → cancelled. Money received stays as an advance until someone decides (R20). */
export function cancelBooking(db: Db, actor: Actor, input: { bookingId: number; reason: string }): Promise<void> {
  assert(input.reason.trim().length > 0, "REASON_REQUIRED", "A cancellation reason is required");
  return inTx(db, (trx) => transition(trx, actor, input.bookingId, ["pending", "confirmed"], "cancelled", { cancelled_at: nowUtc(), cancellation_reason: input.reason }));
}

export interface UpdateBookingInput {
  checkInDate?: string;
  checkOutDate?: string;
  guestsCount?: number;
  /** "HH:MM", or null to clear. */
  expectedArrivalTime?: string | null;
}

/**
 * Corrects a booking before arrival (Q25 working assumption): only `pending` or `confirmed`, and only while
 * no invoice has been issued. The total is recomputed from the booking's stored nightly rate. Nothing about
 * price, status, room type or reference can be passed in. Capacity and room overlap are re-checked under locks.
 * Lock order: booking → room, as in checkIn.
 */
export function updateBooking(db: Db, actor: Actor, bookingId: number, input: UpdateBookingInput): Promise<{ nights: number; total: string }> {
  return inTx(db, async (trx) => {
    const b = await trx("bookings").where({ id: bookingId, property_id: actor.propertyId }).forUpdate().first();
    assert(b, "BOOKING_NOT_FOUND", "Booking not found");
    assert(["pending", "confirmed"].includes(b.status as string), "BOOKING_NOT_EDITABLE", `A ${String(b.status)} booking cannot be edited`);
    const invoiced = await trx("invoices").where({ booking_id: bookingId, status: "issued" }).first("id");
    assert(!invoiced, "BOOKING_NOT_EDITABLE", "A booking with an issued invoice cannot be edited");

    const checkIn = input.checkInDate ?? (b.check_in_date as string);
    const checkOut = input.checkOutDate ?? (b.check_out_date as string);
    const nights = nightsBetween(checkIn, checkOut);
    const guests = input.guestsCount ?? (b.guests_count as number);
    const type = await trx("room_types").where({ id: b.room_type_id }).first("capacity");
    assert(guests >= 1 && guests <= Number(type.capacity), "OVER_CAPACITY", "Guests exceed the room type capacity");
    if (b.room_id != null) {
      const room = await lockRoom(trx, actor, b.room_id as number);
      assert(!room.is_out_of_service, "ROOM_OUT_OF_SERVICE", "The room is out of service");
      await assertRoomFree(trx, room.id, checkIn, checkOut, bookingId);
    }
    const arrival = input.expectedArrivalTime === undefined ? undefined : input.expectedArrivalTime === null ? null : `${input.expectedArrivalTime}:00`;
    const changed: string[] = [];
    if (checkIn !== b.check_in_date) changed.push("check_in_date");
    if (checkOut !== b.check_out_date) changed.push("check_out_date");
    if (guests !== b.guests_count) changed.push("guests_count");
    if (arrival !== undefined && arrival !== b.expected_arrival_time) changed.push("expected_arrival_time");
    assert(changed.length > 0, "NOTHING_TO_CHANGE", "No changes were provided");

    const total = fromMinor(toMinor(String(b.nightly_rate)) * BigInt(nights));
    await trx("bookings").where({ id: bookingId }).update({
      check_in_date: checkIn, check_out_date: checkOut, guests_count: guests, room_total: total, updated_at: nowUtc(),
      ...(arrival !== undefined ? { expected_arrival_time: arrival } : {}),
    });
    await audit(trx, actor, { entityType: "booking", entityId: bookingId, action: "update", details: { fields: changed.join(","), nights, room_total: total } });
    return { nights, total };
  });
}
