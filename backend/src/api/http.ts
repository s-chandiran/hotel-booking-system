/**
 * HTTP plumbing shared by every route: the `{ error: { code, message } }` format, the status for each
 * domain error, request validation, and an async wrapper. Logs carry codes, methods and paths only:
 * never bodies, tokens, passwords or guest data.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { DomainError } from "../domain/errors.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const STATUS: Record<string, number> = {
  BOOKING_NOT_FOUND: 404, GUEST_NOT_FOUND: 404, ROOM_NOT_FOUND: 404, ROOM_TYPE_NOT_FOUND: 404, PAYMENT_NOT_FOUND: 404, INVOICE_NOT_FOUND: 404,
  INVALID_TRANSITION: 409, ROOM_UNAVAILABLE: 409, ROOM_OCCUPIED: 409, ROOM_OUT_OF_SERVICE: 409, ROOM_TYPE_MISMATCH: 409, STAY_INVOICE_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SEQUENCE_NOT_CONFIGURED: 500, TAX_CONFIG_AMBIGUOUS: 500, ALLOCATION_RELEASE_FAILED: 500,
};

export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export const route =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Last middleware. Domain errors keep their stable code; anything unexpected becomes a generic 500. */
export function errorHandler(log: (line: string) => void) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
    if (err instanceof DomainError) return sendError(res, STATUS[err.code] ?? 422, err.code, err.message);
    const e = err as { type?: string; code?: string };
    if (e.type === "entity.parse.failed") return sendError(res, 400, "VALIDATION", "The request body is not valid JSON");
    if (e.type === "entity.too.large") return sendError(res, 413, "PAYLOAD_TOO_LARGE", "The request body is too large");
    log(`500 ${req.method} ${req.path} ${e.code ?? (err instanceof Error ? err.name : "unknown")}`);
    sendError(res, 500, "INTERNAL", "Something went wrong. Please try again.");
  };
}

/**
 * Validates with a strict schema: unknown fields are refused, so a client can never slip in a price,
 * a reference, a status or a property id.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(400, "VALIDATION", `${where}${first?.message ?? "Invalid request"}`);
  }
  return r.data;
}

export const idParam = (req: Request, name = "id"): number => {
  const raw = req.params[name];
  if (typeof raw !== "string" || !/^[1-9]\d{0,17}$/.test(raw)) throw new HttpError(404, "NOT_FOUND", "Not found");
  return Number(raw);
};

/** DECIMAL string → number for display fields of the existing frontend types. Money math stays server-side in minor units. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
