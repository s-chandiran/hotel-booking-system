/**
 * Property settings (Q29). Admins may change name, address, phone, email and check-in/out times.
 * Currency, timezone and country are not editable here. Tax components stay read-only until Q6.
 * Audit records old and new values for every changed field (hotel contacts, not guest PII).
 */
import type { Db } from "../db/knex.js";
import { assert } from "../domain/errors.js";
import { audit, inTx, nowUtc, type Actor } from "./context.js";

export interface UpdatePropertyInput {
  name?: string;
  address?: string;
  phone?: string | null;
  email?: string | null;
  /** HH:MM */
  checkInTime?: string;
  /** HH:MM */
  checkOutTime?: string;
}

const hhmm = (t: unknown): string => {
  if (t == null) return "";
  if (typeof t === "string") return t.slice(0, 5);
  if (t instanceof Date) {
    const h = String(t.getUTCHours()).padStart(2, "0");
    const m = String(t.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  return String(t).slice(0, 5);
};

const TIME = /^\d{2}:\d{2}$/;

export function updatePropertySettings(db: Db, actor: Actor, input: UpdatePropertyInput): Promise<void> {
  return inTx(db, async (trx) => {
    const row = await trx("properties").where({ id: actor.propertyId }).forUpdate()
      .first("id", "name", "address", "phone", "email", "check_in_time", "check_out_time");
    assert(row, "PROPERTY_NOT_FOUND", "Property not found");

    const patch: Record<string, unknown> = {};
    const details: Record<string, string | number | boolean | null> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      assert(name.length > 0 && name.length <= 160, "INVALID_SETTINGS", "Property name is required (max 160 characters)");
      if (name !== String(row.name)) {
        patch["name"] = name;
        details["name_from"] = String(row.name);
        details["name_to"] = name;
      }
    }
    if (input.address !== undefined) {
      const address = input.address.trim();
      assert(address.length > 0 && address.length <= 500, "INVALID_SETTINGS", "Address is required (max 500 characters)");
      if (address !== String(row.address)) {
        patch["address"] = address;
        details["address_from"] = String(row.address);
        details["address_to"] = address;
      }
    }
    if (input.phone !== undefined) {
      const phone = input.phone?.trim() || null;
      assert(phone === null || phone.length <= 40, "INVALID_SETTINGS", "Phone is too long");
      const prev = (row.phone as string | null) ?? null;
      if (phone !== prev) {
        patch["phone"] = phone;
        details["phone_from"] = prev;
        details["phone_to"] = phone;
      }
    }
    if (input.email !== undefined) {
      const email = input.email?.trim() || null;
      assert(email === null || email.length <= 254, "INVALID_SETTINGS", "Email is too long");
      const prev = (row.email as string | null) ?? null;
      if (email !== prev) {
        patch["email"] = email;
        details["email_from"] = prev;
        details["email_to"] = email;
      }
    }
    if (input.checkInTime !== undefined) {
      assert(TIME.test(input.checkInTime), "INVALID_SETTINGS", "Check-in time must be HH:MM");
      const prev = hhmm(row.check_in_time);
      if (input.checkInTime !== prev) {
        patch["check_in_time"] = `${input.checkInTime}:00`;
        details["check_in_from"] = prev;
        details["check_in_to"] = input.checkInTime;
      }
    }
    if (input.checkOutTime !== undefined) {
      assert(TIME.test(input.checkOutTime), "INVALID_SETTINGS", "Check-out time must be HH:MM");
      const prev = hhmm(row.check_out_time);
      if (input.checkOutTime !== prev) {
        patch["check_out_time"] = `${input.checkOutTime}:00`;
        details["check_out_from"] = prev;
        details["check_out_to"] = input.checkOutTime;
      }
    }

    const fields = Object.keys(patch);
    assert(fields.length > 0, "NOTHING_TO_CHANGE", "No changes were provided");
    details["fields"] = fields.join(",");

    await trx("properties").where({ id: actor.propertyId }).update({ ...patch, updated_at: nowUtc() });
    await audit(trx, actor, {
      entityType: "property",
      entityId: actor.propertyId,
      action: "update",
      details,
    });
  });
}
