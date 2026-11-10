/**
 * Guest records (data-model.md §5). A guest is the person staying, not a login. Personal fields are
 * never written to audit details or logs. ID document numbers are stored for police/front-desk
 * reference; list APIs return a masked form. Guests are not deleted — retain ≥ 1 year.
 */
import type { Db } from "../db/knex.js";
import { assert } from "../domain/errors.js";
import { audit, inTx, insertId, nowUtc, type Actor } from "./context.js";

export type IdDocumentType = "aadhaar" | "passport" | "driving_licence";

export interface CreateGuestInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  countryCode?: string | null;
  idDocumentType?: IdDocumentType | null;
  idDocumentNumber?: string | null;
}

function normalizeIdNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const n = raw.replace(/\s+/g, "").trim();
  return n.length === 0 ? null : n;
}

function last4(number: string | null): string | null {
  if (!number || number.length < 4) return null;
  return number.slice(-4);
}

function assertIdPair(type: IdDocumentType | null | undefined, number: string | null | undefined): void {
  const hasType = type != null;
  const hasNumber = number != null && number.length > 0;
  if (hasType !== hasNumber) {
    assert(false, "INVALID_GUEST", "ID document type and number must be provided together");
  }
  if (hasNumber) {
    assert(number!.length >= 4 && number!.length <= 64, "INVALID_GUEST", "ID document number must be 4–64 characters");
  }
}

export function createGuest(db: Db, actor: Actor, input: CreateGuestInput): Promise<number> {
  return inTx(db, async (trx) => {
    const fullName = input.fullName.trim();
    assert(fullName.length > 0 && fullName.length <= 160, "INVALID_GUEST", "Guest name is required (max 160 characters)");
    const country = input.countryCode?.trim().toUpperCase() || null;
    assert(country === null || /^[A-Z]{2}$/.test(country), "INVALID_GUEST", "Country must be a 2-letter code");
    const idDocumentType = input.idDocumentType ?? null;
    const idDocumentNumber = normalizeIdNumber(input.idDocumentNumber);
    assertIdPair(idDocumentType, idDocumentNumber);
    const id = await insertId(
      trx("guests").insert({
        property_id: actor.propertyId,
        full_name: fullName,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        country_code: country,
        id_document_type: idDocumentType,
        id_document_number: idDocumentNumber,
        id_document_number_last4: last4(idDocumentNumber),
        is_vip: false,
        created_by_user_id: actor.userId,
      }),
    );
    // Never put ID numbers in audit details.
    await audit(trx, actor, {
      entityType: "guest",
      entityId: id,
      action: "create",
      details: idDocumentType ? { fields: "id_document" } : undefined,
    });
    return id;
  });
}

export interface UpdateGuestInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  countryCode?: string | null;
  idDocumentType?: IdDocumentType | null;
  idDocumentNumber?: string | null;
}

/**
 * Corrects a guest's contact details (Q27 working assumption). `is_vip` and the property are not editable here.
 * The audit entry names the changed fields only, never their values (they are personal data).
 */
export function updateGuest(db: Db, actor: Actor, guestId: number, input: UpdateGuestInput): Promise<void> {
  return inTx(db, async (trx) => {
    const guest = await trx("guests").where({ id: guestId, property_id: actor.propertyId }).forUpdate().first("id", "id_document_type", "id_document_number");
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

    const touchingId = input.idDocumentType !== undefined || input.idDocumentNumber !== undefined;
    if (touchingId) {
      const nextType =
        input.idDocumentType !== undefined ? input.idDocumentType : ((guest.id_document_type as IdDocumentType | null) ?? null);
      const nextNumber =
        input.idDocumentNumber !== undefined
          ? normalizeIdNumber(input.idDocumentNumber)
          : ((guest.id_document_number as string | null) ?? null);
      assertIdPair(nextType, nextNumber);
      patch["id_document_type"] = nextType;
      patch["id_document_number"] = nextNumber;
      patch["id_document_number_last4"] = last4(nextNumber);
    }

    const fields = Object.keys(patch);
    assert(fields.length > 0, "NOTHING_TO_CHANGE", "No changes were provided");
    await trx("guests").where({ id: guestId }).update({ ...patch, updated_at: nowUtc() });
    const auditFields = fields
      .map((f) => (f.startsWith("id_document") ? "id_document" : f))
      .filter((v, i, a) => a.indexOf(v) === i);
    await audit(trx, actor, { entityType: "guest", entityId: guestId, action: "update", details: { fields: auditFields.join(",") } });
  });
}

/** Mask for UI lists — never return the full number from list endpoints. */
export function maskIdNumber(last4Value: string | null | undefined): string {
  if (!last4Value) return "";
  return `••••${last4Value}`;
}
