/**
 * Room management (Q26). Rooms are never hard-deleted (app DB has no DELETE grant; booking history keeps FKs).
 * "Remove" / delete in the UI is a soft archive: is_out_of_service = true. Occupancy is derived from check-in
 * (D2). The room number is immutable. Every function locks the room row first and takes no booking row locks,
 * so it cannot deadlock with checkIn (booking → room).
 */
import type { Knex } from "knex";
import type { Db } from "../db/knex.js";
import { businessDate } from "../domain/dates.js";
import { assert, DomainError } from "../domain/errors.js";
import { audit, inTx, insertId, nowUtc, type Actor } from "./context.js";
import { isDuplicateOn } from "./references.js";

type Trx = Knex.Transaction;
export type Housekeeping = "clean" | "dirty" | "inspecting";
const ACTIVE = ["pending", "confirmed", "checked_in"];

async function lockRoom(trx: Trx, actor: Actor, roomId: number) {
  const room = await trx("rooms").where({ id: roomId, property_id: actor.propertyId }).forUpdate().first();
  assert(room, "ROOM_NOT_FOUND", "Room not found");
  return room as { id: number; number: string; room_type_id: number; floor: number | null; is_out_of_service: number | boolean; housekeeping_status: Housekeeping };
}

export interface CreateRoomInput { number: string; roomTypeId: number; floor?: number | null }

export async function createRoom(db: Db, actor: Actor, input: CreateRoomInput): Promise<number> {
  const number = input.number.trim();
  assert(/^[A-Za-z0-9-]{1,10}$/.test(number), "INVALID_ROOM", "Room number is 1–10 letters, digits or hyphens");
  try {
    return await inTx(db, async (trx) => {
      const type = await trx("room_types").where({ id: input.roomTypeId, property_id: actor.propertyId, is_active: true }).first("id");
      assert(type, "ROOM_TYPE_NOT_FOUND", "Room type not found");
      const dup = await trx("rooms").where({ property_id: actor.propertyId, number }).first("id");
      assert(!dup, "ROOM_NUMBER_EXISTS", "A room with this number already exists");
      const id = await insertId(trx("rooms").insert({ property_id: actor.propertyId, room_type_id: input.roomTypeId, number, floor: input.floor ?? null, created_by_user_id: actor.userId }));
      await audit(trx, actor, { entityType: "room", entityId: id, action: "create", details: { number, room_type_id: input.roomTypeId } });
      return id;
    });
  } catch (e) {
    // Two admins adding the same number at once: the unique key decides, the loser gets the same clear error.
    if (isDuplicateOn(e, "uq_rooms_number")) throw new DomainError("ROOM_NUMBER_EXISTS", "A room with this number already exists");
    throw e;
  }
}

export interface UpdateRoomInput { floor?: number | null; roomTypeId?: number }

export function updateRoom(db: Db, actor: Actor, roomId: number, input: UpdateRoomInput): Promise<void> {
  return inTx(db, async (trx) => {
    const room = await lockRoom(trx, actor, roomId);
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    if (input.floor !== undefined && input.floor !== room.floor) {
      patch["floor"] = input.floor;
      changed.push("floor");
    }
    if (input.roomTypeId !== undefined && input.roomTypeId !== room.room_type_id) {
      const type = await trx("room_types").where({ id: input.roomTypeId, property_id: actor.propertyId, is_active: true }).first("id");
      assert(type, "ROOM_TYPE_NOT_FOUND", "Room type not found");
      const active = await trx("bookings").where({ room_id: roomId }).whereIn("status", ACTIVE).first("id");
      assert(!active, "ROOM_HAS_BOOKINGS", "The room type cannot change while a pending, confirmed or in-house booking is assigned to this room");
      patch["room_type_id"] = input.roomTypeId;
      changed.push("room_type_id");
    }
    assert(changed.length > 0, "NOTHING_TO_CHANGE", "No changes were provided");
    await trx("rooms").where({ id: roomId }).update({ ...patch, updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "room", entityId: roomId, action: "update", details: { number: room.number, fields: changed.join(",") } });
  });
}

/** Out of service on/off. Turning it on is refused while the room is occupied or has an upcoming assigned booking (Q21). */
export function setMaintenance(db: Db, actor: Actor, roomId: number, input: { outOfService: boolean; reason?: string }): Promise<void> {
  return inTx(db, async (trx) => {
    const room = await lockRoom(trx, actor, roomId);
    const current = !!room.is_out_of_service;
    assert(current !== input.outOfService, "NOTHING_TO_CHANGE", input.outOfService ? "The room is already out of service" : "The room is already in service");
    if (input.outOfService) {
      const reason = (input.reason ?? "").trim();
      assert(reason.length > 0 && reason.length <= 200, "REASON_REQUIRED", "A reason is required (max 200 characters)");
      const property = await trx("properties").where({ id: actor.propertyId }).first("timezone");
      const today = businessDate(new Date(), property.timezone as string);
      const occupant = await trx("bookings").where({ occupied_room_id: roomId }).first("id");
      assert(!occupant, "ROOM_OCCUPIED", "The room is occupied. Check the guest out first");
      const upcoming = await trx("bookings").where({ room_id: roomId }).whereIn("status", ["pending", "confirmed"]).where("check_out_date", ">", today).first("id");
      assert(!upcoming, "ROOM_HAS_BOOKINGS", "The room has an upcoming booking assigned. Reassign or cancel it first");
    }
    await trx("rooms").where({ id: roomId }).update({ is_out_of_service: input.outOfService, updated_at: nowUtc() });
    await audit(trx, actor, {
      entityType: "room", entityId: roomId, action: input.outOfService ? "out_of_service" : "back_in_service",
      details: { number: room.number, ...(input.outOfService ? { reason: (input.reason ?? "").trim() } : {}) },
    });
  });
}

export function setHousekeeping(db: Db, actor: Actor, roomId: number, status: Housekeeping): Promise<void> {
  return inTx(db, async (trx) => {
    assert(["clean", "dirty", "inspecting"].includes(status), "INVALID_ROOM", "Unknown housekeeping status");
    const room = await lockRoom(trx, actor, roomId);
    assert(room.housekeeping_status !== status, "NOTHING_TO_CHANGE", `The room is already ${status}`);
    await trx("rooms").where({ id: roomId }).update({ housekeeping_status: status, updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "room", entityId: roomId, action: "housekeeping", fromState: room.housekeeping_status, toState: status, details: { number: room.number } });
  });
}

/**
 * Soft-delete for the Rooms screen. Same guards as maintenance on; the row stays for history and can be
 * restored with setMaintenance(..., false) ("Return to service").
 */
export function removeRoom(db: Db, actor: Actor, roomId: number, reason: string): Promise<void> {
  return inTx(db, async (trx) => {
    const room = await lockRoom(trx, actor, roomId);
    assert(!room.is_out_of_service, "ROOM_ALREADY_REMOVED", "This room is already removed from inventory");
    const why = reason.trim();
    assert(why.length > 0 && why.length <= 200, "REASON_REQUIRED", "A reason is required (max 200 characters)");
    const property = await trx("properties").where({ id: actor.propertyId }).first("timezone");
    const today = businessDate(new Date(), property.timezone as string);
    const occupant = await trx("bookings").where({ occupied_room_id: roomId }).first("id");
    assert(!occupant, "ROOM_OCCUPIED", "The room is occupied. Check the guest out first");
    const upcoming = await trx("bookings").where({ room_id: roomId }).whereIn("status", ["pending", "confirmed"]).where("check_out_date", ">", today).first("id");
    assert(!upcoming, "ROOM_HAS_BOOKINGS", "The room has an upcoming booking assigned. Reassign or cancel it first");
    await trx("rooms").where({ id: roomId }).update({ is_out_of_service: true, updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "room", entityId: roomId, action: "remove", details: { number: room.number, reason: why } });
  });
}
