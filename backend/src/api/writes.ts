/**
 * The eight demo actions (D6), and nothing else. Every body is validated with a strict schema, so the
 * client cannot send prices, invoice lines, references, statuses or a property id. The server
 * computes all of those. Bookings and payments need an `idempotencyKey` (one per form submission), so a
 * double click or retry never creates a second record. The BFF forwards no custom headers, so the key
 * travels in the body.
 */
import { Router } from "express";
import type { Knex } from "knex";
import { z } from "zod";
import { checkIn, checkOut, confirmBooking, createBooking } from "../services/bookings.js";
import { recordPayment } from "../services/finance.js";
import { createGuest } from "../services/guests.js";
import { HttpError, idParam, num, parse, route } from "./http.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "is not a real date");
const id = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d{0,17}$/).transform(Number)]);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "must be 8–64 letters, digits, - or _");
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "must be a decimal amount like 1500.00").refine((s) => Number(s) > 0, "must be positive");

const guestBody = z.object({
  fullName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).optional().nullable(),
}).strict();

const bookingBody = z.object({
  guestId: id,
  roomTypeId: id,
  checkInDate: date,
  checkOutDate: date,
  guestsCount: z.number().int().min(1).max(20),
  source: z.enum(["direct", "booking_com", "expedia", "walk_in", "phone"]),
  expectedArrivalTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  idempotencyKey,
}).strict();

const checkInBody = z.object({ roomId: id }).strict();
const emptyBody = z.object({}).strict();

/** Desk payments are recorded as received (success). Gateway payments are out of scope. */
const paymentBody = z.object({
  bookingId: id,
  method: z.enum(["card", "upi", "cash", "bank_transfer"]),
  amount: money,
  idempotencyKey,
}).strict();

export function writeRoutes(db: Knex): Router {
  const r = Router();

  r.post("/guests", route(async (req, res) => {
    const b = parse(guestBody, req.body);
    const guestId = await createGuest(db, req.actor!, { fullName: b.fullName, email: b.email ?? null, phone: b.phone ?? null, countryCode: b.countryCode ?? null });
    res.status(201).json({ id: String(guestId) });
  }));

  r.post("/bookings", route(async (req, res) => {
    const b = parse(bookingBody, req.body);
    const bookingId = await createBooking(db, req.actor!, {
      guestId: b.guestId, roomTypeId: b.roomTypeId, checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, guestsCount: b.guestsCount, source: b.source,
      expectedArrivalTime: b.expectedArrivalTime ? `${b.expectedArrivalTime}:00` : null, idempotencyKey: b.idempotencyKey,
    });
    const row = await db("bookings").where({ id: bookingId }).first("reference", "status", "room_total");
    res.status(201).json({ id: String(bookingId), reference: row.reference, status: row.status, total: num(row.room_total) });
  }));

  r.post("/bookings/:id/confirm", route(async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const bookingId = idParam(req);
    await confirmBooking(db, req.actor!, bookingId);
    res.json({ id: String(bookingId), status: "confirmed" });
  }));

  r.post("/bookings/:id/check-in", route(async (req, res) => {
    const b = parse(checkInBody, req.body);
    const bookingId = idParam(req);
    await checkIn(db, req.actor!, { bookingId, roomId: b.roomId });
    res.json({ id: String(bookingId), status: "checked_in" });
  }));

  r.post("/bookings/:id/check-out", route(async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const bookingId = idParam(req);
    const out = await checkOut(db, req.actor!, { bookingId });
    const inv = out.invoiceId ? await db("v_invoice_balance").where({ invoice_id: out.invoiceId }).first("gross_amount", "balance_due") : null;
    res.json({ id: String(bookingId), status: "checked_out", invoice: out.invoiceId ? { id: String(out.invoiceId), number: out.invoiceNumber, amount: num(inv?.gross_amount), balanceDue: num(inv?.balance_due) } : null });
  }));

  r.post("/payments", route(async (req, res) => {
    const b = parse(paymentBody, req.body);
    // Ownership is checked by the service (the booking must belong to the caller's property).
    const paymentId = await recordPayment(db, req.actor!, { bookingId: b.bookingId, method: b.method, amount: b.amount, status: "success", idempotencyKey: b.idempotencyKey });
    const row = await db("payments").where({ id: paymentId }).first("reference", "amount");
    if (!row) throw new HttpError(500, "INTERNAL", "Payment not found after recording");
    res.status(201).json({ id: String(paymentId), reference: row.reference, amount: num(row.amount) });
  }));

  return r;
}
