/**
 * Admin property settings update with audit (Q29). Currency/timezone/tax not accepted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApi, type Api } from "./api-client.js";
import { createFixture, printReport, record, type Fixture } from "./harness.js";

let fx: Fixture;
let api: Api;
let admin: string;
let desk: string;

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

describe("settings", () => {
  it("front_desk cannot read or patch settings", async () => {
    api.expectError(await api.call("GET", "/api/settings", { token: desk }), 403, "FORBIDDEN");
    api.expectError(
      await api.call("PATCH", "/api/settings", { token: desk, body: { name: "Nope" } }),
      403,
      "FORBIDDEN",
    );
    record("Settings", "front_desk read+patch", "403 FORBIDDEN", "requireRole(admin)");
  });

  it("admin updates property fields; GET reflects them; audit has old/new", async () => {
    const before = await api.call("GET", "/api/settings", { token: admin });
    expect(before.status).toBe(200);
    const prevName = before.body.property.name as string;

    const patched = await api.call("PATCH", "/api/settings", {
      token: admin,
      body: {
        name: "Updated StayDesk Inn",
        address: "12 Test Lane",
        phone: "+91 90000 00000",
        email: "desk@example.com",
        checkInTime: "15:00",
        checkOutTime: "10:30",
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({ ok: true });

    const after = await api.call("GET", "/api/settings", { token: admin });
    expect(after.body.property).toMatchObject({
      name: "Updated StayDesk Inn",
      address: "12 Test Lane",
      phone: "+91 90000 00000",
      email: "desk@example.com",
      checkInTime: "15:00",
      checkOutTime: "10:30",
      currency: before.body.property.currency,
      timezone: before.body.property.timezone,
    });

    const audit = await fx.db("audit_events")
      .where({ property_id: fx.actor.propertyId, entity_type: "property", action: "update" })
      .orderBy("id", "desc")
      .first("details");
    expect(audit).toBeTruthy();
    const details = typeof audit.details === "string" ? JSON.parse(audit.details) : audit.details;
    expect(details.name_from).toBe(prevName);
    expect(details.name_to).toBe("Updated StayDesk Inn");
    expect(details.check_in_to).toBe("15:00");
    expect(String(details.fields)).toContain("name");

    record("Settings", "admin patch + audit old/new", "GET updated; audit details", "service+API");
  });

  it("rejects currency/timezone in the body and empty patch", async () => {
    api.expectError(
      await api.call("PATCH", "/api/settings", { token: admin, body: { currency: "USD" } }),
      400,
      "VALIDATION",
    );
    api.expectError(
      await api.call("PATCH", "/api/settings", { token: admin, body: { timezone: "UTC" } }),
      400,
      "VALIDATION",
    );
    api.expectError(await api.call("PATCH", "/api/settings", { token: admin, body: {} }), 400, "VALIDATION");
    record("Settings", "reject currency/timezone/empty", "400 VALIDATION", "zod.strict");
  });

  it("noop identical values is NOTHING_TO_CHANGE", async () => {
    const cur = await api.call("GET", "/api/settings", { token: admin });
    api.expectError(
      await api.call("PATCH", "/api/settings", {
        token: admin,
        body: { name: cur.body.property.name },
      }),
      400,
      "NOTHING_TO_CHANGE",
    );
    record("Settings", "identical patch", "400 NOTHING_TO_CHANGE", "service");
  });
});
