/**
 * Guest records (data-model.md §5). A guest is the person staying, not a login. Personal fields are
 * never written to audit details or logs. Retention and ID documents wait for Q19.
 */
import type { Db } from "../db/knex.js";
import { assert } from "../domain/errors.js";
import { audit, inTx, insertId, nowUtc, type Actor } from "./context.js";

export interface CreateGuestInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  countryCode?: string | null;
}

export function createGuest(db: Db, actor: Actor, input: CreateGuestInput): Promise<number> {
  return inTx(db, async (trx) => {
    const fullName = input.fullName.trim();
    assert(fullName.length > 0 && fullName.length <= 160, "INVALID_GUEST", "Guest name is required (max 160 characters)");
    const country = input.countryCode?.trim().toUpperCase() || null;
    assert(country === null || /^[A-Z]{2}$/.test(country), "INVALID_GUEST", "Country must be a 2-letter code");
    const id = await insertId(
      trx("guests").insert({
        property_id: actor.propertyId, full_name: fullName, email: input.email?.trim() || null, phone: input.phone?.trim() || null,
        country_code: country, is_vip: false, created_by_user_id: actor.userId,
      }),
    );
    await audit(trx, actor, { entityType: "guest", entityId: id, action: "create" });
    return id;
  });
}

export interface UpdateGuestInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  countryCode?: string | null;
}

/**
 * Corrects a guest's contact details (Q27 working assumption). `is_vip` and the property are not editable here.
 * The audit entry names the changed fields only, never their values (they are personal data).
 */
export function updateGuest(db: Db, actor: Actor, guestId: number, input: UpdateGuestInput): Promise<void> {
  return inTx(db, async (trx) => {
    const guest = await trx("guests").where({ id: guestId, property_id: actor.propertyId }).forUpdate().first("id");
    assert(guest, "GUEST_NOT_FOUND", "Guest not found");
    const patch: Record<string, unknown> = {};
    if (input.fullName !== undefined) {
      const name = input.fullName.trim();
      assert(name.length > 0 && name.length <= 160, "INVALID_GUEST", "Guest name is required (max 160 characters)");
      patch["full_name"] = name;
    }
    if (input.email !== undefined) patch["email"] = input.email?.trim() || null;
    if (input.phone !== undefined) patch["phone"] = input.phone?.trim() || null;
    if (input.countryCode !== undefined) {
      const c = input.countryCode?.trim().toUpperCase() || null;
      assert(c === null || /^[A-Z]{2}$/.test(c), "INVALID_GUEST", "Country must be a 2-letter code");
      patch["country_code"] = c;
    }
    const fields = Object.keys(patch);
    assert(fields.length > 0, "NOTHING_TO_CHANGE", "No changes were provided");
    await trx("guests").where({ id: guestId }).update({ ...patch, updated_at: nowUtc() });
    await audit(trx, actor, { entityType: "guest", entityId: guestId, action: "update", details: { fields: fields.join(",") } });
  });
}
