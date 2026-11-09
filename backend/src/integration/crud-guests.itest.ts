/**
 * CRUD increment 1: Guests. Create, read, update, invalid input, unauthenticated, cross-property, audit.
 * There is no delete (Q27): the DB also refuses it (no DELETE grant), which is asserted here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApi, type Api } from "./api-client.js";
import { createFixture, printReport, record, refusal, type Fixture } from "./harness.js";

let fx: Fixture;
let other: Fixture;
let api: Api;
let fd: string;

beforeAll(async () => {
  fx = await createFixture();
  other = await createFixture();
  api = await startApi(fx);
  fd = await api.tokenFor("front_desk");
});
afterAll(async () => {
  printReport();
  await api?.close();
  await fx?.db.destroy();
  await other?.db.destroy();
});

const patch = (id: string | number, body: unknown, token = fd) => api.call("PATCH", `/api/guests/${id}`, { token, body });

describe("guests", () => {
  it("create, read and update", async () => {
    const created = await api.call("POST", "/api/guests", { token: fd, body: { fullName: "Asha Verma", email: "asha@example.com", phone: "+91 98000 00001", countryCode: "in" } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const find = async () => (await api.call("GET", "/api/guests", { token: fd })).body.find((g: { id: string }) => g.id === id);
    expect(await find()).toMatchObject({ name: "Asha Verma", email: "asha@example.com", phone: "+91 98000 00001", country: "India", vip: false, stays: 0 });
    record("Guests", "create + read", "created, listed with country name", "API");

    expect((await patch(id, { fullName: "Asha V. Verma", phone: "+91 98000 00002" })).status).toBe(200);
    expect(await find()).toMatchObject({ name: "Asha V. Verma", phone: "+91 98000 00002", email: "asha@example.com" });
    expect((await patch(id, { countryCode: "sg", email: "" })).status).toBe(200);
    expect(await find()).toMatchObject({ country: "Singapore", email: "" });
    record("Guests", "update (partial, country, clear email)", "saved, untouched fields kept", "service");
  });

  it("refuses invalid input", async () => {
    const id = (await api.call("POST", "/api/guests", { token: fd, body: { fullName: "Valid Name" } })).body.id as string;
    const cases: Array<[string, unknown]> = [
      ["empty body", {}], ["blank name", { fullName: "   " }], ["name too long", { fullName: "x".repeat(161) }], ["bad email", { email: "not-an-email" }],
      ["bad country", { countryCode: "IND" }], ["vip flag", { isVip: true }], ["property id", { propertyId: 99 }], ["id", { id: 5 }],
    ];
    for (const [label, body] of cases) {
      api.expectError(await patch(id, body), 400, "VALIDATION");
      record("Guests", `update with ${label}`, "400 VALIDATION", "API validation (zod strict)");
    }
    api.expectError(await api.call("POST", "/api/guests", { token: fd, body: { fullName: "" } }), 400, "VALIDATION");
    const g = (await api.call("GET", "/api/guests", { token: fd })).body.find((x: { id: string }) => x.id === id);
    expect(g).toMatchObject({ name: "Valid Name", vip: false });
  });

  it("needs a session, and another property's guest is not found", async () => {
    const id = (await api.call("POST", "/api/guests", { token: fd, body: { fullName: "Own Guest" } })).body.id as string;
    api.expectError(await api.call("PATCH", `/api/guests/${id}`, { body: { fullName: "x" } }), 401, "UNAUTHORIZED");
    api.expectError(await patch(other.guestId, { fullName: "Hijack" }), 404, "GUEST_NOT_FOUND");
    api.expectError(await patch("abc", { fullName: "x" }), 404, "NOT_FOUND");
    expect((await other.db("guests").where({ id: other.guestId }).first("full_name")).full_name).toBe("Test Guest");
    record("Guests", "update without token / another property's guest", "401 / 404, data unchanged", "API auth, service property scope");
  });

  it("audits the change without personal data, and cannot be deleted", async () => {
    const id = (await api.call("POST", "/api/guests", { token: fd, body: { fullName: "Audit Me", email: "audit.me@example.com" } })).body.id as string;
    await patch(id, { fullName: "Audit Me Too", email: "audit.me.too@example.com" });
    const rows = await fx.db("audit_events").where({ property_id: fx.actor.propertyId, entity_type: "guest", entity_id: Number(id) }).orderBy("id").select("action", "details");
    expect(rows.map((r) => r.action)).toEqual(["create", "update"]);
    const text = JSON.stringify(rows);
    expect(text).toContain("full_name,email");
    expect(text).not.toMatch(/Audit Me|audit\.me/);
    record("Guests", "audit of an update", "action + changed field names only, no personal data", "service");
    const del = await refusal(fx.db("guests").where({ id: Number(id) }).delete());
    expect(del.boundary).toBe("grant");
    record("Guests", "direct DELETE of a guest (app user)", "refused", `${del.boundary}: ${del.code}`);
  });
});
