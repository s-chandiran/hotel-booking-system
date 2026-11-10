/**
 * Read endpoints for the demo screens. Shapes follow the existing frontend types
 * (src/types/dashboard.ts, src/types/modules.ts), with these deliberate differences, all for Gate 4:
 *  - no `reserved` room status or counter (D2, G1);
 *  - a payment's status is its own status (pending/success/failed), and refunds show as
 *    `refundedAmount` (G9);
 *  - `invoiceNumber` lists the invoices a payment is allocated to, or "Advance" (G10);
 *  - Settings has `taxComponents` beside the single `taxRate` the screen shows (G11).
 * Money is returned as numbers for display only. Every figure is computed in SQL from DECIMAL columns
 * or the views, never with floats on the server.
 * Every query is scoped to the caller's property (req.actor.propertyId).
 */
import { Router, type Request } from "express";
import type { Knex } from "knex";
import { businessDate } from "../domain/dates.js";
import { percentOf, sum, toMinor, fromMinor } from "../domain/money.js";
import { freeRoomsForBooking } from "../services/bookings.js";
import { onPaymentPaid } from "./events.js";
import { isAtLeast, requireRole } from "./auth.js";
import { HttpError, idParam, num, route } from "./http.js";

const SOURCE: Record<string, string> = { direct: "Direct", booking_com: "Booking.com", expedia: "Expedia", walk_in: "Walk-in", phone: "Phone" };
const METHOD: Record<string, string> = { card: "Card", upi: "UPI", cash: "Cash", bank_transfer: "Bank transfer" };
const regionName = new Intl.DisplayNames(["en"], { type: "region" });
const country = (code: string | null): string => {
  if (!code) return "";
  try {
    return regionName.of(code) ?? code;
  } catch {
    return code;
  }
};
const hhmm = (t: string | null | undefined): string => (t ? t.slice(0, 5) : "");
const utc = (s: string): Date => new Date(`${s.replace(" ", "T")}Z`);
const pid = (req: Request): number => req.actor!.propertyId;

async function property(db: Knex, id: number) {
  const p = await db("properties").where({ id }).first();
  if (!p) throw new HttpError(404, "NOT_FOUND", "Property not found");
  return p as { id: number; name: string; address: string; phone: string | null; email: string | null; currency: string; timezone: string; check_in_time: string; check_out_time: string };
}

/** Sum of the room-tax components in effect on a business date (percent, as a string like "12.0000"). */
async function roomTaxComponents(db: Knex, propertyId: number, date: string) {
  return db("tax_components")
    .where({ property_id: propertyId, applies_to: "room" })
    .where("effective_from", "<=", date)
    .where((q) => q.whereNull("effective_to").orWhere("effective_to", ">", date))
    .orderBy([{ column: "apply_order" }, { column: "id" }])
    .select("code", "name", "rate_percent", "effective_from", "effective_to");
}

const bookingRows = (db: Knex, propertyId: number) =>
  db("bookings as b")
    .join("guests as g", "g.id", "b.guest_id")
    .join("room_types as t", "t.id", "b.room_type_id")
    .leftJoin("rooms as r", "r.id", "b.room_id")
    .where("b.property_id", propertyId)
    .select("b.id", "b.reference", "b.status", "b.source", "b.check_in_date", "b.check_out_date", "b.guests_count", "b.room_total", "b.expected_arrival_time", "b.created_at", "g.full_name", "t.name as type_name", "r.number as room_number");

type BookingRow = Awaited<ReturnType<typeof bookingRows>>[number];

/**
 * Balance shown at the front desk. Once the final invoice exists it is the invoice balance due.
 * Before that it is an estimate: room total + room tax in effect today − net money received.
 */
async function balances(db: Knex, propertyId: number, ids: number[], today: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const taxes = await roomTaxComponents(db, propertyId, today);
  const rows = await db("v_booking_balance").whereIn("booking_id", ids).select("booking_id", "room_total", "received_net", "invoice_count", "invoice_balance_due");
  for (const r of rows) {
    if (num(r.invoice_count) > 0) out.set(r.booking_id as number, num(r.invoice_balance_due));
    else {
      const net = toMinor(String(r.room_total));
      const gross = net + sum(taxes.map((t) => percentOf(net, String(t.rate_percent))));
      const due = gross - toMinor(String(r.received_net));
      out.set(r.booking_id as number, Number(fromMinor(due > 0n ? due : 0n)));
    }
  }
  return out;
}

async function movements(db: Knex, propertyId: number, today: string, p: Awaited<ReturnType<typeof property>>) {
  const arrivals = (await bookingRows(db, propertyId).where("b.check_in_date", today).whereIn("b.status", ["pending", "confirmed", "checked_in"]).orderBy("b.expected_arrival_time")) as BookingRow[];
  const departures = (await bookingRows(db, propertyId).where("b.check_out_date", today).whereIn("b.status", ["checked_in", "checked_out"]).orderBy("b.reference")) as BookingRow[];
  const bal = await balances(db, propertyId, [...arrivals, ...departures].map((b) => b.id as number), today);
  const item = (b: BookingRow, kind: "arrival" | "departure") => ({
    id: String(b.id), reference: b.reference, guestName: b.full_name, roomNumber: b.room_number ?? "", roomType: b.type_name, kind,
    time: kind === "arrival" ? hhmm(b.expected_arrival_time) || hhmm(p.check_in_time) : hhmm(p.check_out_time),
    status: (kind === "arrival" ? b.status === "checked_in" : b.status === "checked_out") ? ("done" as const) : ("pending" as const),
    bookingStatus: b.status, balance: bal.get(b.id as number) ?? 0,
  });
  return { arrivals: arrivals.map((b) => item(b, "arrival")), departures: departures.map((b) => item(b, "departure")) };
}

/** Invoiced net of issued invoices in [from, to] (D-G: no tax, no void invoices, no advances). */
async function revenue(db: Knex, propertyId: number, from: string, to: string): Promise<number> {
  const r = await db("invoices").where({ property_id: propertyId, status: "issued" }).whereBetween("issue_date", [from, to]).sum({ v: "net_amount" }).first();
  return num(r?.v);
}

const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Room-nights actually stayed (checked in or out) per business date in [from, to). */
async function roomNights(db: Knex, propertyId: number, from: string, to: string): Promise<Map<string, number>> {
  const stays = await db("bookings").where({ property_id: propertyId }).whereIn("status", ["checked_in", "checked_out"]).where("check_in_date", "<", to).where("check_out_date", ">", from).select("check_in_date", "check_out_date");
  const out = new Map<string, number>();
  for (const s of stays) {
    for (let d = s.check_in_date > from ? s.check_in_date : from; d < s.check_out_date && d < to; d = addDays(d, 1)) out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}

export function readRoutes(db: Knex): Router {
  const r = Router();

  r.get("/dashboard", route(async (req, res) => {
    const p = await property(db, pid(req));
    const today = businessDate(new Date(), p.timezone);
    const rooms = await db("v_room_status as v").join("room_types as t", "t.id", "v.room_type_id").where("v.property_id", p.id).orderBy("v.number").select("v.number", "v.floor", "t.name as type", "v.status");
    const count = (s: string) => rooms.filter((x) => x.status === s).length;
    const { arrivals, departures } = await movements(db, p.id, today, p);
    const recent = (await bookingRows(db, p.id).whereNot("b.status", "cancelled").orderBy("b.created_at", "desc").orderBy("b.id", "desc").limit(6)) as BookingRow[];
    // Bookings created on today's business date (property timezone): look back 2 days in UTC, then compare dates.
    const createdRecently = (await db("bookings").where({ property_id: p.id }).whereNot("status", "cancelled").where("created_at", ">=", new Date(Date.now() - 2 * 86_400_000)).pluck("created_at")) as string[];
    const bookingsToday = createdRecently.filter((c) => businessDate(utc(String(c)), p.timezone) === today).length;
    const showRevenue = isAtLeast(req.user, "admin"); // Q16 / §10: front desk sees no revenue
    const week = await roomNights(db, p.id, addDays(today, -6), addDays(today, 1));
    const total = rooms.length || 1;
    res.json({
      propertyName: p.name,
      stats: {
        totalRooms: rooms.length, available: count("available"), occupied: count("occupied"), maintenance: count("maintenance"),
        checkInsToday: arrivals.length, checkOutsToday: departures.length, bookingsToday,
        revenueToday: showRevenue ? await revenue(db, p.id, today, today) : null,
        revenueMonth: showRevenue ? await revenue(db, p.id, `${today.slice(0, 7)}-01`, today) : null,
        currency: p.currency,
      },
      occupancyWeek: Array.from({ length: 7 }, (_, i) => {
        const d = addDays(today, i - 6);
        return { day: new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), rate: Math.round(((week.get(d) ?? 0) * 100) / total) };
      }),
      arrivals: arrivals.map(({ kind: _k, balance: _b, bookingStatus: _s, ...m }) => m),
      departures: departures.map(({ kind: _k, balance: _b, bookingStatus: _s, ...m }) => m),
      recentBookings: recent.map((b) => ({ id: String(b.id), reference: b.reference, guestName: b.full_name, roomNumber: b.room_number ?? "", checkIn: b.check_in_date, checkOut: b.check_out_date, status: b.status, total: num(b.room_total) })),
      rooms: rooms.map((x) => ({ number: x.number, floor: x.floor, type: x.type, status: x.status })),
    });
  }));

  r.get("/bookings", route(async (req, res) => {
    const rows = (await bookingRows(db, pid(req)).orderBy("b.check_in_date", "desc").orderBy("b.id", "desc")) as BookingRow[];
    res.json(rows.map((b) => ({
      id: String(b.id), reference: b.reference, guestName: b.full_name, roomNumber: b.room_number ?? "", roomType: b.type_name, checkIn: b.check_in_date, checkOut: b.check_out_date,
      guests: b.guests_count, source: SOURCE[b.source] ?? b.source, status: b.status, total: num(b.room_total),
    })));
  }));

  r.get("/bookings/:id", route(async (req, res) => {
    const id = idParam(req);
    const p = await property(db, pid(req));
    const b = (await bookingRows(db, p.id).where("b.id", id).first()) as BookingRow | undefined;
    if (!b) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    const today = businessDate(new Date(), p.timezone);
    const bal = (await balances(db, p.id, [id], today)).get(id) ?? 0;
    const v = await db("v_booking_balance").where({ booking_id: id }).first("received_net", "advance_held", "invoice_count");
    const invoices = await db("v_invoice_balance").where({ booking_id: id }).orderBy("invoice_id").select("invoice_id", "invoice_number", "status", "gross_amount", "balance_due", "payment_status");
    res.json({
      id: String(b.id), reference: b.reference, status: b.status, guestName: b.full_name, roomType: b.type_name, roomNumber: b.room_number ?? "", checkIn: b.check_in_date, checkOut: b.check_out_date,
      guests: b.guests_count, arrivalTime: hhmm(b.expected_arrival_time), source: SOURCE[b.source] ?? b.source, total: num(b.room_total), received: num(v?.received_net), advanceHeld: num(v?.advance_held),
      balanceDue: bal, balanceIsEstimate: num(v?.invoice_count) === 0, // D-D: shown as the checkout warning
      invoices: invoices.map((i) => ({ id: String(i.invoice_id), number: i.invoice_number, status: i.payment_status, amount: num(i.gross_amount), balanceDue: num(i.balance_due) })),
    });
  }));

  r.get("/bookings/:id/free-rooms", route(async (req, res) => {
    const rooms = await freeRoomsForBooking(db, req.actor!, idParam(req));
    res.json(rooms.map((x) => ({ id: String(x.id), number: x.number, floor: x.floor, housekeeping: x.housekeeping_status })));
  }));

  r.get("/room-types", route(async (req, res) => {
    const rows = await db("room_types").where({ property_id: pid(req), is_active: true }).orderBy("base_rate").select("id", "code", "name", "base_rate", "capacity");
    res.json(rows.map((t) => ({ id: String(t.id), code: t.code, name: t.name, rate: num(t.base_rate), capacity: t.capacity })));
  }));

  r.get("/rooms", route(async (req, res) => {
    const rows = await db("v_room_status as v").join("room_types as t", "t.id", "v.room_type_id").join("rooms as rm", "rm.id", "v.room_id").where("v.property_id", pid(req)).orderBy("v.number")
      .select("v.room_id", "v.number", "v.floor", "t.name as type", "t.id as type_id", "v.status", "t.base_rate", "t.capacity", "v.housekeeping_status", "rm.is_out_of_service");
    res.json(rows.map((x) => ({ id: String(x.room_id), number: x.number, floor: x.floor, type: x.type, roomTypeId: String(x.type_id), status: x.status, outOfService: !!x.is_out_of_service, rate: num(x.base_rate), capacity: x.capacity, housekeeping: x.housekeeping_status })));
  }));

  r.get("/guests", route(async (req, res) => {
    const rows = await db("guests as g")
      .leftJoin("bookings as b", (j) => j.on("b.guest_id", "g.id").andOnIn("b.status", ["checked_in", "checked_out"]))
      .where("g.property_id", pid(req))
      .groupBy(
        "g.id",
        "g.full_name",
        "g.email",
        "g.phone",
        "g.country_code",
        "g.is_vip",
        "g.id_document_type",
        "g.id_document_number_last4",
      )
      .orderBy("g.full_name")
      .select(
        "g.id",
        "g.full_name",
        "g.email",
        "g.phone",
        "g.country_code",
        "g.is_vip",
        "g.id_document_type",
        "g.id_document_number_last4",
        db.raw("COUNT(b.id) AS stays"),
        db.raw("MAX(b.check_out_date) AS last_stay"),
      );
    res.json(
      rows.map((g) => ({
        id: String(g.id),
        name: g.full_name,
        email: g.email ?? "",
        phone: g.phone ?? "",
        country: country(g.country_code),
        countryCode: g.country_code ?? "",
        stays: Number(g.stays),
        lastStay: g.last_stay ?? "",
        vip: !!g.is_vip,
        idDocumentType: (g.id_document_type as string | null) ?? null,
        // Masked only — full ID number is never returned on the list.
        idDocumentNumberMasked: g.id_document_number_last4 ? `••••${g.id_document_number_last4}` : "",
      })),
    );
  }));

  r.get("/front-desk", route(async (req, res) => {
    const p = await property(db, pid(req));
    const { arrivals, departures } = await movements(db, p.id, businessDate(new Date(), p.timezone), p);
    res.json([...arrivals, ...departures].map(({ roomType: _t, ...x }) => x));
  }));

  r.get("/invoices", route(async (req, res) => {
    const rows = await db("v_invoice_balance as v").join("bookings as b", "b.id", "v.booking_id").join("guests as g", "g.id", "b.guest_id").where("v.property_id", pid(req)).orderBy("v.invoice_number", "desc")
      .select("v.invoice_id", "v.invoice_number", "g.full_name", "b.reference", "v.issue_date", "v.gross_amount", "v.tax_amount", "v.payment_status", "v.balance_due", "v.allocated_amount");
    res.json(rows.map((i) => {
      const amount = num(i.gross_amount);
      const balanceDue = num(i.balance_due);
      const amountPaid = num(i.allocated_amount);
      return {
        id: String(i.invoice_id),
        number: i.invoice_number,
        guestName: i.full_name,
        reference: i.reference,
        issued: i.issue_date,
        amount,
        tax: num(i.tax_amount),
        status: i.payment_status,
        balanceDue,
        amountPaid,
      };
    }));
  }));

  /** Invoice detail with immutable lines and tax snapshot. Issued amounts are never editable. */
  r.get("/invoices/:id", route(async (req, res) => {
    const id = idParam(req);
    const row = await db("v_invoice_balance as v")
      .join("invoices as i", "i.id", "v.invoice_id")
      .join("bookings as b", "b.id", "v.booking_id")
      .join("guests as g", "g.id", "b.guest_id")
      .where({ "v.property_id": pid(req), "v.invoice_id": id })
      .first(
        "v.invoice_id", "v.invoice_number", "i.invoice_type", "i.status as document_status", "i.void_reason",
        "g.full_name", "b.reference", "v.issue_date", "i.net_amount", "v.tax_amount", "v.gross_amount", "v.payment_status", "v.balance_due", "v.allocated_amount",
      );
    if (!row) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");
    const lines = await db("invoice_lines").where({ invoice_id: id }).orderBy("line_no")
      .select("line_no", "description", "quantity", "unit_price", "line_net");
    const taxLines = await db("invoice_tax_lines").where({ invoice_id: id }).orderBy("apply_order")
      .select("component_code", "component_name", "rate_percent", "taxable_base", "tax_amount");
    res.json({
      id: String(row.invoice_id),
      number: row.invoice_number,
      type: row.invoice_type,
      documentStatus: row.document_status,
      voidReason: row.void_reason ?? null,
      guestName: row.full_name,
      reference: row.reference,
      issued: row.issue_date,
      net: num(row.net_amount),
      tax: num(row.tax_amount),
      amount: num(row.gross_amount),
      amountPaid: num(row.allocated_amount),
      status: row.payment_status,
      balanceDue: num(row.balance_due),
      lines: lines.map((l) => ({
        lineNo: l.line_no as number,
        description: l.description as string,
        quantity: num(l.quantity),
        unitPrice: num(l.unit_price),
        lineNet: num(l.line_net),
      })),
      taxLines: taxLines.map((t) => ({
        code: t.component_code as string,
        name: t.component_name as string,
        ratePercent: num(t.rate_percent),
        taxableBase: num(t.taxable_base),
        taxAmount: num(t.tax_amount),
      })),
    });
  }));

  r.get("/payments", route(async (req, res) => {
    const p = await property(db, pid(req));
    const rows = await db("v_payment_balance as v").join("bookings as b", "b.id", "v.booking_id").join("guests as g", "g.id", "b.guest_id").where("v.property_id", p.id).orderBy("v.received_at", "desc")
      .select("v.payment_id", "v.reference", "g.full_name", "v.received_at", "v.method", "v.amount", "v.status", "v.refunded_completed", "v.refunds_reserved");
    const alloc = await db("v_allocation_net as a").join("invoices as i", "i.id", "a.invoice_id").where("i.property_id", p.id).where("a.net_amount", ">", 0).select("a.payment_id", "i.invoice_number");
    const byPayment = new Map<number, string[]>();
    for (const a of alloc) byPayment.set(a.payment_id as number, [...(byPayment.get(a.payment_id as number) ?? []), a.invoice_number as string]);
    res.json(rows.map((x) => {
      const amount = num(x.amount);
      const reserved = num(x.refunds_reserved);
      return {
        id: String(x.payment_id), reference: x.reference, invoiceNumber: (byPayment.get(x.payment_id as number) ?? []).join(", ") || "Advance", guestName: x.full_name,
        date: businessDate(utc(String(x.received_at)), p.timezone), method: METHOD[x.method] ?? x.method, amount, status: x.status, refundedAmount: num(x.refunded_completed),
        // Cap for a new refund request: payment total minus requested+completed refunds (F1.4).
        refundableAmount: x.status === "success" ? Math.max(0, amount - reserved) : 0,
      };
    }));
  }));

  /** Admin refund queue: requested / completed / rejected rows for the property. */
  r.get("/refunds", requireRole("admin"), route(async (req, res) => {
    const p = await property(db, pid(req));
    const rows = await db("refunds as r")
      .join("payments as pay", "pay.id", "r.payment_id")
      .join("bookings as b", "b.id", "pay.booking_id")
      .join("guests as g", "g.id", "b.guest_id")
      .where("r.property_id", p.id)
      .orderBy("r.requested_at", "desc")
      .select("r.id", "r.reference", "r.payment_id", "pay.reference as payment_reference", "g.full_name", "r.amount", "r.reason", "r.status", "r.requested_at");
    res.json(rows.map((x) => ({
      id: String(x.id),
      reference: x.reference,
      paymentId: String(x.payment_id),
      paymentReference: x.payment_reference,
      guestName: x.full_name,
      amount: num(x.amount),
      reason: x.reason,
      status: x.status,
      requestedAt: businessDate(utc(String(x.requested_at)), p.timezone),
    })));
  }));

  r.get("/reports", requireRole("admin"), route(async (req, res) => {
    const p = await property(db, pid(req));
    const today = businessDate(new Date(), p.timezone);
    const totalRooms = Number((await db("rooms").where({ property_id: p.id }).count({ n: "*" }).first())?.n ?? 0) || 1;
    const months: Array<{ month: string; revenue: number; occupancy: number; adr: number }> = [];
    const [y, m] = today.split("-").map(Number) as [number, number];
    for (let k = 5; k >= 0; k--) {
      const start = new Date(Date.UTC(y, m - 1 - k, 1));
      const from = start.toISOString().slice(0, 10);
      const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      const rev = await revenue(db, p.id, from, addDays(next, -1));
      const nights = [...(await roomNights(db, p.id, from, next)).values()].reduce((a, b) => a + b, 0);
      const days = (Date.parse(`${next}T00:00:00Z`) - start.getTime()) / 86_400_000;
      months.push({ month: start.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), revenue: rev, occupancy: Math.round((nights * 100) / (totalRooms * days)), adr: nights ? Math.round(rev / nights) : 0 });
    }
    const bySource = await db("bookings").where({ property_id: p.id }).whereNot("status", "cancelled").groupBy("source").orderBy("source").select("source").count({ n: "*" });
    const byType = await db("invoices as i").join("bookings as b", "b.id", "i.booking_id").join("room_types as t", "t.id", "b.room_type_id").where({ "i.property_id": p.id, "i.status": "issued" })
      .groupBy("t.name").orderBy("t.name").select("t.name").sum({ v: "i.net_amount" });
    res.json({
      months,
      bySource: (bySource as unknown as Array<{ source: string; n: number }>).map((s) => ({ source: SOURCE[s.source] ?? s.source, bookings: Number(s.n) })),
      byRoomType: (byType as unknown as Array<{ name: string; v: string }>).map((t) => ({ type: t.name, revenue: num(t.v) })),
    });
  }));

  r.get("/settings", requireRole("admin"), route(async (req, res) => {
    const p = await property(db, pid(req));
    const taxes = await roomTaxComponents(db, p.id, businessDate(new Date(), p.timezone));
    const staff = await db("staff_members as s").leftJoin("user_accounts as u", "u.staff_member_id", "s.id").where("s.property_id", p.id).orderBy("s.full_name")
      .select("s.id", "s.full_name", "s.email", "s.job_title", "s.is_active", "u.role as login_role");
    res.json({
      property: {
        name: p.name, address: p.address, phone: p.phone ?? "", email: p.email ?? "", currency: p.currency, timezone: p.timezone, checkInTime: hhmm(p.check_in_time), checkOutTime: hhmm(p.check_out_time),
        taxRate: taxes.reduce((a, t) => a + num(t.rate_percent), 0),
      },
      taxComponents: taxes.map((t) => ({ code: t.code, name: t.name, ratePercent: num(t.rate_percent), effectiveFrom: t.effective_from, effectiveTo: t.effective_to })),
      staff: staff.map((s) => ({ id: String(s.id), name: s.full_name, email: s.email ?? "", role: s.job_title ?? "", loginRole: s.login_role ?? null, active: !!s.is_active })),
    });
  }));

  /**
   * Server-Sent Events for desktop full-payment notifications.
   * Auth is the normal Bearer JWT (BFF cookie → Authorization). No business logic in Electron main.
   */
  r.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`: connected\n\n`);

    const send = (event: { invoiceId: string; invoiceNumber: string; guestName: string; bookingReference: string }) => {
      res.write(`event: paymentPaid\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = onPaymentPaid(send);
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  return r;
}
