/**
 * Shared harness for DB integration tests (Gate 3b).
 *
 * Isolation: every run creates its own property (code `itest-<tag>`) with its own room type, rooms,
 * guest, tax component and invoice series. Demo data and its invoice numbers are never touched.
 * Financial rows are append-only (no DELETE grant, triggers), so test rows stay in the dev DB under
 * their itest property. Recreate the `staydesk-mysql` volume to clear them.
 *
 * Tests connect as the restricted app user, exactly like the API will, so a grant refusal is real.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Knex } from "knex";
import { createDb } from "../db/knex.js";
import { DomainError } from "../domain/errors.js";
import { toMinor } from "../domain/money.js";
import { businessDate, financialYear } from "../domain/dates.js";
import { createBooking, cancelBooking } from "../services/bookings.js";
import { insertId, type Actor } from "../services/context.js";

export type Boundary = "service" | "grant" | "trigger" | "check" | "unique" | "column" | "fk" | "lock" | "other";

/** Which layer refused an operation. */
export function boundaryOf(e: unknown): { boundary: Boundary; code: string } {
  if (e instanceof DomainError) return { boundary: "service", code: e.code };
  const err = e as { code?: string; sqlMessage?: string; message?: string };
  switch (err.code) {
    case "ER_SIGNAL_EXCEPTION":
      return { boundary: "trigger", code: err.sqlMessage ?? "SIGNAL" };
    case "ER_TABLEACCESS_DENIED_ERROR":
    case "ER_COLUMNACCESS_DENIED_ERROR":
    case "ER_SPECIFIC_ACCESS_DENIED_ERROR":
      return { boundary: "grant", code: err.code };
    case "ER_DUP_ENTRY":
      return { boundary: "unique", code: err.sqlMessage ?? err.code };
    case "ER_CHECK_CONSTRAINT_VIOLATED":
      return { boundary: "check", code: err.sqlMessage ?? err.code };
    case "ER_DATA_TOO_LONG":
    case "ER_TRUNCATED_WRONG_VALUE":
    case "WARN_DATA_TRUNCATED":
      return { boundary: "column", code: err.code };
    case "ER_NO_REFERENCED_ROW_2":
    case "ER_ROW_IS_REFERENCED_2":
      return { boundary: "fk", code: err.code };
    case "ER_LOCK_DEADLOCK":
    case "ER_LOCK_WAIT_TIMEOUT":
      return { boundary: "lock", code: err.code };
    default:
      return { boundary: "other", code: err.code ?? err.message ?? String(e) };
  }
}

export async function refusal(p: Promise<unknown>): Promise<{ boundary: Boundary; code: string }> {
  try {
    await p;
  } catch (e) {
    return boundaryOf(e);
  }
  throw new Error("Expected the operation to be refused, but it succeeded");
}

/** Splits Promise.allSettled results into values and classified refusals. */
export function settle<T>(results: PromiseSettledResult<T>[]): { ok: T[]; refused: Array<{ boundary: Boundary; code: string }> } {
  const ok: T[] = [];
  const refused: Array<{ boundary: Boundary; code: string }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") ok.push(r.value);
    else refused.push(boundaryOf(r.reason));
  }
  return { ok, refused };
}

// ---------- boundary report ----------

export interface ReportRow {
  test: string;
  operation: string;
  result: string;
  boundary: string;
}
export const report: ReportRow[] = [];
export const record = (test: string, operation: string, result: string, boundary: string): void => {
  report.push({ test, operation, result, boundary });
};
export function printReport(): void {
  if (!report.length) return;
  const lines = report.map((r) => `| ${r.test} | ${r.operation} | ${r.result} | ${r.boundary} |`);
  console.log(["", "| Test | Operation | Result | Boundary |", "|---|---|---|---|", ...lines, ""].join("\n"));
}

// ---------- fixture ----------

export interface Fixture {
  db: Knex;
  tag: string;
  actor: Actor;
  series: string;
  roomTypeId: number;
  roomIds: number[];
  guestId: number;
  ref: (kind: "B" | "P" | "R") => string;
  booking: (opts?: { status?: "confirmed" | "cancelled"; nights?: number }) => Promise<number>;
}

export async function createFixture(): Promise<Fixture> {
  const db = createDb("app");
  const tag = randomBytes(4).toString("hex"); // 8 chars
  const propertyId = await insertId(
    db("properties").insert({
      code: `itest-${tag}`, name: `Integration test ${tag}`, address: "Test only", country_code: "IN", currency: "INR",
      timezone: "Asia/Kolkata", check_in_time: "14:00:00", check_out_time: "11:00:00",
    }),
  );
  const actor: Actor = { propertyId, userId: null };
  const roomTypeId = await insertId(db("room_types").insert({ property_id: propertyId, code: "STD", name: "Standard", base_rate: "1000.00", capacity: 2 }));
  const roomIds: number[] = [];
  for (let i = 1; i <= 5; i++) roomIds.push(await insertId(db("rooms").insert({ property_id: propertyId, room_type_id: roomTypeId, number: `T${i}`, floor: 1 })));
  const guestId = await insertId(db("guests").insert({ property_id: propertyId, full_name: "Test Guest" }));
  for (const applies_to of ["room", "penalty"]) {
    await db("tax_components").insert({ property_id: propertyId, code: "GST", name: "GST", rate_percent: "12.0000", applies_to, apply_order: 1, effective_from: "2017-07-01" });
  }
  const series = "ITEST";
  await db("number_sequences").insert({ property_id: propertyId, document_type: "invoice", series, prefix: `IT/${tag}/`, next_value: 1 });
  // Checkout issues the final invoice in the current financial-year series (D-C); generated references (D-E).
  const fy = financialYear(businessDate(new Date(), "Asia/Kolkata"));
  await db("number_sequences").insert([
    { property_id: propertyId, document_type: "invoice", series: fy, prefix: `IT/${tag}/${fy}/`, next_value: 1 },
    { property_id: propertyId, document_type: "booking", series: "BK", prefix: `BK${tag}-`, next_value: 1 },
    { property_id: propertyId, document_type: "payment", series: "PAY", prefix: `PY${tag}-`, next_value: 1 },
    { property_id: propertyId, document_type: "refund", series: "RF", prefix: `RF${tag}-`, next_value: 1 },
  ]);

  let n = 0;
  const ref = (kind: "B" | "P" | "R"): string => `${kind}${tag}${String(++n).padStart(4, "0")}`;
  let day = 0;
  const booking: Fixture["booking"] = async (opts = {}) => {
    // Unassigned room, distinct far-future dates: no room conflicts between bookings.
    const start = new Date(Date.UTC(2030, 0, 1) + day++ * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + (opts.nights ?? 1) * 86_400_000).toISOString().slice(0, 10);
    const id = await createBooking(db, actor, { reference: ref("B"), guestId, roomTypeId, checkInDate: start, checkOutDate: end, guestsCount: 1, source: "direct", status: "confirmed" });
    if (opts.status === "cancelled") await cancelBooking(db, actor, { bookingId: id, reason: "integration test" });
    return id;
  };
  return { db, tag, actor, series, roomTypeId, roomIds, guestId, ref, booking };
}

// ---------- invariants (computed from base tables, independent of the views and the services) ----------

const m = (v: unknown): bigint => toMinor(String(v ?? "0"));

/** Returns human-readable violations of F1.2–F1.5 / F2 for one property. Empty = all hold. */
export async function invariantViolations(db: Knex, propertyId: number): Promise<string[]> {
  const out: string[] = [];
  const [allocs] = (await db.raw(
    `SELECT a.id, a.payment_id, a.invoice_id, a.amount, COALESCE(SUM(r.amount),0) AS released,
            p.booking_id AS p_booking, i.booking_id AS i_booking
     FROM payment_allocations a
     JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id
     LEFT JOIN allocation_releases r ON r.payment_allocation_id = a.id
     WHERE p.property_id = ? GROUP BY a.id, a.payment_id, a.invoice_id, a.amount, p.booking_id, i.booking_id`,
    [propertyId],
  )) as unknown as [Array<Record<string, unknown>>];
  const netByPayment = new Map<number, bigint>();
  const netByInvoice = new Map<number, bigint>();
  for (const a of allocs) {
    const net = m(a["amount"]) - m(a["released"]);
    if (net < 0n) out.push(`allocation ${a["id"]} released more than allocated`);
    if (a["p_booking"] !== a["i_booking"]) out.push(`allocation ${a["id"]} links two bookings`);
    netByPayment.set(a["payment_id"] as number, (netByPayment.get(a["payment_id"] as number) ?? 0n) + net);
    netByInvoice.set(a["invoice_id"] as number, (netByInvoice.get(a["invoice_id"] as number) ?? 0n) + net);
  }

  const [pays] = (await db.raw(
    `SELECT p.id, p.amount, p.status, COALESCE(SUM(CASE WHEN f.status IN ('requested','completed') THEN f.amount END),0) AS reserved
     FROM payments p LEFT JOIN refunds f ON f.payment_id = p.id WHERE p.property_id = ? GROUP BY p.id, p.amount, p.status`,
    [propertyId],
  )) as unknown as [Array<Record<string, unknown>>];
  for (const p of pays) {
    const alloc = netByPayment.get(p["id"] as number) ?? 0n;
    const reserved = m(p["reserved"]);
    if (p["status"] !== "success" && (alloc !== 0n || reserved !== 0n)) out.push(`payment ${p["id"]} (${p["status"]}) has allocations or refunds`);
    if (reserved > m(p["amount"])) out.push(`payment ${p["id"]}: refunds ${reserved} > amount (F1.4)`);
    if (alloc + reserved > m(p["amount"])) out.push(`payment ${p["id"]}: allocated ${alloc} + refunds ${reserved} > amount (F1.2/F1.5)`);
  }

  const invs = await db("invoices").where({ property_id: propertyId }).select("id", "status", "gross_amount");
  for (const i of invs) {
    const alloc = netByInvoice.get(i.id as number) ?? 0n;
    if (alloc > m(i.gross_amount)) out.push(`invoice ${i.id}: allocated ${alloc} > gross (F1.3)`);
    if (i.status === "void" && alloc !== 0n) out.push(`void invoice ${i.id} still holds ${alloc} allocated`);
  }

  // F2: numbers in each series are unique and contiguous 1..next_value-1 (every issue either committed or rolled back).
  const seqs = await db("number_sequences").where({ property_id: propertyId, document_type: "invoice" });
  for (const s of seqs) {
    const nums = (await db("invoices").where({ property_id: propertyId, series: s.series }).orderBy("sequence_number").pluck("sequence_number")) as number[];
    const expected = Array.from({ length: (s.next_value as number) - 1 }, (_, k) => k + 1);
    if (JSON.stringify(nums) !== JSON.stringify(expected)) out.push(`series ${s.series}: numbers ${nums.join(",")} != 1..${(s.next_value as number) - 1}`);
  }
  return out;
}

/** Concurrently starts every task (each takes its own pooled connection). */
export const parallel = <T>(n: number, task: (i: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> =>
  Promise.allSettled(Array.from({ length: n }, (_, i) => task(i)));

/** Creates a login in the fixture's property (bcrypt cost 4 keeps tests fast). Returns its id and password. */
export async function createUser(fx: Fixture, role: "front_desk" | "admin" | "super_admin", opts: { active?: boolean; fullName?: string } = {}): Promise<{ id: number; username: string; password: string }> {
  const username = `${role}-${randomBytes(3).toString("hex")}`;
  const password = `pw-${randomBytes(9).toString("hex")}`;
  const staffId = opts.fullName ? await insertId(fx.db("staff_members").insert({ property_id: fx.actor.propertyId, full_name: opts.fullName, job_title: "Test" })) : null;
  const id = await insertId(fx.db("user_accounts").insert({ property_id: fx.actor.propertyId, username, password_hash: bcrypt.hashSync(password, 4), role, staff_member_id: staffId, is_active: opts.active ?? true }));
  return { id, username, password };
}
