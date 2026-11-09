/**
 * Authentication and authorisation (data-model.md §10, fixed decision D1).
 *  - POST /api/auth/login checks the bcrypt hash and returns { token, user }. The BFF puts the token in
 *    the HttpOnly cookie; it never reaches browser JavaScript.
 *  - Tokens are HS256 JWTs with exp. Verification pins the algorithm and checks the signature and expiry.
 *  - Every request reloads the account, so a deactivated user or a changed role takes effect at once.
 *  - Deny by default: every /api route except login sits behind authRequired; finance and admin routes
 *    add requireRole.
 */
import bcrypt from "bcryptjs";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import type { Knex } from "knex";
import { z } from "zod";
import type { Actor } from "../services/context.js";
import type { ApiConfig } from "./config.js";
import { HttpError, parse, route } from "./http.js";

export type Role = "front_desk" | "admin" | "super_admin";
const RANK: Record<Role, number> = { front_desk: 1, admin: 2, super_admin: 3 };

export interface SessionUser {
  id: number;
  username: string;
  full_name: string | null;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
    actor?: Actor;
  }
}

interface Claims {
  sub: string;
  pid: number;
}

/** Compared against when the username doesn't exist, so timing doesn't reveal which usernames exist. */
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

async function loadUser(db: Knex, propertyId: number, where: { id: number } | { username: string }): Promise<(SessionUser & { password_hash: string; is_active: number | boolean }) | undefined> {
  return db("user_accounts as u")
    .leftJoin("staff_members as s", "s.id", "u.staff_member_id")
    .where({ "u.property_id": propertyId, ...("id" in where ? { "u.id": where.id } : { "u.username": where.username }) })
    .first("u.id", "u.username", "u.role", "u.password_hash", "u.is_active", "s.full_name");
}

const publicUser = (u: SessionUser): SessionUser => ({ id: u.id, username: u.username, full_name: u.full_name ?? null, role: u.role });

// ---------- login throttling (per property + username + client address, in memory) ----------

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; first: number }>();
const throttleKey = (pid: number, username: string, req: Request) => `${pid}|${username.toLowerCase()}|${req.ip ?? ""}`;
function isThrottled(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return f.count >= MAX_FAILURES;
}
function noteFailure(key: string): void {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
/** Test hook. */
export const resetLoginThrottle = (): void => failures.clear();

const loginBody = z.object({ username: z.string().trim().min(1).max(128), password: z.string().min(1).max(256) }).strict();
const slugHeader = z.string().regex(/^[a-z0-9-]{1,40}$/);

export function loginHandler(db: Knex, config: ApiConfig): RequestHandler {
  return route(async (req, res) => {
    const body = parse(loginBody, req.body);
    const slugRaw = req.get("x-hotel-slug");
    const slug = slugRaw === undefined ? config.defaultHotelSlug : parse(slugHeader, slugRaw);
    const property = await db("properties").where({ code: slug }).first("id");
    const invalid = new HttpError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    if (!property) {
      await bcrypt.compare(body.password, DUMMY_HASH);
      throw invalid;
    }
    const pid = property.id as number;
    const key = throttleKey(pid, body.username, req);
    if (isThrottled(key)) throw new HttpError(429, "RATE_LIMITED", "Too many login attempts. Please wait and try again.");

    const user = await loadUser(db, pid, { username: body.username });
    const ok = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) {
      noteFailure(key);
      throw invalid;
    }
    failures.delete(key);
    await db("user_accounts").where({ id: user.id }).update({ last_login_at: new Date() });
    const token = jwt.sign({ pid } satisfies Omit<Claims, "sub">, config.jwtSecret, { algorithm: "HS256", subject: String(user.id), expiresIn: config.jwtTtlSeconds });
    res.json({ token, user: publicUser(user) });
  });
}

async function verifyRequest(db: Knex, config: ApiConfig, req: Request): Promise<void> {
  const header = req.get("authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  const unauthorized = new HttpError(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.");
  if (!m) throw unauthorized;
  let claims: Claims;
  try {
    const v = jwt.verify(m[1]!, config.jwtSecret, { algorithms: ["HS256"] });
    if (typeof v === "string" || typeof v.sub !== "string" || typeof v["pid"] !== "number" || typeof v.exp !== "number") throw new Error("claims");
    claims = { sub: v.sub, pid: v["pid"] as number };
  } catch {
    throw unauthorized;
  }
  const user = await loadUser(db, claims.pid, { id: Number(claims.sub) });
  if (!user || !user.is_active) throw unauthorized;
  req.user = publicUser(user);
  req.actor = { propertyId: claims.pid, userId: user.id };
}

/** Verifies the Bearer JWT (HS256 only, signature + exp) and loads the account; 401 otherwise. */
export const authenticate =
  (db: Knex, config: ApiConfig): RequestHandler =>
  (req, _res, next) => {
    verifyRequest(db, config, req).then(() => next(), next);
  };

export const requireRole =
  (min: Role): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || RANK[role] < RANK[min]) return next(new HttpError(403, "FORBIDDEN", "You do not have permission for this action."));
    next();
  };

export const meHandler: RequestHandler = (req, res) => {
  res.json({ user: req.user });
};

export const isAtLeast = (user: SessionUser | undefined, min: Role): boolean => !!user && RANK[user.role] >= RANK[min];
