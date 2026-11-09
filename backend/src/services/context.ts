import type { Knex } from "knex";
import type { Db } from "../db/knex.js";

/** Who is acting, and for which property. userId is null for system or seed actions. */
export interface Actor {
  propertyId: number;
  userId: number | null;
}

/**
 * Runs fn in a transaction. When db is already a transaction this becomes a savepoint (the seed relies on that).
 *
 * Top-level transactions run at READ COMMITTED (DATABASE.md §9a). Under MySQL's default REPEATABLE READ,
 * the locking reads that find no rows (e.g. a booking's invoices before the first one) take gap locks, and
 * concurrent inserts into neighbouring gaps deadlock: the Gate 3b P0 test issuing 10 invoices in parallel
 * lost 9 to ER_LOCK_DEADLOCK. Correctness does not need gap locks: every financial event locks its booking
 * row first, invoice numbers lock their sequence row, and room checks lock the room row, so the rows
 * those events insert are already serialised. All limit checks use locking reads, which see the latest
 * committed rows at either level.
 */
export function inTx<T>(db: Db, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  if (db.isTransaction) return db.transaction(fn);
  return db.transaction(fn, { isolationLevel: "read committed" });
}

/** UTC timestamp for DATETIME(3) columns. */
export const nowUtc = (): Date => new Date();

export interface AuditInput {
  entityType: string;
  entityId: number | null;
  action: string;
  fromState?: string | null;
  toState?: string | null;
  /** Ids, amounts and codes only. Never PII, passwords, tokens or card data. */
  details?: Record<string, string | number | boolean | null>;
}

export async function audit(trx: Knex.Transaction, actor: Actor, a: AuditInput): Promise<void> {
  await trx("audit_events").insert({
    property_id: actor.propertyId,
    actor_user_id: actor.userId,
    entity_type: a.entityType,
    entity_id: a.entityId,
    action: a.action,
    from_state: a.fromState ?? null,
    to_state: a.toState ?? null,
    details: a.details ? JSON.stringify(a.details) : null,
  });
}

export async function insertId(q: Promise<number[]>): Promise<number> {
  const [id] = await q;
  if (id === undefined) throw new Error("Insert returned no id");
  return id;
}
