/**
 * Clears operational demo data for one property; keeps users/staff/tax; restores exactly 10 rooms.
 * Must run with the migrator DB role (DELETE is not granted to the app user).
 */
import type { Knex } from "knex";
import { financialYear } from "../domain/dates.js";
import { insertId } from "../services/context.js";

const TZ = "Asia/Kolkata";

/**
 * Demo is single-property. Append-only triggers block row DELETE on money tables, so we TRUNCATE
 * (DDL; does not fire those triggers), then recreate the 10-room inventory.
 */
async function clearProperty(db: Knex, propertyId: number): Promise<void> {
  await db.raw("SET FOREIGN_KEY_CHECKS=0");
  try {
    for (const table of [
      "allocation_releases",
      "payment_allocations",
      "refunds",
      "invoice_tax_lines",
      "invoice_lines",
      "invoices",
      "payments",
      "bookings",
      "guests",
      "audit_events",
      "rooms",
    ]) {
      await db.raw(`TRUNCATE TABLE ${table}`);
    }
    await db("room_types").where({ property_id: propertyId }).whereNotIn("code", ["NRM", "AC"]).del();
  } finally {
    await db.raw("SET FOREIGN_KEY_CHECKS=1");
  }
}

async function ensureTenRooms(db: Knex, propertyId: number): Promise<void> {
  const types = [
    { code: "NRM", name: "Normal", base_rate: "2500.00", capacity: 4 },
    { code: "AC", name: "AC", base_rate: "3500.00", capacity: 4 },
  ];
  const typeIds: Record<string, number> = {};
  for (const t of types) {
    const existing = await db("room_types").where({ property_id: propertyId, code: t.code }).first("id");
    if (existing) typeIds[t.code] = existing.id as number;
    else typeIds[t.code] = await insertId(db("room_types").insert({ property_id: propertyId, ...t, is_active: true }));
  }
  for (let i = 1; i <= 5; i++) {
    await db("rooms").insert({
      property_id: propertyId, number: `10${i}`, room_type_id: typeIds["NRM"], floor: 1,
      is_out_of_service: false, housekeeping_status: "clean",
    });
    await db("rooms").insert({
      property_id: propertyId, number: `20${i}`, room_type_id: typeIds["AC"], floor: 2,
      is_out_of_service: false, housekeeping_status: "clean",
    });
  }
}

async function resetSequences(db: Knex, propertyId: number): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const series = financialYear(today);
  const rows: Array<{ document_type: string; series: string; prefix: string; next_value: number }> = [
    { document_type: "invoice", series, prefix: `INV/${series}/`, next_value: 1 },
    { document_type: "booking", series: "BK", prefix: "BK-", next_value: 1 },
    { document_type: "payment", series: "PAY", prefix: "PAY-", next_value: 1 },
    { document_type: "refund", series: "RF", prefix: "RF-", next_value: 1 },
  ];
  for (const r of rows) {
    const existing = await db("number_sequences").where({ property_id: propertyId, document_type: r.document_type, series: r.series }).first("id");
    if (existing) await db("number_sequences").where({ id: existing.id }).update({ next_value: 1, prefix: r.prefix });
    else await db("number_sequences").insert({ property_id: propertyId, ...r });
  }
}

export async function clearDemoData(db: Knex, propertyCode: string): Promise<{ propertyId: number; rooms: number }> {
  const property = await db("properties").where({ code: propertyCode }).first("id");
  if (!property) throw new Error(`Property "${propertyCode}" not found`);
  const propertyId = property.id as number;
  await clearProperty(db, propertyId);
  await ensureTenRooms(db, propertyId);
  await resetSequences(db, propertyId);
  const rooms = Number((await db("rooms").where({ property_id: propertyId }).count({ n: "*" }))[0]?.n ?? 0);
  return { propertyId, rooms };
}
