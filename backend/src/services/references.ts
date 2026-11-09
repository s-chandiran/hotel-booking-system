/**
 * Server-generated references (D-E). Booking `BK-<n>` and payment `PAY-<n>` come from the property's
 * number_sequences row, locked FOR UPDATE inside the caller's transaction, so concurrent creates never
 * get the same value. Rolled-back transactions return the value, but gaps are allowed for these (Q11).
 * Lock order: the sequence row is always the last lock a transaction takes.
 */
import type { Knex } from "knex";
import { assert } from "../domain/errors.js";
import { nowUtc, type Actor } from "./context.js";

export async function nextReference(trx: Knex.Transaction, actor: Actor, kind: "booking" | "payment" | "refund"): Promise<string> {
  const seq = await trx("number_sequences").where({ property_id: actor.propertyId, document_type: kind }).forUpdate().first("id", "prefix", "next_value");
  assert(seq, "SEQUENCE_NOT_CONFIGURED", `No ${kind} reference sequence for this property`);
  const n = seq.next_value as number;
  await trx("number_sequences").where({ id: seq.id }).update({ next_value: n + 1, updated_at: nowUtc() });
  return `${seq.prefix as string}${n}`;
}

/** MySQL duplicate-key error on the named unique index. */
export const isDuplicateOn = (e: unknown, index: string): boolean => {
  const err = e as { code?: string; sqlMessage?: string };
  return err.code === "ER_DUP_ENTRY" && (err.sqlMessage ?? "").includes(index);
};
