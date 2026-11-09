/**
 * BFF configuration — server-only. Read from the Node process environment at request time
 * (never from VITE_* / import.meta.env, which is embedded into the browser bundle).
 *
 * Fails closed: an invalid or missing upstream makes every /api and /bff request return 503
 * instead of guessing a destination.
 */

export interface BffConfig {
  /** Origin of the Express API, e.g. http://host.docker.internal:5000 — no path, no query. */
  upstream: string;
  /** Exact-match origins allowed to make state-changing requests. */
  allowedOrigins: ReadonlySet<string>;
  /** Secure cookie (and the __Host- prefix). */
  secureCookie: boolean;
  /** Optional property slug sent as X-Hotel-Slug on login (multi-property backend). */
  hotelSlug: string | null;
}

export type ConfigResult = { ok: true; config: BffConfig } | { ok: false; reason: string };

export type Env = Record<string, string | undefined>;

/** Dev-only defaults: the local origins this app is served from. Production must set ALLOWED_ORIGINS. */
export const DEV_DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function readProcessEnv(): Env {
  const proc = (globalThis as { process?: { env?: Env } }).process;
  return proc?.env ?? {};
}

function parseOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    // Only a bare origin is accepted — a path/query/hash would be silently dropped otherwise.
    if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function loadConfig(env: Env = readProcessEnv()): ConfigResult {
  const isProd = env["NODE_ENV"] === "production";

  const rawUpstream = (env["API_UPSTREAM_URL"] ?? "").trim();
  if (!rawUpstream) return { ok: false, reason: "API_UPSTREAM_URL is not set" };
  const upstream = parseOrigin(rawUpstream.replace(/\/+$/, ""));
  if (!upstream) return { ok: false, reason: "API_UPSTREAM_URL must be a bare http(s) origin" };

  const rawOrigins = (env["ALLOWED_ORIGINS"] ?? "").trim();
  let origins: string[];
  if (rawOrigins) {
    origins = [];
    for (const part of rawOrigins.split(",")) {
      const p = part.trim();
      if (!p) continue;
      const o = parseOrigin(p);
      if (!o) return { ok: false, reason: `ALLOWED_ORIGINS contains an invalid origin` };
      origins.push(o);
    }
    if (origins.length === 0) return { ok: false, reason: "ALLOWED_ORIGINS is empty" };
  } else if (isProd) {
    return { ok: false, reason: "ALLOWED_ORIGINS is required in production" };
  } else {
    origins = DEV_DEFAULT_ORIGINS;
  }

  const rawSecure = (env["SESSION_COOKIE_SECURE"] ?? "").trim().toLowerCase();
  let secureCookie: boolean;
  if (rawSecure === "true" || rawSecure === "1") secureCookie = true;
  else if (rawSecure === "false" || rawSecure === "0") secureCookie = false;
  else if (rawSecure === "") secureCookie = isProd;
  else return { ok: false, reason: "SESSION_COOKIE_SECURE must be true or false" };

  const rawSlug = (env["HOTEL_SLUG"] ?? "").trim().toLowerCase();
  let hotelSlug: string | null = null;
  if (rawSlug) {
    if (!SLUG_RE.test(rawSlug)) return { ok: false, reason: "HOTEL_SLUG is invalid" };
    hotelSlug = rawSlug;
  }

  return {
    ok: true,
    config: { upstream, allowedOrigins: new Set(origins), secureCookie, hotelSlug },
  };
}
