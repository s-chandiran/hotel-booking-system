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
import { cancelBooking, checkIn, checkOut, confirmBooking, createBooking, updateBooking } from "../services/bookings.js";
import { publishPaymentPaid } from "./events.js";
import { completeRefund, recordPayment, rejectRefund, requestRefund, voidInvoice } from "../services/finance.js";
import { createGuest, updateGuest } from "../services/guests.js";
import { createRoom, removeRoom, setHousekeeping, setMaintenance, updateRoom } from "../services/rooms.js";
import { updatePropertySettings } from "../services/settings.js";
import { createDb } from "../db/knex.js";
import { clearDemoData } from "../db/clear-demo-data.js";
import { requireRole } from "./auth.js";
import { HttpError, idParam, num, parse, route } from "./http.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "is not a real date");
const id = z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d{0,17}$/).transform(Number)]);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "must be 8–64 letters, digits, - or _");
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "must be a decimal amount like 1500.00").refine((s) => Number(s) > 0, "must be positive");

const idDocumentType = z.enum(["aadhaar", "passport", "driving_licence"]);

const guestBody = z.object({
  fullName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).optional().nullable(),
  idDocumentType: idDocumentType.optional().nullable(),
  idDocumentNumber: z.string().trim().min(4).max(64).optional().nullable(),
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

const guestPatch = z.object({
  fullName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).optional().nullable().or(z.literal("")),
  idDocumentType: idDocumentType.optional().nullable(),
  idDocumentNumber: z.string().trim().min(4).max(64).optional().nullable().or(z.literal("")),
}).strict().refine((b) => Object.keys(b).length > 0, "no changes were provided");

const bookingPatch = z.object({
  checkInDate: date.optional(),
  checkOutDate: date.optional(),
  guestsCount: z.number().int().min(1).max(20).optional(),
  expectedArrivalTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
}).strict().refine((b) => Object.keys(b).length > 0, "no changes were provided");
const cancelBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

const roomCreate = z.object({ number: z.string().trim().regex(/^[A-Za-z0-9-]{1,10}$/, "must be 1-10 letters, digits or hyphens"), roomTypeId: id, floor: z.number().int().min(-5).max(200).optional().nullable() }).strict();
const roomPatch = z.object({ roomTypeId: id.optional(), floor: z.number().int().min(-5).max(200).optional().nullable() }).strict().refine((b) => Object.keys(b).length > 0, "no changes were provided");
const maintenanceBody = z.object({ outOfService: z.boolean(), reason: z.string().trim().max(200).optional() }).strict();
const housekeepingBody = z.object({ status: z.enum(["clean", "dirty", "inspecting"]) }).strict();

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
    const guestId = await createGuest(db, req.actor!, {
      fullName: b.fullName,
      email: b.email ?? null,
      phone: b.phone ?? null,
      countryCode: b.countryCode ?? null,
      idDocumentType: b.idDocumentType ?? null,
      idDocumentNumber: b.idDocumentNumber ?? null,
    });
    res.status(201).json({ id: String(guestId) });
  }));

  r.patch("/guests/:id", route(async (req, res) => {
    const b = parse(guestPatch, req.body);
    const guestId = idParam(req);
    await updateGuest(db, req.actor!, guestId, {
      ...(b.fullName !== undefined ? { fullName: b.fullName } : {}), ...(b.email !== undefined ? { email: b.email || null } : {}),
      ...(b.phone !== undefined ? { phone: b.phone } : {}), ...(b.countryCode !== undefined ? { countryCode: b.countryCode || null } : {}),
      ...(b.idDocumentType !== undefined ? { idDocumentType: b.idDocumentType } : {}),
      ...(b.idDocumentNumber !== undefined ? { idDocumentNumber: b.idDocumentNumber || null } : {}),
    });
    res.json({ id: String(guestId) });
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

  r.patch("/bookings/:id", route(async (req, res) => {
    const b = parse(bookingPatch, req.body);
    const bookingId = idParam(req);
    const r2 = await updateBooking(db, req.actor!, bookingId, {
      ...(b.checkInDate !== undefined ? { checkInDate: b.checkInDate } : {}), ...(b.checkOutDate !== undefined ? { checkOutDate: b.checkOutDate } : {}),
      ...(b.guestsCount !== undefined ? { guestsCount: b.guestsCount } : {}), ...(b.expectedArrivalTime !== undefined ? { expectedArrivalTime: b.expectedArrivalTime } : {}),
    });
    res.json({ id: String(bookingId), nights: r2.nights, total: num(r2.total) });
  }));

  /** Cancelling never refunds or penalises by itself: money received stays as the booking's held advance (R20). */
  r.post("/bookings/:id/cancel", route(async (req, res) => {
    const b = parse(cancelBody, req.body);
    const bookingId = idParam(req);
    await cancelBooking(db, req.actor!, { bookingId, reason: b.reason });
    const v = await db("v_booking_balance").where({ booking_id: bookingId }).first("advance_held");
    res.json({ id: String(bookingId), status: "cancelled", advanceHeld: num(v?.advance_held) });
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
    for (const invPaid of out.newlyPaidInvoices) {
      publishPaymentPaid({
        invoiceId: String(invPaid.invoiceId),
        invoiceNumber: invPaid.invoiceNumber,
        guestName: invPaid.guestName,
        bookingReference: invPaid.bookingReference,
      });
    }
    const inv = out.invoiceId ? await db("v_invoice_balance").where({ invoice_id: out.invoiceId }).first("gross_amount", "balance_due") : null;
    res.json({ id: String(bookingId), status: "checked_out", invoice: out.invoiceId ? { id: String(out.invoiceId), number: out.invoiceNumber, amount: num(inv?.gross_amount), balanceDue: num(inv?.balance_due) } : null });
  }));

  // Rooms: structure and maintenance are admin-only (section 10, Q26); housekeeping is front desk and above (R21).
  r.post("/rooms", requireRole("admin"), route(async (req, res) => {
    const b = parse(roomCreate, req.body);
    const roomId = await createRoom(db, req.actor!, { number: b.number, roomTypeId: b.roomTypeId, floor: b.floor ?? null });
    res.status(201).json({ id: String(roomId) });
  }));
  r.patch("/rooms/:id", requireRole("admin"), route(async (req, res) => {
    const b = parse(roomPatch, req.body);
    const roomId = idParam(req);
    await updateRoom(db, req.actor!, roomId, { ...(b.roomTypeId !== undefined ? { roomTypeId: b.roomTypeId } : {}), ...(b.floor !== undefined ? { floor: b.floor } : {}) });
    res.json({ id: String(roomId) });
  }));
  r.post("/rooms/:id/maintenance", requireRole("admin"), route(async (req, res) => {
    const b = parse(maintenanceBody, req.body);
    const roomId = idParam(req);
    await setMaintenance(db, req.actor!, roomId, { outOfService: b.outOfService, ...(b.reason !== undefined ? { reason: b.reason } : {}) });
    res.json({ id: String(roomId), outOfService: b.outOfService });
  }));
  /** Soft-delete: room stays in DB for history; shown as out of service / removed. */
  const removeBody = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
  r.post("/rooms/:id/remove", requireRole("admin"), route(async (req, res) => {
    const b = parse(removeBody, req.body);
    const roomId = idParam(req);
    await removeRoom(db, req.actor!, roomId, b.reason);
    res.json({ id: String(roomId), outOfService: true });
  }));
  r.post("/rooms/:id/housekeeping", route(async (req, res) => {
    const b = parse(housekeepingBody, req.body);
    const roomId = idParam(req);
    await setHousekeeping(db, req.actor!, roomId, b.status);
    res.json({ id: String(roomId), housekeeping: b.status });
  }));

  r.post("/payments", route(async (req, res) => {
    const b = parse(paymentBody, req.body);
    // Ownership is checked by the service (the booking must belong to the caller's property).
    const result = await recordPayment(db, req.actor!, { bookingId: b.bookingId, method: b.method, amount: b.amount, status: "success", idempotencyKey: b.idempotencyKey });
    // Publish only after the payment transaction has committed (recordPayment awaits inTx).
    for (const inv of result.newlyPaidInvoices) {
      publishPaymentPaid({
        invoiceId: String(inv.invoiceId),
        invoiceNumber: inv.invoiceNumber,
        guestName: inv.guestName,
        bookingReference: inv.bookingReference,
      });
    }
    const row = await db("payments").where({ id: result.paymentId }).first("reference", "amount");
    if (!row) throw new HttpError(500, "INTERNAL", "Payment not found after recording");
    res.status(201).json({ id: String(result.paymentId), reference: row.reference, amount: num(row.amount) });
  }));

  /** Admin-only controlled refunds (Q8/Q28). Amounts are never edited on the original payment. */
  const refundBody = z.object({
    amount: money,
    reason: z.string().trim().min(1).max(500),
    idempotencyKey,
  }).strict();

  r.post("/payments/:id/refund", requireRole("admin"), route(async (req, res) => {
    const b = parse(refundBody, req.body);
    const paymentId = idParam(req);
    const refundId = await requestRefund(db, req.actor!, { paymentId, amount: b.amount, reason: b.reason, idempotencyKey: b.idempotencyKey });
    const row = await db("refunds").where({ id: refundId }).first("reference", "amount", "status");
    if (!row) throw new HttpError(500, "INTERNAL", "Refund not found after requesting");
    res.status(201).json({ id: String(refundId), reference: row.reference, amount: num(row.amount), status: row.status });
  }));

  r.post("/refunds/:id/complete", requireRole("admin"), route(async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const refundId = idParam(req);
    await completeRefund(db, req.actor!, refundId);
    res.json({ id: String(refundId), status: "completed" });
  }));

  r.post("/refunds/:id/reject", requireRole("admin"), route(async (req, res) => {
    parse(emptyBody, req.body ?? {});
    const refundId = idParam(req);
    await rejectRefund(db, req.actor!, refundId);
    res.json({ id: String(refundId), status: "rejected" });
  }));

  /** Admin void: number is kept forever; amounts on the issued invoice are never edited. */
  const voidBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
  r.post("/invoices/:id/void", requireRole("admin"), route(async (req, res) => {
    const b = parse(voidBody, req.body);
    const invoiceId = idParam(req);
    await voidInvoice(db, req.actor!, { invoiceId, reason: b.reason });
    res.json({ id: String(invoiceId), status: "void" });
  }));

  /** Admin property details only (Q29). Currency, timezone, country and tax are not accepted. */
  const timeHm = z.string().regex(/^\d{2}:\d{2}$/, "must be HH:MM");
  const settingsPatch = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    phone: z.string().trim().max(40).optional().nullable().or(z.literal("")),
    email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
    checkInTime: timeHm.optional(),
    checkOutTime: timeHm.optional(),
  }).strict().refine((b) => Object.keys(b).length > 0, "no changes were provided");

  r.patch("/settings", requireRole("admin"), route(async (req, res) => {
    const b = parse(settingsPatch, req.body);
    await updatePropertySettings(db, req.actor!, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.address !== undefined ? { address: b.address } : {}),
      ...(b.phone !== undefined ? { phone: b.phone || null } : {}),
      ...(b.email !== undefined ? { email: b.email || null } : {}),
      ...(b.checkInTime !== undefined ? { checkInTime: b.checkInTime } : {}),
      ...(b.checkOutTime !== undefined ? { checkOutTime: b.checkOutTime } : {}),
    });
    res.json({ ok: true });
  }));

  /**
   * Demo only: wipe guests/bookings/money; keep logins; restore 10 rooms.
   * Requires ALLOW_DEMO_CLEAR=true and migrator DB credentials on the API process.
   */
  r.post("/demo/clear", requireRole("admin"), route(async (req, res) => {
    parse(emptyBody, req.body ?? {});
    if (process.env["ALLOW_DEMO_CLEAR"] !== "true") {
      throw new HttpError(403, "FORBIDDEN", "Demo clear is disabled on this server.");
    }
    const code = process.env["HOTEL_SLUG"] || "demo-hotel";
    const migrator = createDb("migrator");
    try {
      const result = await clearDemoData(migrator, code);
      res.json({ ok: true, rooms: result.rooms });
    } finally {
      await migrator.destroy();
    }
  }));

  return r;
}
