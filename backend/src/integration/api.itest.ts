/**
 * Gate 3b T8: the HTTP API against MySQL, over real requests (an ephemeral port). Covers login and JWT
 * handling, role guards, strict validation (no client-supplied prices, references or statuses), tenant
 * isolation, duplicate-submit protection, and the demo journey end to end. Every row records which
 * boundary refused: api-auth, api-role, api-validation (zod), service, DB or none.
 * Runs on test hotels only. The demo property is never logged in to or touched.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../api/app.js";
import { resetLoginThrottle } from "../api/auth.js";
import { loadApiConfig, type ApiConfig } from "../api/config.js";
import { pendingMigrations } from "../db/migration-source.js";
import { createFixture, createUser, invariantViolations, printReport, record, type Fixture } from "./harness.js";

let fx: Fixture;
let other: Fixture;
let server: Server;
let base: string;
let config: ApiConfig;
let slug: string;
let frontDesk: { id: number; username: string; password: string };
let admin: { id: number; username: string; password: string };
let fdToken: string;
let adminToken: string;

interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function call(method: string, path: string, o: { token?: string; body?: unknown; slug?: string | null } = {}): Promise<Reply> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (o.token) headers["authorization"] = `Bearer ${o.token}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.slug !== null) headers["x-hotel-slug"] = o.slug ?? slug;
  const res = await fetch(`${base}${path}`, { method, headers, body: o.body === undefined ? null : JSON.stringify(o.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const login = (username: string, password: string, s?: string | null) => call("POST", "/api/auth/login", { body: { username, password }, slug: s ?? undefined });
const expectError = (r: Reply, status: number, code: string) => {
  expect(r.status).toBe(status);
  expect(r.body).toEqual({ error: { code, message: expect.any(String) } });
};
const sign = (claims: Record<string, unknown>, secret = config.jwtSecret, sub?: number) =>
  jwt.sign({ exp: Math.floor(Date.now() / 1000) + 300, ...claims }, secret, { algorithm: "HS256", subject: String(sub ?? frontDesk.id) });
const key = (): string => `k${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  fx = await createFixture();
  other = await createFixture();
  slug = `itest-${fx.tag}`;
  config = loadApiConfig();
  frontDesk = await createUser(fx, "front_desk", { fullName: "Front Desk Test" });
  admin = await createUser(fx, "admin");
  const app = createApp(fx.db, config);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fdToken = (await login(frontDesk.username, frontDesk.password)).body.token;
  adminToken = (await login(admin.username, admin.password)).body.token;
});
beforeEach(() => resetLoginThrottle());
afterEach(async () => {
  expect(await invariantViolations(fx.db, fx.actor.propertyId)).toEqual([]);
});
afterAll(async () => {
  printReport();
  await new Promise((r) => server?.close(r));
  await fx?.db.destroy();
  await other?.db.destroy();
});

describe("start-up", () => {
  it("no migrations are pending (the API refuses to start otherwise)", async () => {
    expect(await pendingMigrations(fx.db)).toEqual([]);
    record("T8", "pending migrations at start", "none pending", "start-up check (server.ts refuses to start if any)");
  });
  it("refuses to load without a long JWT secret", () => {
    expect(() => loadApiConfig({ NODE_ENV: "test" })).toThrow("JWT_SECRET");
    expect(() => loadApiConfig({ NODE_ENV: "test", JWT_SECRET: "short" })).toThrow("JWT_SECRET");
    expect(() => loadApiConfig({ NODE_ENV: "test", JWT_SECRET: "short" })).not.toThrow(/short/);
    record("T8", "start with a missing or short JWT_SECRET", "refused, the value is never printed", "config validation");
  });
  it("health is public and says nothing about the system", async () => {
    expect(await call("GET", "/health", { slug: null })).toEqual({ status: 200, body: { status: "ok" } });
  });
});

describe("login", () => {
  it("returns { token, user } and never the password hash", async () => {
    const r = await login(frontDesk.username, frontDesk.password);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["token", "user"]);
    expect(r.body.user).toEqual({ id: frontDesk.id, username: frontDesk.username, full_name: "Front Desk Test", role: "front_desk" });
    const claims = jwt.decode(r.body.token) as Record<string, unknown>;
    expect(claims["exp"]).toBeGreaterThan(Date.now() / 1000);
    expect(claims["exp"]).toBeLessThanOrEqual(Date.now() / 1000 + config.jwtTtlSeconds + 5);
    expect(JSON.stringify(r.body)).not.toMatch(/\$2[aby]\$/);
    expect((await fx.db("user_accounts").where({ id: frontDesk.id }).first("last_login_at")).last_login_at).not.toBeNull();
    record("T8", "valid login", "token with exp, user without a hash", "API");
  });

  it("wrong password, unknown user, unknown hotel and inactive account all look the same", async () => {
    const inactive = await createUser(fx, "front_desk", { active: false });
    const cases: Array<[string, Reply]> = [
      ["wrong password", await login(frontDesk.username, "nope-nope")],
      ["unknown user", await login("nobody-here", "whatever1")],
      ["unknown hotel", await login(frontDesk.username, frontDesk.password, "no-such-hotel")],
      ["inactive account (correct password)", await login(inactive.username, inactive.password)],
    ];
    for (const [label, r] of cases) {
      expectError(r, 401, "INVALID_CREDENTIALS");
      expect(r.body.error.message).toBe("Invalid username or password.");
      record("T8", `login: ${label}`, "401 INVALID_CREDENTIALS (same message)", "API (bcrypt / is_active)");
    }
  });

  it("validates the body strictly", async () => {
    expectError(await call("POST", "/api/auth/login", { body: {} }), 400, "VALIDATION");
    expectError(await call("POST", "/api/auth/login", { body: { username: "a", password: "b", role: "admin" } }), 400, "VALIDATION");
    expectError(await call("POST", "/api/auth/login", { body: { username: "a".repeat(200), password: "b" } }), 400, "VALIDATION");
    expectError(await call("POST", "/api/auth/login", { body: { username: "a", password: "b" }, slug: "Bad Slug!" }), 400, "VALIDATION");
    record("T8", "login with missing, extra or oversized fields", "400 VALIDATION", "API validation (zod strict)");
  });

  it("throttles after 5 failures, and a success clears the count", async () => {
    for (let i = 0; i < 5; i++) expectError(await login(frontDesk.username, "bad-password"), 401, "INVALID_CREDENTIALS");
    expectError(await login(frontDesk.username, frontDesk.password), 429, "RATE_LIMITED"); // even the right password
    record("T8", "6th login attempt after 5 failures", "429 RATE_LIMITED", "API throttle");
    resetLoginThrottle();
    for (let i = 0; i < 3; i++) await login(frontDesk.username, "bad-password");
    expect((await login(frontDesk.username, frontDesk.password)).status).toBe(200);
    for (let i = 0; i < 3; i++) await login(frontDesk.username, "bad-password");
    expect((await login(frontDesk.username, frontDesk.password)).status).toBe(200);
  });
});

describe("JWT and access control", () => {
  it("every /api route except login needs a valid token", async () => {
    const routes: Array<[string, string]> = [
      ["GET", "/api/auth/me"], ["GET", "/api/dashboard"], ["GET", "/api/bookings"], ["GET", "/api/rooms"], ["GET", "/api/guests"], ["GET", "/api/front-desk"],
      ["GET", "/api/invoices"], ["GET", "/api/payments"], ["GET", "/api/reports"], ["GET", "/api/settings"], ["GET", "/api/room-types"], ["GET", "/api/bookings/1"],
      ["POST", "/api/guests"], ["POST", "/api/bookings"], ["POST", "/api/bookings/1/confirm"], ["POST", "/api/bookings/1/check-in"], ["POST", "/api/bookings/1/check-out"], ["POST", "/api/payments"],
      ["GET", "/api/does-not-exist"],
    ];
    for (const [m, p] of routes) expectError(await call(m, p, { body: m === "POST" ? {} : undefined }), 401, "UNAUTHORIZED");
    record("T8", `${routes.length} routes without a token`, "all 401 UNAUTHORIZED", "API auth");
  });

  it("refuses expired, tampered, foreign-secret, unsigned and cross-property tokens", async () => {
    const good = sign({ pid: fx.actor.propertyId });
    expect((await call("GET", "/api/auth/me", { token: good })).status).toBe(200);
    const bad: Array<[string, string]> = [
      ["expired token", sign({ pid: fx.actor.propertyId, exp: Math.floor(Date.now() / 1000) - 30 })],
      ["signed with another secret", sign({ pid: fx.actor.propertyId }, "another-secret-that-is-long-enough-123456")],
      ["tampered payload", `${good.split(".")[0]}.${Buffer.from(JSON.stringify({ sub: String(admin.id), pid: fx.actor.propertyId, role: "super_admin", exp: 9_999_999_999 })).toString("base64url")}.${good.split(".")[2]}`],
      ["alg none", `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: String(admin.id), pid: fx.actor.propertyId })).toString("base64url")}.x`],
      ["no exp claim, cannot be rejected by time", jwt.sign({ pid: fx.actor.propertyId }, config.jwtSecret, { algorithm: "HS256", subject: String(frontDesk.id), noTimestamp: true })],
      ["valid user id with another property's id", sign({ pid: other.actor.propertyId })],
      ["garbage", "abc.def.ghi"],
    ];
    for (const [label, t] of bad) {
      expectError(await call("GET", "/api/auth/me", { token: t }), 401, "UNAUTHORIZED");
      record("T8", `token: ${label}`, "401", "API auth (HS256 only, signature, exp)");
    }
  });

  it("a deactivated account loses access with its existing token", async () => {
    const u = await createUser(fx, "front_desk");
    const t = (await login(u.username, u.password)).body.token as string;
    expect((await call("GET", "/api/auth/me", { token: t })).status).toBe(200);
    await fx.db("user_accounts").where({ id: u.id }).update({ is_active: false });
    expectError(await call("GET", "/api/auth/me", { token: t }), 401, "UNAUTHORIZED");
    record("T8", "deactivate an account, reuse its token", "401 at once", "API auth (account reloaded per request)");
  });

  it("/me returns the user; role guards protect reports and settings (server-side)", async () => {
    expect((await call("GET", "/api/auth/me", { token: fdToken })).body).toEqual({ user: { id: frontDesk.id, username: frontDesk.username, full_name: "Front Desk Test", role: "front_desk" } });
    for (const p of ["/api/reports", "/api/settings"]) {
      expectError(await call("GET", p, { token: fdToken }), 403, "FORBIDDEN");
      expect((await call("GET", p, { token: adminToken })).status).toBe(200);
      record("T8", `front_desk GET ${p}`, "403 FORBIDDEN (admin gets 200)", "API role guard");
    }
  });

  it("dashboard revenue is hidden from front_desk and shown to admin (D-G, §10)", async () => {
    const fd = (await call("GET", "/api/dashboard", { token: fdToken })).body;
    const ad = (await call("GET", "/api/dashboard", { token: adminToken })).body;
    expect([fd.stats.revenueToday, fd.stats.revenueMonth]).toEqual([null, null]);
    expect(typeof ad.stats.revenueToday).toBe("number");
    expect(typeof ad.stats.revenueMonth).toBe("number");
    record("T8", "dashboard revenue by role", "front_desk null, admin numbers", "API role logic");
  });

  it("errors use { error: { code, message } } and never leak internals", async () => {
    expectError(await call("GET", "/api/nope", { token: fdToken }), 404, "NOT_FOUND");
    expectError(await call("GET", "/api/bookings/abc", { token: fdToken }), 404, "NOT_FOUND");
    const r = await fetch(`${base}/api/guests`, { method: "POST", headers: { authorization: `Bearer ${fdToken}`, "content-type": "application/json" }, body: "{not json" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: { code: "VALIDATION", message: "The request body is not valid JSON" } });
    expect((await call("GET", "/health", { slug: null })).body).not.toHaveProperty("stack");
  });
});

describe("read endpoint shapes", () => {
  it("match the frontend types (no `reserved`, refunds apart from payment status)", async () => {
    const b = await fx.booking();
    await call("POST", "/api/payments", { token: fdToken, body: { bookingId: b, method: "upi", amount: "500.00", idempotencyKey: key() } });
    const keys = async (path: string, token = fdToken) => {
      const r = await call("GET", path, { token });
      expect(r.status, path).toBe(200);
      return r.body;
    };
    const dash = await keys("/api/dashboard");
    expect(Object.keys(dash).sort()).toEqual(["arrivals", "departures", "occupancyWeek", "propertyName", "recentBookings", "rooms", "stats"]);
    expect(dash.stats).not.toHaveProperty("reserved");
    expect(Object.keys(dash.stats).sort()).toEqual(["available", "bookingsToday", "checkInsToday", "checkOutsToday", "currency", "maintenance", "occupied", "revenueMonth", "revenueToday", "totalRooms"]);
    expect(dash.occupancyWeek).toHaveLength(7);
    expect(dash.stats.bookingsToday).toBeGreaterThanOrEqual(1); // bookings created today in the property timezone
    expect(dash.recentBookings.length).toBeLessThanOrEqual(6);
    expect(dash.rooms.every((r: { status: string }) => ["available", "occupied", "maintenance"].includes(r.status))).toBe(true);
    const bookings = await keys("/api/bookings");
    expect(Object.keys(bookings[0]).sort()).toEqual(["checkIn", "checkOut", "guestName", "guests", "id", "reference", "roomNumber", "roomType", "source", "status", "total"]);
    const rooms = await keys("/api/rooms");
    expect(Object.keys(rooms[0]).sort()).toEqual(["capacity", "floor", "housekeeping", "id", "number", "rate", "status", "type"]);
    const guests = await keys("/api/guests");
    expect(Object.keys(guests[0]).sort()).toEqual(["country", "email", "id", "lastStay", "name", "phone", "stays", "vip"]);
    const pays = await keys("/api/payments");
    expect(Object.keys(pays[0]).sort()).toEqual(["amount", "date", "guestName", "id", "invoiceNumber", "method", "reference", "refundedAmount", "status"]);
    expect(pays[0]).toMatchObject({ invoiceNumber: "Advance", method: "UPI", amount: 500, status: "success" });
    expect(Array.isArray(await keys("/api/invoices"))).toBe(true);
    expect(Array.isArray(await keys("/api/front-desk"))).toBe(true);
    const reports = await keys("/api/reports", adminToken);
    expect(Object.keys(reports).sort()).toEqual(["byRoomType", "bySource", "months"]);
    expect(reports.months).toHaveLength(6);
    const settings = await keys("/api/settings", adminToken);
    expect(Object.keys(settings.property).sort()).toEqual(["address", "checkInTime", "checkOutTime", "currency", "email", "name", "phone", "taxRate", "timezone"]);
    expect(settings.property.taxRate).toBe(12);
    expect(settings.taxComponents[0]).toMatchObject({ code: "GST", ratePercent: 12 });
    record("T8", "10 read endpoints", "shapes match src/types (documented differences only)", "API");
  });
});

describe("write validation: the client cannot set prices, references or status", () => {
  it("refuses unknown and malformed fields", async () => {
    const guest = (await call("POST", "/api/guests", { token: fdToken, body: { fullName: "Valid Guest" } })).body.id;
    const goodBooking = { guestId: guest, roomTypeId: fx.roomTypeId, checkInDate: "2033-02-01", checkOutDate: "2033-02-03", guestsCount: 1, source: "direct", idempotencyKey: key() };
    const bookingCases: Array<[string, Record<string, unknown>]> = [
      ["reference", { reference: "BK-1" }], ["nightlyRate", { nightlyRate: "1.00" }], ["roomTotal", { roomTotal: "1.00" }], ["status", { status: "checked_in" }], ["propertyId", { propertyId: 999 }], ["roomId", { roomId: 1 }],
      ["bad date", { checkInDate: "2033-02-30" }], ["guestsCount 0", { guestsCount: 0 }], ["unknown source", { source: "carrier_pigeon" }], ["missing idempotencyKey", { idempotencyKey: undefined }], ["short idempotencyKey", { idempotencyKey: "abc" }],
    ];
    for (const [label, patch] of bookingCases) {
      expectError(await call("POST", "/api/bookings", { token: fdToken, body: { ...goodBooking, ...patch } }), 400, "VALIDATION");
      record("T8", `create booking with ${label}`, "400 VALIDATION", "API validation (zod strict)");
    }
    const b = await fx.booking();
    const goodPay = { bookingId: b, method: "cash", amount: "100.00", idempotencyKey: key() };
    const payCases: Array<[string, Record<string, unknown>]> = [
      ["reference", { reference: "PAY-1" }], ["status", { status: "success" }], ["allocate to an invoice", { invoiceId: 1 }], ["negative amount", { amount: "-5.00" }], ["zero amount", { amount: "0.00" }],
      ["numeric amount", { amount: 100 }], ["three decimals", { amount: "1.001" }], ["unknown method", { method: "crypto" }], ["missing idempotencyKey", { idempotencyKey: undefined }],
    ];
    for (const [label, patch] of payCases) {
      expectError(await call("POST", "/api/payments", { token: fdToken, body: { ...goodPay, ...patch } }), 400, "VALIDATION");
      record("T8", `record payment with ${label}`, "400 VALIDATION", "API validation (zod strict)");
    }
    expectError(await call("POST", `/api/bookings/${b}/check-out`, { token: fdToken, body: { invoiceLines: [{ description: "x", unitPrice: "1.00" }] } }), 400, "VALIDATION");
    expectError(await call("POST", `/api/bookings/${b}/check-in`, { token: fdToken, body: {} }), 400, "VALIDATION");
    record("T8", "check-out with client-sent invoice lines", "400 VALIDATION", "API validation (zod strict)");
    expect(await fx.db("payments").where({ booking_id: b }).count({ n: "*" }).first()).toEqual({ n: 0 });
  });

  it("another property's booking, room type and guest are not found", async () => {
    const foreignBooking = await other.booking();
    const foreignGuest = other.guestId;
    expectError(await call("POST", "/api/payments", { token: fdToken, body: { bookingId: foreignBooking, method: "cash", amount: "10.00", idempotencyKey: key() } }), 404, "BOOKING_NOT_FOUND");
    expectError(await call("POST", `/api/bookings/${foreignBooking}/confirm`, { token: fdToken, body: {} }), 404, "BOOKING_NOT_FOUND");
    expectError(await call("GET", `/api/bookings/${foreignBooking}`, { token: fdToken }), 404, "BOOKING_NOT_FOUND");
    expectError(await call("GET", `/api/bookings/${foreignBooking}/free-rooms`, { token: fdToken }), 404, "BOOKING_NOT_FOUND");
    expectError(await call("POST", "/api/bookings", { token: fdToken, body: { guestId: foreignGuest, roomTypeId: fx.roomTypeId, checkInDate: "2034-01-01", checkOutDate: "2034-01-02", guestsCount: 1, source: "direct", idempotencyKey: key() } }), 404, "GUEST_NOT_FOUND");
    const ids = new Set((await call("GET", "/api/bookings", { token: fdToken })).body.map((x: { id: string }) => x.id));
    expect(ids.has(String(foreignBooking))).toBe(false);
    record("T8", "use another property's booking and guest", "404 on every route; lists never include them", "service (property scoping)");
  });
});

describe("the demo journey over HTTP", () => {
  it("guest → booking → confirm → advance → free rooms → check-in → check-out with server-built invoice", async () => {
    const t = fdToken;
    const guest = (await call("POST", "/api/guests", { token: t, body: { fullName: "Journey Guest", email: "journey@example.com", countryCode: "in" } }));
    expect(guest.status).toBe(201);
    const types = (await call("GET", "/api/room-types", { token: t })).body;
    expect(types[0]).toMatchObject({ code: "STD", name: "Standard", rate: 1000, capacity: 2 });

    const body = { guestId: guest.body.id, roomTypeId: types[0].id, checkInDate: "2035-03-01", checkOutDate: "2035-03-04", guestsCount: 2, source: "phone", idempotencyKey: key() };
    const created = await call("POST", "/api/bookings", { token: t, body });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "pending", total: 3000 });
    expect(created.body.reference).toMatch(new RegExp(`^BK${fx.tag}-\\d+$`));
    const id = created.body.id as string;

    expectError(await call("POST", `/api/bookings/${id}/check-in`, { token: t, body: { roomId: fx.roomIds[0] } }), 409, "INVALID_TRANSITION");
    record("T8", "check in a pending booking over HTTP", "409 INVALID_TRANSITION", "service");
    expect((await call("POST", `/api/bookings/${id}/confirm`, { token: t, body: {} })).body.status).toBe("confirmed");

    const pay = await call("POST", "/api/payments", { token: t, body: { bookingId: id, method: "cash", amount: "1000.00", idempotencyKey: key() } });
    expect(pay.status).toBe(201);
    expect(pay.body.reference).toMatch(new RegExp(`^PY${fx.tag}-\\d+$`));
    const detail = (await call("GET", `/api/bookings/${id}`, { token: t })).body;
    expect(detail).toMatchObject({ received: 1000, advanceHeld: 1000, balanceIsEstimate: true });
    expect(detail.balanceDue).toBe(2360); // 3000 + 12% GST − 1000 advance (D-D warning figure)

    const free = (await call("GET", `/api/bookings/${id}/free-rooms`, { token: t })).body;
    expect(free.length).toBeGreaterThan(0);
    const roomId = free[0].id as string;
    expect((await call("POST", `/api/bookings/${id}/check-in`, { token: t, body: { roomId } })).body.status).toBe("checked_in");
    expect((await call("GET", "/api/rooms", { token: t })).body.find((r: { id: string }) => r.id === roomId)).toMatchObject({ status: "occupied" });
    expect((await call("GET", `/api/bookings/${id}/free-rooms`, { token: t })).body.map((r: { id: string }) => r.id)).not.toContain(roomId);

    const out = await call("POST", `/api/bookings/${id}/check-out`, { token: t, body: {} });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: "checked_out", invoice: { amount: 3360, balanceDue: 2360 } });
    expect(out.body.invoice.number).toMatch(new RegExp(`^IT/${fx.tag}/\\d{4}-\\d{2}/\\d{5}$`));
    expectError(await call("POST", `/api/bookings/${id}/check-out`, { token: t, body: {} }), 409, "INVALID_TRANSITION");

    expect((await call("GET", "/api/rooms", { token: t })).body.find((r: { id: string }) => r.id === roomId)).toMatchObject({ status: "available", housekeeping: "dirty" });
    const invoices = (await call("GET", "/api/invoices", { token: t })).body;
    expect(invoices.find((i: { id: string }) => i.id === out.body.invoice.id)).toMatchObject({ amount: 3360, tax: 360, status: "partial", balanceDue: 2360 });
    const pays = (await call("GET", "/api/payments", { token: t })).body;
    expect(pays.find((p: { id: string }) => p.id === pay.body.id)).toMatchObject({ invoiceNumber: out.body.invoice.number, amount: 1000 });
    const after = (await call("GET", `/api/bookings/${id}`, { token: t })).body;
    expect(after).toMatchObject({ balanceDue: 2360, balanceIsEstimate: false, advanceHeld: 0 });
    const rev = (await call("GET", "/api/dashboard", { token: adminToken })).body.stats.revenueToday;
    expect(rev).toBeGreaterThanOrEqual(3000);
    record("T8", "full journey over HTTP (3 nights × 1000, 1000 advance)", "invoice 3360 issued at checkout, 2360 due, room available + dirty", "service via API");
  });

  it("walk-in is created confirmed; duplicate submits create one record", async () => {
    const guest = (await call("POST", "/api/guests", { token: fdToken, body: { fullName: "Walk In" } })).body.id;
    const k = key();
    const body = { guestId: guest, roomTypeId: fx.roomTypeId, checkInDate: "2036-05-01", checkOutDate: "2036-05-02", guestsCount: 1, source: "walk_in", idempotencyKey: k };
    const replies = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/api/bookings", { token: fdToken, body })));
    expect(replies.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(replies.map((r) => r.body.id)).size).toBe(1);
    expect(replies[0]!.body.status).toBe("confirmed");
    record("T8", "6 parallel identical booking requests (walk-in)", "1 booking, created confirmed", "service replay + uq_bookings_idempotency");

    const bookingId = replies[0]!.body.id;
    const pk = key();
    const payBody = { bookingId, method: "card", amount: "250.00", idempotencyKey: pk };
    const pays = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/api/payments", { token: fdToken, body: payBody })));
    expect(pays.every((r) => r.status === 201)).toBe(true);
    expect(new Set(pays.map((r) => r.body.id)).size).toBe(1);
    expect(await fx.db("payments").where({ booking_id: bookingId }).count({ n: "*" }).first()).toEqual({ n: 1 });
    record("T8", "6 parallel identical payment requests", "1 payment recorded", "service replay + uq_payments_idempotency");
    expectError(await call("POST", "/api/payments", { token: fdToken, body: { ...payBody, amount: "999.00" } }), 409, "IDEMPOTENCY_CONFLICT");
    record("T8", "same payment key, different amount", "409 IDEMPOTENCY_CONFLICT", "service");
  });
});
