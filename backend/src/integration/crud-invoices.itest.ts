/**
 * Invoice detail GET + admin void. Issued amounts are never edited; the number stays forever.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueInvoice } from "../services/finance.js";
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

async function stayInvoice(): Promise<number> {
  const bookingId = await fx.booking();
  const { invoiceId } = await issueInvoice(fx.db, fx.actor, {
    bookingId,
    invoiceType: "stay",
    issueDate: "2031-07-01",
    series: fx.series,
    lines: [{ description: "Deluxe room, 1 night(s)", quantity: "1.00", unitPrice: "2500.00" }],
  });
  return invoiceId;
}

describe("invoices", () => {
  it("GET detail returns immutable lines and tax snapshot", async () => {
    const invoiceId = await stayInvoice();
    const r = await api.call("GET", `/api/invoices/${invoiceId}`, { token: desk });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(String(invoiceId));
    expect(r.body.documentStatus).toBe("issued");
    expect(r.body.voidReason).toBeNull();
    expect(r.body.lines.length).toBeGreaterThan(0);
    expect(r.body.lines[0].description).toContain("Deluxe");
    expect(r.body.amount).toBeGreaterThan(0);
    expect(Array.isArray(r.body.taxLines)).toBe(true);
    record("Invoices", "GET detail with lines+tax", "200 with snapshot", "reads");
  });

  it("front_desk cannot void", async () => {
    const invoiceId = await stayInvoice();
    api.expectError(
      await api.call("POST", `/api/invoices/${invoiceId}/void`, { token: desk, body: { reason: "Mistake" } }),
      403,
      "FORBIDDEN",
    );
    record("Invoices", "front_desk void", "403 FORBIDDEN", "requireRole(admin)");
  });

  it("admin voids; detail shows void reason; second void refused", async () => {
    const invoiceId = await stayInvoice();
    const voided = await api.call("POST", `/api/invoices/${invoiceId}/void`, {
      token: admin,
      body: { reason: "Duplicate issue" },
    });
    expect(voided.status).toBe(200);
    expect(voided.body).toEqual({ id: String(invoiceId), status: "void" });

    const detail = await api.call("GET", `/api/invoices/${invoiceId}`, { token: admin });
    expect(detail.status).toBe(200);
    expect(detail.body.documentStatus).toBe("void");
    expect(detail.body.voidReason).toBe("Duplicate issue");
    expect(detail.body.status).toBe("void");

    const list = await api.call("GET", "/api/invoices", { token: admin });
    expect(list.body.find((i: { id: string }) => i.id === String(invoiceId))?.status).toBe("void");

    api.expectError(
      await api.call("POST", `/api/invoices/${invoiceId}/void`, { token: admin, body: { reason: "Again" } }),
      422,
      "INVOICE_VOID",
    );
    record("Invoices", "admin void + detail + refuse re-void", "void kept number; second void 422", "service+API");
  });

  it("void requires a reason", async () => {
    const invoiceId = await stayInvoice();
    api.expectError(
      await api.call("POST", `/api/invoices/${invoiceId}/void`, { token: admin, body: { reason: "   " } }),
      400,
      "VALIDATION",
    );
    record("Invoices", "void empty reason", "400 VALIDATION", "zod");
  });
});
