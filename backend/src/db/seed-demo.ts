/**
 * Demo seed (DATABASE.md §7). Run explicitly: `npm run db:seed:demo`. It is never run on start.
 *  - Refuses to run when NODE_ENV=production.
 *  - Idempotent: every row is found by a stable natural key and left untouched if it exists, so
 *    re-running never duplicates or overwrites edited records.
 *  - Bookings and all money go through the same services the API will use. Each booking scenario is
 *    one transaction: it is either seeded completely or not at all.
 *  - Runs as the restricted app DB user, which also proves the grants are sufficient.
 *  - Demo logins come from .env (DEMO_*). A user whose variables are missing is skipped.
 * Values here (rates, 12% GST, names) are DEMO DATA, not business configuration (G11, Q6).
 */
import bcrypt from "bcryptjs";
import type { Knex } from "knex";
import { createDb } from "./knex.js";
import { cancelBooking, checkIn, checkOut, createBooking, type BookingSource } from "../services/bookings.js";
import { completeRefund, issueInvoice, recordPayment, requestRefund, settlePayment, voidInvoice } from "../services/finance.js";
import { insertId, type Actor } from "../services/context.js";
import { fromMinor, toMinor } from "../domain/money.js";
import { financialYear } from "../domain/dates.js";

const TZ = "Asia/Kolkata";
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** A moment on a business date (noon UTC), for historical check-in/out and payment times. */
const at = (date: string) => new Date(`${date}T12:00:00Z`);

let created = 0;
let kept = 0;
async function ensure(trx: Knex.Transaction, table: string, key: Record<string, unknown>, row: Record<string, unknown>): Promise<number> {
  const existing = await trx(table).where(key).first("id");
  if (existing) {
    kept++;
    return existing.id as number;
  }
  created++;
  return insertId(trx(table).insert({ ...key, ...row }));
}

// ---------- reference data ----------

const ROOM_TYPES = [
  { code: "STD", name: "Standard", base_rate: "2600.00", capacity: 2 },
  { code: "DLX", name: "Deluxe", base_rate: "4200.00", capacity: 3 },
  { code: "STE", name: "Suite", base_rate: "7800.00", capacity: 4 },
] as const;

const STAFF = [
  { full_name: "Front Desk", email: "frontdesk@example.com", job_title: "Receptionist", is_active: true },
  { full_name: "Lakshmi P", email: "lakshmi@example.com", job_title: "Manager", is_active: true },
  { full_name: "Vijay K", email: "vijay@example.com", job_title: "Housekeeping", is_active: true },
  { full_name: "Neha G", email: "neha@example.com", job_title: "Accounts", is_active: false },
];

const USERS = [
  { env: "DEMO_FRONT_DESK", role: "front_desk", staffEmail: "frontdesk@example.com" },
  { env: "DEMO_ADMIN", role: "admin", staffEmail: "lakshmi@example.com" },
  { env: "DEMO_SUPER_ADMIN", role: "super_admin", staffEmail: null },
] as const;

const GUESTS: Array<[name: string, country: string]> = [
  ["Ananya Rao", "IN"], ["Michael Chen", "SG"], ["Priya Nair", "IN"], ["Lucas Martin", "FR"], ["Sara Ibrahim", "AE"], ["Rahul Verma", "IN"],
  ["Emma Wilson", "GB"], ["Karthik S", "IN"], ["Olivia Brown", "US"], ["Arjun Mehta", "IN"], ["Fatima Khan", "IN"], ["David Lee", "KR"],
  ["Meera Iyer", "IN"], ["Tom Becker", "DE"], ["Divya Menon", "IN"], ["Hiro Tanaka", "JP"],
];

// ---------- booking scenarios: one consistent story per booking (fixes G5) ----------

type Kind =
  | "past_paid" | "past_partial" | "past_unpaid" | "past_refund" | "past_void_reissue"
  | "in_house" | "in_house_advance" | "in_house_pending_payment"
  | "arriving" | "arriving_advance" | "arriving_pending" | "future_confirmed" | "future_pending_failed_payment"
  | "cancelled_unpaid" | "cancelled_paid";

interface Scenario { ref: string; guest: number; type: "STD" | "DLX" | "STE"; inOffset: number; nights: number; guests: number; source: BookingSource; kind: Kind }

const SCENARIOS: Scenario[] = [
  { ref: "BK-10430", guest: 0, type: "DLX", inOffset: -6, nights: 3, guests: 2, source: "direct", kind: "past_paid" },
  { ref: "BK-10429", guest: 1, type: "STE", inOffset: -5, nights: 2, guests: 3, source: "booking_com", kind: "past_partial" },
  { ref: "BK-10428", guest: 2, type: "STD", inOffset: -4, nights: 2, guests: 1, source: "expedia", kind: "past_unpaid" },
  { ref: "BK-10427", guest: 3, type: "DLX", inOffset: -7, nights: 4, guests: 2, source: "walk_in", kind: "past_refund" },
  { ref: "BK-10426", guest: 4, type: "STD", inOffset: -3, nights: 2, guests: 2, source: "phone", kind: "past_void_reissue" },
  { ref: "BK-10425", guest: 5, type: "STE", inOffset: -2, nights: 4, guests: 4, source: "direct", kind: "in_house_advance" },
  { ref: "BK-10424", guest: 6, type: "DLX", inOffset: -1, nights: 3, guests: 2, source: "booking_com", kind: "in_house" },
  { ref: "BK-10423", guest: 7, type: "STD", inOffset: -2, nights: 2, guests: 1, source: "expedia", kind: "in_house_pending_payment" },
  { ref: "BK-10422", guest: 8, type: "DLX", inOffset: 0, nights: 2, guests: 2, source: "walk_in", kind: "arriving" },
  { ref: "BK-10421", guest: 9, type: "STE", inOffset: 0, nights: 3, guests: 3, source: "phone", kind: "arriving_advance" },
  { ref: "BK-10420", guest: 10, type: "STD", inOffset: 0, nights: 1, guests: 2, source: "direct", kind: "arriving_pending" },
  { ref: "BK-10419", guest: 11, type: "DLX", inOffset: 3, nights: 2, guests: 2, source: "booking_com", kind: "future_confirmed" },
  { ref: "BK-10418", guest: 12, type: "STD", inOffset: 5, nights: 3, guests: 1, source: "expedia", kind: "future_pending_failed_payment" },
  { ref: "BK-10417", guest: 13, type: "STE", inOffset: 7, nights: 2, guests: 2, source: "phone", kind: "cancelled_unpaid" },
  { ref: "BK-10416", guest: 14, type: "DLX", inOffset: 4, nights: 2, guests: 2, source: "direct", kind: "cancelled_paid" },
  { ref: "BK-10415", guest: 15, type: "STD", inOffset: -9, nights: 3, guests: 2, source: "walk_in", kind: "past_paid" },
];

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") throw new Error("The demo seed refuses to run when NODE_ENV=production.");
  const base = process.env["SEED_BASE_DATE"] || todayIn(TZ);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) throw new Error("SEED_BASE_DATE must be YYYY-MM-DD");
  const series = financialYear(base);

  const db = createDb("app");
  try {
    // 1. Reference data, in one transaction.
    const ref = await db.transaction(async (trx) => {
      const propertyId = await ensure(trx, "properties", { code: process.env["HOTEL_SLUG"] || "demo-hotel" }, {
        name: "Sample Property", address: "12 Beach Road, Chennai 600001", phone: "+91 44 2345 6789", email: "frontdesk@example.com",
        country_code: "IN", currency: "INR", timezone: TZ, check_in_time: "14:00:00", check_out_time: "11:00:00",
      });
      for (const applies of ["room", "penalty"] as const) {
        await ensure(trx, "tax_components", { property_id: propertyId, code: "GST", applies_to: applies, effective_from: "2017-07-01" }, { name: "GST", rate_percent: "12.0000", apply_order: 1 });
      }
      await ensure(trx, "number_sequences", { property_id: propertyId, document_type: "invoice", series }, { prefix: `INV/${series}/`, next_value: 1 });

      const typeIds: Record<string, number> = {};
      for (const t of ROOM_TYPES) typeIds[t.code] = await ensure(trx, "room_types", { property_id: propertyId, code: t.code }, { name: t.name, base_rate: t.base_rate, capacity: t.capacity });

      const roomsByType: Record<string, number[]> = { STD: [], DLX: [], STE: [] };
      for (const floor of [1, 2, 3, 4]) {
        for (let i = 0; i < 10; i++) {
          const code = ROOM_TYPES[(i + floor) % 3]!.code;
          const outOfService = (i + floor * 3) % 10 === 6; // same rooms as the old mock's "maintenance"
          const id = await ensure(trx, "rooms", { property_id: propertyId, number: `${floor}${pad(i + 1)}` }, {
            room_type_id: typeIds[code], floor, is_out_of_service: outOfService, housekeeping_status: (["clean", "clean", "dirty", "inspecting"] as const)[i % 4],
          });
          if (!outOfService) roomsByType[code]!.push(id);
        }
      }

      const staffIds: Record<string, number> = {};
      for (const s of STAFF) staffIds[s.email] = await ensure(trx, "staff_members", { property_id: propertyId, email: s.email }, { full_name: s.full_name, job_title: s.job_title, is_active: s.is_active });

      for (const u of USERS) {
        const username = process.env[`${u.env}_USERNAME`];
        const password = process.env[`${u.env}_PASSWORD`];
        if (!username || !password) {
          console.warn(`Skipping ${u.role} demo login: ${u.env}_USERNAME / ${u.env}_PASSWORD not set.`);
          continue;
        }
        const exists = await trx("user_accounts").where({ property_id: propertyId, username }).first("id");
        if (exists) { kept++; continue; }
        await ensure(trx, "user_accounts", { property_id: propertyId, username }, {
          password_hash: await bcrypt.hash(password, 12), role: u.role, staff_member_id: u.staffEmail ? staffIds[u.staffEmail] : null, is_active: true,
        });
      }

      const guestIds: number[] = [];
      for (const [i, [name, country]] of GUESTS.entries()) {
        const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
        guestIds.push(await ensure(trx, "guests", { property_id: propertyId, email }, {
          full_name: name, phone: `+91 98${String(40000000 + i * 137911).slice(0, 8)}`, country_code: country, is_vip: i % 6 === 0,
        }));
      }
      return { propertyId, typeIds, roomsByType, guestIds };
    });

    const actor: Actor = { propertyId: ref.propertyId, userId: null };
    const nextRoom: Record<string, number> = { STD: 0, DLX: 0, STE: 0 };
    let payNo = 0;
    let refundNo = 0;

    // 2. One transaction per booking scenario (services nest as savepoints).
    for (const [idx, s] of SCENARIOS.entries()) {
      const roomId = ref.roomsByType[s.type]![nextRoom[s.type]!++];
      if (roomId === undefined) throw new Error(`Not enough ${s.type} rooms for the demo scenarios`);
      const payRef = () => `PAY-${55010 + idx * 3 + payNo++ % 3}`;
      payNo = 0;
      const exists = await db("bookings").where({ property_id: ref.propertyId, reference: s.ref }).first("id");
      if (exists) { kept++; continue; }

      await db.transaction(async (trx) => {
        const checkInDate = addDays(base, s.inOffset);
        const checkOutDate = addDays(checkInDate, s.nights);
        const isPast = s.kind.startsWith("past_");
        const isInHouse = s.kind.startsWith("in_house");
        const assignRoom = s.kind !== "future_confirmed" && s.kind !== "future_pending_failed_payment" && s.kind !== "arriving_pending";
        const bookingId = await createBooking(trx, actor, {
          reference: s.ref, guestId: ref.guestIds[s.guest]!, roomTypeId: ref.typeIds[s.type]!, roomId: assignRoom ? roomId : null,
          checkInDate, checkOutDate, guestsCount: s.guests, source: s.source,
          status: s.kind === "arriving_pending" || s.kind === "future_pending_failed_payment" ? "pending" : "confirmed",
        });
        created++;

        const pay = (amount: string, method: "card" | "upi" | "cash" | "bank_transfer", when: string, status: "success" | "pending" = "success") =>
          recordPayment(trx, actor, { bookingId, reference: payRef(), method, amount, status, receivedAt: at(when) });

        if (isPast || isInHouse) await checkIn(trx, actor, { bookingId, at: at(checkInDate) });
        if (s.kind === "in_house_advance") await pay("5000.00", "cash", checkInDate);
        if (s.kind === "in_house_pending_payment") await pay("2600.00", "upi", checkInDate, "pending");
        if (s.kind === "arriving_advance") await pay("7800.00", "card", addDays(base, -10));
        if (s.kind === "future_pending_failed_payment") {
          const id = await pay("2600.00", "upi", base, "pending");
          await settlePayment(trx, actor, { paymentId: id, outcome: "failed" });
        }
        if (s.kind === "cancelled_unpaid") await cancelBooking(trx, actor, { bookingId, reason: "Guest changed travel plans" });
        if (s.kind === "cancelled_paid") {
          await pay("4200.00", "card", addDays(base, -6));
          // R20: the advance stays held (a liability) until someone decides refund, penalty or credit.
          await cancelBooking(trx, actor, { bookingId, reason: "Guest cancelled after paying an advance" });
        }
        if (!isPast) return;

        await checkOut(trx, actor, { bookingId, at: at(checkOutDate), finalInvoice: false }); // the stories issue their own invoices below
        const booking = await trx("bookings").where({ id: bookingId }).first("nightly_rate");
        const typeName = ROOM_TYPES.find((t) => t.code === s.type)!.name;
        const issue = () => issueInvoice(trx, actor, {
          bookingId, invoiceType: "stay", issueDate: checkOutDate, series,
          lines: [{ description: `${typeName} room, ${s.nights} night(s)`, quantity: `${s.nights}.00`, unitPrice: String(booking.nightly_rate) }],
        });
        const gross = async (invoiceId: number) => String((await trx("invoices").where({ id: invoiceId }).first("gross_amount")).gross_amount);

        if (s.kind === "past_void_reissue") {
          const first = await issue();
          await voidInvoice(trx, actor, { invoiceId: first.invoiceId, reason: "Issued with wrong guest details" });
          const second = await issueInvoice(trx, actor, {
            bookingId, invoiceType: "stay", issueDate: checkOutDate, series, replacesInvoiceId: first.invoiceId,
            lines: [{ description: `${typeName} room, ${s.nights} night(s)`, quantity: `${s.nights}.00`, unitPrice: String(booking.nightly_rate) }],
          });
          await pay(await gross(second.invoiceId), "cash", checkOutDate);
          return;
        }
        const inv = await issue();
        const total = await gross(inv.invoiceId);
        if (s.kind === "past_paid") await pay(total, idx % 2 ? "upi" : "card", checkOutDate);
        if (s.kind === "past_partial") await pay(fromMinor(toMinor(total) / 200n * 100n), "upi", checkOutDate); // half, whole rupees
        if (s.kind === "past_refund") {
          const paymentId = await pay(total, "card", checkOutDate);
          const refundId = await requestRefund(trx, actor, { paymentId, reference: `RF-${pad(++refundNo, 4)}`, amount: "1000.00", reason: "Goodwill: air conditioning fault" });
          await completeRefund(trx, actor, refundId);
        }
      });
    }
    // 3. Reference counters (D-E, migration 012): continue after the highest seeded BK-/PAY- reference.
    //    Insert-if-absent like everything else, so a counter already in use is never moved back.
    await db.transaction(async (trx) => {
      for (const [kind, table, prefix] of [["booking", "bookings", "BK-"], ["payment", "payments", "PAY-"]] as const) {
        const refs = (await trx(table).where({ property_id: ref.propertyId }).where("reference", "like", `${prefix}%`).pluck("reference")) as string[];
        const max = refs.map((r) => Number(r.slice(prefix.length))).filter(Number.isInteger).reduce((a, b) => Math.max(a, b), 10000);
        await ensure(trx, "number_sequences", { property_id: ref.propertyId, document_type: kind }, { series: prefix.slice(0, -1), prefix, next_value: max + 1 });
      }
    });
    console.log(`Demo seed done for base date ${base} (series ${series}): ${created} created, ${kept} already present and left untouched.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
