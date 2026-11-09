/**
 * CRUD increment 3: Rooms. Create, read, update (floor/type), maintenance (out of service), housekeeping,
 * roles (admin vs front_desk, enforced by the API), invalid input, concurrency, audit. No delete exists.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkIn, createBooking } from "../services/bookings.js";
import { setMaintenance } from "../services/rooms.js";
import { startApi, type Api } from "./api-client.js";
import { createFixture, parallel, printReport, record, refusal, settle, type Fixture } from "./harness.js";

let fx: Fixture;
let other: Fixture;
let api: Api;
let admin: string;
let fd: string;
let day = 0;
const dates = (nights = 2) => {
  const start = new Date(Date.UTC(2040, 0, 1) + day * 86_400_000);
  day += nights + 3;
  return { checkInDate: start.toISOString().slice(0, 10), checkOutDate: new Date(start.getTime() + nights * 86_400_000).toISOString().slice(0, 10) };
};
let n = 0;
const newRoom = async (extra: Record<string, unknown> = {}) => {
  const r = await api.call("POST", "/api/rooms", { token: admin, body: { number: `R${++n}x${fx.tag.slice(0, 3)}`, roomTypeId: fx.roomTypeId, floor: 2, ...extra } });
  expect(r.status).toBe(201);
  return r.body.id as string;
};
const rooms = async () => (await api.call("GET", "/api/rooms", { token: fd })).body as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const room = async (id: string) => (await rooms()).find((r) => r.id === id)!;
const booking = (roomId?: number) => createBooking(fx.db, fx.actor, { guestId: fx.guestId, roomTypeId: fx.roomTypeId, ...(roomId ? { roomId } : {}), guestsCount: 1, source: "direct", status: "confirmed", ...dates() });

beforeAll(async () => {
  fx = await createFixture();
  other = await createFixture();
  api = await startApi(fx);
  admin = await api.tokenFor("admin");
  fd = await api.tokenFor("front_desk");
});
afterAll(async () => {
  printReport();
  await api?.close();
  await fx?.db.destroy();
  await other?.db.destroy();
});

describe("create and read", () => {
  it("an admin adds a room; it is listed available and clean; duplicates and bad input are refused", async () => {
    const id = await newRoom({ number: "A-101" });
    expect(await room(id)).toMatchObject({ number: "A-101", floor: 2, status: "available", housekeeping: "clean", outOfService: false, type: "Standard", rate: 1000 });
    record("Rooms", "admin creates room A-101", "listed available + clean", "service");
    api.expectError(await api.call("POST", "/api/rooms", { token: admin, body: { number: "A-101", roomTypeId: fx.roomTypeId } }), 409, "ROOM_NUMBER_EXISTS");
    const bad: Array<[string, unknown, number, string]> = [
      ["empty number", { number: "", roomTypeId: fx.roomTypeId }, 400, "VALIDATION"], ["spaces in number", { number: "A 1", roomTypeId: fx.roomTypeId }, 400, "VALIDATION"],
      ["number too long", { number: "X".repeat(11), roomTypeId: fx.roomTypeId }, 400, "VALIDATION"], ["missing type", { number: "B1" }, 400, "VALIDATION"],
      ["unknown field", { number: "B2", roomTypeId: fx.roomTypeId, housekeeping_status: "dirty" }, 400, "VALIDATION"], ["status field", { number: "B3", roomTypeId: fx.roomTypeId, status: "occupied" }, 400, "VALIDATION"],
      ["unknown room type", { number: "B4", roomTypeId: 999999999 }, 404, "ROOM_TYPE_NOT_FOUND"], ["another property's type", { number: "B5", roomTypeId: other.roomTypeId }, 404, "ROOM_TYPE_NOT_FOUND"],
    ];
    for (const [label, body, status, code] of bad) {
      api.expectError(await api.call("POST", "/api/rooms", { token: admin, body }), status, code);
      record("Rooms", `create with ${label}`, `${status} ${code}`, status === 400 ? "API validation (zod strict)" : "service");
    }
    expect((await rooms()).some((r) => ["B1", "B2", "B3", "B4", "B5"].includes(r.number))).toBe(false);
  });

  it("5 parallel creates of one number: exactly one room", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => api.call("POST", "/api/rooms", { token: admin, body: { number: "RACE-1", roomTypeId: fx.roomTypeId } })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === "ROOM_NUMBER_EXISTS")).toBe(true);
    expect((await rooms()).filter((r) => r.number === "RACE-1")).toHaveLength(1);
    record("Rooms", "5 parallel creates of RACE-1", "1 created, 4 refused ROOM_NUMBER_EXISTS", "service + uq_rooms_number");
  });
});

describe("roles are enforced by the API", () => {
  it("front desk cannot create, change type or put a room out of service, but can do housekeeping", async () => {
    const id = await newRoom();
    api.expectError(await api.call("POST", "/api/rooms", { token: fd, body: { number: "FD-1", roomTypeId: fx.roomTypeId } }), 403, "FORBIDDEN");
    api.expectError(await api.call("PATCH", `/api/rooms/${id}`, { token: fd, body: { floor: 9 } }), 403, "FORBIDDEN");
    api.expectError(await api.call("POST", `/api/rooms/${id}/maintenance`, { token: fd, body: { outOfService: true, reason: "x" } }), 403, "FORBIDDEN");
    expect((await api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: "dirty" } })).status).toBe(200);
    for (const [m, p] of [["POST", "/api/rooms"], ["PATCH", `/api/rooms/${id}`], ["POST", `/api/rooms/${id}/maintenance`], ["POST", `/api/rooms/${id}/housekeeping`]] as const) {
      api.expectError(await api.call(m, p, { body: {} }), 401, "UNAUTHORIZED");
    }
    expect(await room(id)).toMatchObject({ floor: 2, outOfService: false, housekeeping: "dirty" });
    record("Rooms", "front_desk create / edit / maintenance", "403 FORBIDDEN (housekeeping allowed)", "API role guard");
  });
});

describe("update", () => {
  it("floor and type change; type change is refused while a booking is assigned; other property's room is not found", async () => {
    const id = await newRoom();
    const suite = (await fx.db("room_types").insert({ property_id: fx.actor.propertyId, code: `SU${n}`, name: "Suite", base_rate: "3000.00", capacity: 4 }))[0]!;
    expect((await api.call("PATCH", `/api/rooms/${id}`, { token: admin, body: { floor: 5, roomTypeId: String(suite) } })).status).toBe(200);
    expect(await room(id)).toMatchObject({ floor: 5, type: "Suite", rate: 3000 });
    api.expectError(await api.call("PATCH", `/api/rooms/${id}`, { token: admin, body: { floor: 5 } }), 400, "NOTHING_TO_CHANGE");
    api.expectError(await api.call("PATCH", `/api/rooms/${id}`, { token: admin, body: { name: "x" } }), 400, "VALIDATION");
    api.expectError(await api.call("PATCH", `/api/rooms/${other.roomIds[0]}`, { token: admin, body: { floor: 1 } }), 404, "ROOM_NOT_FOUND");

    const held = await newRoom();
    await booking(Number(held));
    api.expectError(await api.call("PATCH", `/api/rooms/${held}`, { token: admin, body: { roomTypeId: String(suite) } }), 409, "ROOM_HAS_BOOKINGS");
    expect((await api.call("PATCH", `/api/rooms/${held}`, { token: admin, body: { floor: 7 } })).status).toBe(200);
    record("Rooms", "change type of a room with an assigned booking", "409 ROOM_HAS_BOOKINGS (floor still editable)", "service");
  });
});

describe("maintenance", () => {
  it("goes out of service with a reason, disappears from free rooms, and returns", async () => {
    const id = await newRoom();
    const b = await booking();
    const freeIds = async () => (await api.call("GET", `/api/bookings/${b}/free-rooms`, { token: fd })).body.map((r: { id: string }) => r.id);
    expect(await freeIds()).toContain(id);
    api.expectError(await api.call("POST", `/api/rooms/${id}/maintenance`, { token: admin, body: { outOfService: true } }), 422, "REASON_REQUIRED");
    api.expectError(await api.call("POST", `/api/rooms/${id}/maintenance`, { token: admin, body: { outOfService: true, reason: "  " } }), 422, "REASON_REQUIRED");
    const dashBefore = (await api.call("GET", "/api/dashboard", { token: fd })).body.stats;
    expect((await api.call("POST", `/api/rooms/${id}/maintenance`, { token: admin, body: { outOfService: true, reason: "Leaking tap" } })).status).toBe(200);
    expect(await room(id)).toMatchObject({ status: "maintenance", outOfService: true });
    expect(await freeIds()).not.toContain(id);
    const dashAfter = (await api.call("GET", "/api/dashboard", { token: fd })).body.stats;
    expect([dashAfter.maintenance - dashBefore.maintenance, dashBefore.available - dashAfter.available]).toEqual([1, 1]);
    api.expectError(await api.call("POST", `/api/rooms/${id}/maintenance`, { token: admin, body: { outOfService: true, reason: "again" } }), 400, "NOTHING_TO_CHANGE");
    expect((await api.call("POST", `/api/rooms/${id}/maintenance`, { token: admin, body: { outOfService: false } })).status).toBe(200);
    expect(await room(id)).toMatchObject({ status: "available", outOfService: false });
    expect(await freeIds()).toContain(id);
    const audits = await fx.db("audit_events").where({ entity_type: "room", entity_id: Number(id) }).orderBy("id").pluck("action");
    expect(audits).toEqual(["create", "out_of_service", "back_in_service"]);
    record("Rooms", "out of service and back", "dashboard maintenance +1 / available −1, free-room list follows, audited", "service + views");
  });

  it("is refused for an occupied room and for a room with an upcoming booking", async () => {
    const occupied = await newRoom();
    const b1 = await booking();
    await checkIn(fx.db, fx.actor, { bookingId: b1, roomId: Number(occupied) });
    api.expectError(await api.call("POST", `/api/rooms/${occupied}/maintenance`, { token: admin, body: { outOfService: true, reason: "x" } }), 409, "ROOM_OCCUPIED");
    const reserved = await newRoom();
    await booking(Number(reserved));
    api.expectError(await api.call("POST", `/api/rooms/${reserved}/maintenance`, { token: admin, body: { outOfService: true, reason: "x" } }), 409, "ROOM_HAS_BOOKINGS");
    expect((await room(occupied)).outOfService).toBe(false);
    record("Rooms", "maintenance on an occupied room / a room with an upcoming booking", "409 ROOM_OCCUPIED / 409 ROOM_HAS_BOOKINGS", "service");
  });

  it("a parallel check-in and maintenance never both succeed", async () => {
    for (let i = 0; i < 4; i++) {
      const id = await newRoom();
      const b = await booking();
      const res = await Promise.allSettled([checkIn(fx.db, fx.actor, { bookingId: b, roomId: Number(id) }), setMaintenance(fx.db, fx.actor, Number(id), { outOfService: true, reason: "race" })]);
      const { refused } = settle(res.map((r) => r as PromiseSettledResult<unknown>));
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(["ROOM_OUT_OF_SERVICE", "ROOM_OCCUPIED"]).toContain(refused[0]!.code);
    }
    record("Rooms", "4 races: check-in vs out-of-service on one room", "exactly one wins each time", "service (room row lock)");
  });
});

describe("housekeeping", () => {
  it("moves between clean, dirty and inspecting and refuses invalid input", async () => {
    const id = await newRoom();
    for (const s of ["dirty", "inspecting", "clean"]) {
      expect((await api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: s } })).status).toBe(200);
      expect((await room(id)).housekeeping).toBe(s);
    }
    api.expectError(await api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: "clean" } }), 400, "NOTHING_TO_CHANGE");
    api.expectError(await api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: "spotless" } }), 400, "VALIDATION");
    api.expectError(await api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: "dirty", number: "1" } }), 400, "VALIDATION");
    api.expectError(await api.call("POST", `/api/rooms/${other.roomIds[0]}/housekeeping`, { token: fd, body: { status: "dirty" } }), 404, "ROOM_NOT_FOUND");
    const audits = await fx.db("audit_events").where({ entity_type: "room", entity_id: Number(id), action: "housekeeping" }).orderBy("id").select("from_state", "to_state");
    expect(audits).toEqual([{ from_state: "clean", to_state: "dirty" }, { from_state: "dirty", to_state: "inspecting" }, { from_state: "inspecting", to_state: "clean" }]);
    record("Rooms", "housekeeping clean → dirty → inspecting → clean", "saved and audited; same status / unknown status refused", "service + API validation");
  });

  it("checkout leaves a room dirty, and marking it clean updates the Rooms data", async () => {
    const id = await newRoom();
    const b = await booking();
    await checkIn(fx.db, fx.actor, { bookingId: b, roomId: Number(id) });
    await api.call("POST", `/api/bookings/${b}/check-out`, { token: fd, body: {} });
    expect(await room(id)).toMatchObject({ status: "available", housekeeping: "dirty" });
    await api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: "clean" } });
    expect(await room(id)).toMatchObject({ status: "available", housekeeping: "clean" });
    record("Rooms", "checkout then mark clean", "available + dirty → available + clean", "service");
  });
});

describe("remove (soft delete)", () => {
  it("admin soft-removes a room; hard DELETE is still refused by grants", async () => {
    const id = await newRoom();
    api.expectError(await api.call("POST", `/api/rooms/${id}/remove`, { token: fd, body: { reason: "No" } }), 403, "FORBIDDEN");
    api.expectError(await api.call("POST", `/api/rooms/${id}/remove`, { token: admin, body: { reason: "  " } }), 400, "VALIDATION");
    expect((await api.call("POST", `/api/rooms/${id}/remove`, { token: admin, body: { reason: "Removed from inventory" } })).status).toBe(200);
    expect(await room(id)).toMatchObject({ status: "maintenance", outOfService: true });
    api.expectError(await api.call("POST", `/api/rooms/${id}/remove`, { token: admin, body: { reason: "again" } }), 422, "ROOM_ALREADY_REMOVED");
    const del = await refusal(fx.db("rooms").where({ id: Number(id) }).delete());
    expect(del.boundary).toBe("grant");
    expect((await api.call("POST", `/api/rooms/${id}/maintenance`, { token: admin, body: { outOfService: false } })).status).toBe(200);
    expect(await room(id)).toMatchObject({ status: "available", outOfService: false });
    record("Rooms", "soft remove + restore; hard DELETE refused", "outOfService then grant blocks DELETE", "service + grant");
  });
  it("parallel is fine: 10 parallel housekeeping updates leave one valid status", async () => {
    const id = await newRoom();
    const res = settle(await parallel(10, (i) => api.call("POST", `/api/rooms/${id}/housekeeping`, { token: fd, body: { status: ["dirty", "inspecting", "clean"][i % 3] } })));
    expect(res.refused).toEqual([]);
    expect(["clean", "dirty", "inspecting"]).toContain((await room(id)).housekeeping);
  });
});
