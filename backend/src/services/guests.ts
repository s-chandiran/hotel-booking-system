/**
 * Guest records (data-model.md §5). A guest is the person staying, not a login. Personal fields are
 * never written to audit details or logs. Retention and ID documents wait for Q19.
 */
import type { Db } from "../db/knex.js";
import { assert } from "../domain/errors.js";
import { audit, inTx, insertId, type Actor } from "./context.js";

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
