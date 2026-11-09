/**
 * Gate 3b T7: read-only regression of the seeded demo figures the demo journey shows.
 * Pinned values were checked by hand against the seed stories (seed-demo.ts) and the domain rules:
 * net = nights × snapshot rate, GST 12% per component, gross = net + tax, advances are liabilities.
 * Reads only; never writes to the demo property.
 */
import type { Knex } from "knex";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db/knex.js";
import { percentOf, toMinor } from "../domain/money.js";
import { invariantViolations } from "./harness.js";

let db: Knex;
let propertyId: number;
const m = (v: unknown): bigint => toMinor(String(v));

beforeAll(async () => {
  db = createDb("app");
  const p = await db("properties").where({ code: process.env["HOTEL_SLUG"] || "demo-hotel" }).first("id");
  if (!p) throw new Error("Demo property not found: run the seed first");
  propertyId = p.id as number;
});
afterAll(async () => {
  await db?.destroy();
});

// [invoice number, booking, status, net, tax, gross, allocated, balance due, payment status]
const INVOICES: Array<[string, string, string, string, string, string, string, string, string]> = [
  ["INV/2026-27/00001", "BK-10430", "issued", "12600.00", "1512.00", "14112.00", "14112.00", "0.00", "paid"],
  ["INV/2026-27/00002", "BK-10429", "issued", "15600.00", "1872.00", "17472.00", "8736.00", "8736.00", "partial"],
  ["INV/2026-27/00003", "BK-10428", "issued", "5200.00", "624.00", "5824.00", "0.00", "5824.00", "unpaid"],
  ["INV/2026-27/00004", "BK-10427", "issued", "16800.00", "2016.00", "18816.00", "17816.00", "1000.00", "partial"],
  ["INV/2026-27/00005", "BK-10426", "void", "5200.00", "624.00", "5824.00", "0.00", "0.00", "void"],
  ["INV/2026-27/00006", "BK-10426", "issued", "5200.00", "624.00", "5824.00", "5824.00", "0.00", "paid"],
  ["INV/2026-27/00007", "BK-10415", "issued", "7800.00", "936.00", "8736.00", "8736.00", "0.00", "paid"],
];
// [booking, status, room_total, received_net, advance_held, invoice balance due]
const BOOKINGS: Array<[string, string, string, string, string, string]> = [
  ["BK-10415", "checked_out", "7800.00", "8736.00", "0.00", "0.00"],
  ["BK-10416", "cancelled", "8400.00", "4200.00", "4200.00", "0.00"],
  ["BK-10417", "cancelled", "15600.00", "0.00", "0.00", "0.00"],
  ["BK-10418", "pending", "7800.00", "0.00", "0.00", "0.00"],
  ["BK-10419", "confirmed", "8400.00", "0.00", "0.00", "0.00"],
  ["BK-10420", "pending", "2600.00", "0.00", "0.00", "0.00"],
  ["BK-10421", "confirmed", "23400.00", "7800.00", "7800.00", "0.00"],
  ["BK-10422", "confirmed", "8400.00", "0.00", "0.00", "0.00"],
  ["BK-10423", "checked_in", "5200.00", "0.00", "0.00", "0.00"],
  ["BK-10424", "checked_in", "12600.00", "0.00", "0.00", "0.00"],
  ["BK-10425", "checked_in", "31200.00", "5000.00", "5000.00", "0.00"],
  ["BK-10426", "checked_out", "5200.00", "5824.00", "0.00", "0.00"],
  ["BK-10427", "checked_out", "16800.00", "17816.00", "0.00", "1000.00"],
  ["BK-10428", "checked_out", "5200.00", "0.00", "0.00", "5824.00"],
  ["BK-10429", "checked_out", "15600.00", "8736.00", "0.00", "8736.00"],
  ["BK-10430", "checked_out", "12600.00", "14112.00", "0.00", "0.00"],
];

describe("T7 seeded demo figures", () => {
  it("invoices: numbers, amounts, allocation and payment status", async () => {
    const rows = await db("v_invoice_balance as v").join("bookings as b", "b.id", "v.booking_id").where("v.property_id", propertyId).orderBy("v.invoice_number")
      .select("v.invoice_number", "b.reference", "v.status", "v.net_amount", "v.tax_amount", "v.gross_amount", "v.allocated_amount", "v.balance_due", "v.payment_status");
    // Compare money as minor units, so the T6 format fix (void balance_due '0' → '0.00') doesn't break this test.
    expect(rows.map((r) => [r.invoice_number, r.reference, r.status, ...[r.net_amount, r.tax_amount, r.gross_amount, r.allocated_amount, r.balance_due].map(m), r.payment_status]))
      .toEqual(INVOICES.map(([n, ref, s, net, tax, gross, alloc, due, ps]) => [n, ref, s, ...[net, tax, gross, alloc, due].map(m), ps]));
    expect((await db("number_sequences").where({ property_id: propertyId, document_type: "invoice" }).first("next_value")).next_value).toBe(8);
  });

  it("T6 (migration 011): balance_due is a 2-decimal value on every row, '0.00' for the void invoice", async () => {
    const rows = await db("v_invoice_balance").where({ property_id: propertyId }).select("invoice_number", "status", "balance_due");
    for (const r of rows) expect(String(r.balance_due), r.invoice_number).toMatch(/^\d+\.\d{2}$/);
    expect(rows.find((r) => r.status === "void")?.balance_due).toBe("0.00");
  });

  it("tax snapshots: one GST 12% line per invoice, base = net, amount = 12% of net", async () => {
    const lines = await db("invoice_tax_lines as t").join("invoices as i", "i.id", "t.invoice_id").where("i.property_id", propertyId).orderBy("i.invoice_number")
      .select("i.invoice_number", "i.net_amount", "i.tax_amount", "t.component_code", "t.rate_percent", "t.taxable_base", "t.tax_amount as line_tax");
    expect(lines).toHaveLength(7);
    for (const l of lines) {
      expect([l.component_code, l.rate_percent]).toEqual(["GST", "12.0000"]);
      expect(m(l.taxable_base)).toBe(m(l.net_amount));
      expect(m(l.line_tax)).toBe(percentOf(m(l.net_amount), "12.0000"));
      expect(m(l.line_tax)).toBe(m(l.tax_amount));
    }
  });

  it("bookings: totals, net received, advances and balance due", async () => {
    const rows = await db("v_booking_balance as v").join("bookings as b", "b.id", "v.booking_id").where("v.property_id", propertyId).orderBy("b.reference")
      .select("b.reference", "b.status", "v.room_total", "v.received_net", "v.advance_held", "v.invoice_balance_due", "b.nightly_rate", "b.check_in_date", "b.check_out_date");
    expect(rows.map((r) => [r.reference, r.status, ...[r.room_total, r.received_net, r.advance_held, r.invoice_balance_due].map(m)]))
      .toEqual(BOOKINGS.map(([ref, s, total, rec, adv, due]) => [ref, s, ...[total, rec, adv, due].map(m)]));
    for (const r of rows) {
      const nights = (Date.parse(`${r.check_out_date}T00:00:00Z`) - Date.parse(`${r.check_in_date}T00:00:00Z`)) / 86_400_000;
      expect(m(r.room_total), r.reference).toBe(m(r.nightly_rate) * BigInt(nights));
    }
    expect(m((await db("v_advances_held").where({ property_id: propertyId }).first("advances_held")).advances_held)).toBe(m("17000.00"));
  });

  it("rooms: 33 available, 3 occupied (the 3 in-house bookings), 4 maintenance", async () => {
    const statusRows = (await db("v_room_status").where({ property_id: propertyId }).select("status").count({ n: "*" }).groupBy("status")) as unknown as Array<{ status: string; n: number }>;
    const counts = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)]));
    expect(counts).toEqual({ available: 33, occupied: 3, maintenance: 4 });
    const occupiedBy = await db("v_room_status as v").join("bookings as b", "b.id", "v.current_booking_id").where("v.property_id", propertyId).orderBy("b.reference").pluck("b.reference");
    expect(occupiedBy).toEqual(["BK-10423", "BK-10424", "BK-10425"]);
  });

  it("the independent invariant check finds no violation in the demo data", async () => {
    expect(await invariantViolations(db, propertyId)).toEqual([]);
  });
});
