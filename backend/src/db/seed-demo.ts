/**
 * Minimal demo seed: login users + 10 rooms only (5 Normal, 5 AC, capacity 4).
 * No guests, bookings, payments or invoices — so the demo can create/delete those live.
 * Run: `npm run db:seed:demo` or `docker compose --profile tools run --rm seed`
 * Refuses NODE_ENV=production. Idempotent for property / types / rooms / users.
 *
 * Demo logins (override with DEMO_* env vars if needed):
 *   frontdesk / Demo@1234   (front_desk — confirm, check-in, payments)
 *   admin     / Demo@1234   (admin — Settings, void, reports)
 *   superadmin / Demo@1234  (super_admin)
 */
import bcrypt from "bcryptjs";
import type { Knex } from "knex";
import { createDb } from "./knex.js";
import { insertId } from "../services/context.js";
import { financialYear } from "../domain/dates.js";

const TZ = "Asia/Kolkata";

/** Built-in client-demo credentials. Env vars win when both username and password are set. */
const DEMO_LOGINS = {
  DEMO_FRONT_DESK: { username: "frontdesk", password: "Demo@1234" },
  DEMO_ADMIN: { username: "admin", password: "Demo@1234" },
  DEMO_SUPER_ADMIN: { username: "superadmin", password: "Demo@1234" },
} as const;

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

const ROOM_TYPES = [
  { code: "NRM", name: "Normal", base_rate: "2500.00", capacity: 4 },
  { code: "AC", name: "AC", base_rate: "3500.00", capacity: 4 },
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

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") throw new Error("The demo seed refuses to run when NODE_ENV=production.");
  const base = process.env["SEED_BASE_DATE"] || todayIn(TZ);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) throw new Error("SEED_BASE_DATE must be YYYY-MM-DD");
  const series = financialYear(base);

  const db = createDb("app");
  try {
    await db.transaction(async (trx) => {
      const propertyId = await ensure(trx, "properties", { code: process.env["HOTEL_SLUG"] || "demo-hotel" }, {
        name: "StayDesk Demo Hotel", address: "12 Beach Road, Chennai 600001", phone: "+91 44 2345 6789", email: "frontdesk@example.com",
        country_code: "IN", currency: "INR", timezone: TZ, check_in_time: "14:00:00", check_out_time: "11:00:00",
      });
      for (const applies of ["room", "penalty"] as const) {
        await ensure(trx, "tax_components", { property_id: propertyId, code: "GST", applies_to: applies, effective_from: "2017-07-01" }, { name: "GST", rate_percent: "12.0000", apply_order: 1 });
      }
      await ensure(trx, "number_sequences", { property_id: propertyId, document_type: "invoice", series }, { prefix: `INV/${series}/`, next_value: 1 });
      await ensure(trx, "number_sequences", { property_id: propertyId, document_type: "booking", series: "BK" }, { prefix: "BK-", next_value: 1 });
      await ensure(trx, "number_sequences", { property_id: propertyId, document_type: "payment", series: "PAY" }, { prefix: "PAY-", next_value: 1 });
      await ensure(trx, "number_sequences", { property_id: propertyId, document_type: "refund", series: "RF" }, { prefix: "RF-", next_value: 1 });

      const typeIds: Record<string, number> = {};
      for (const t of ROOM_TYPES) {
        typeIds[t.code] = await ensure(trx, "room_types", { property_id: propertyId, code: t.code }, { name: t.name, base_rate: t.base_rate, capacity: t.capacity });
      }

      for (let i = 1; i <= 5; i++) {
        await ensure(trx, "rooms", { property_id: propertyId, number: `10${i}` }, {
          room_type_id: typeIds["NRM"], floor: 1, is_out_of_service: false, housekeeping_status: "clean",
        });
        await ensure(trx, "rooms", { property_id: propertyId, number: `20${i}` }, {
          room_type_id: typeIds["AC"], floor: 2, is_out_of_service: false, housekeeping_status: "clean",
        });
      }

      const staffIds: Record<string, number> = {};
      for (const s of STAFF) {
        staffIds[s.email] = await ensure(trx, "staff_members", { property_id: propertyId, email: s.email }, {
          full_name: s.full_name, job_title: s.job_title, is_active: s.is_active,
        });
      }

      const loginsCreated: string[] = [];
      for (const u of USERS) {
        const fallback = DEMO_LOGINS[u.env];
        const username = process.env[`${u.env}_USERNAME`] || fallback.username;
        const password = process.env[`${u.env}_PASSWORD`] || fallback.password;
        const exists = await trx("user_accounts").where({ property_id: propertyId, username }).first("id");
        if (exists) {
          kept++;
          continue;
        }
        await ensure(trx, "user_accounts", { property_id: propertyId, username }, {
          password_hash: await bcrypt.hash(password, 12),
          role: u.role,
          staff_member_id: u.staffEmail ? staffIds[u.staffEmail] : null,
          is_active: true,
        });
        loginsCreated.push(`${username} (${u.role})`);
      }
      if (loginsCreated.length) console.log(`Demo logins created: ${loginsCreated.join(", ")}`);
    });
    console.log(`Demo seed done (users + 10 rooms: 101–105 Normal, 201–205 AC): ${created} created, ${kept} already present.`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
