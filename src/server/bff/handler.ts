/**
 * Backend-for-frontend: the browser talks only to this same-origin server; this server talks to
 * the Express API with `Authorization: Bearer <jwt>`. The JWT lives in an HttpOnly cookie and is
 * never returned in a response body, logged, or exposed to browser JavaScript.
 *
 *   POST /bff/auth/login   → upstream POST /api/auth/login, sets the session cookie, returns { user }
 *   POST /bff/auth/logout  → clears the session cookie
 *   GET  /bff/auth/me      → upstream GET /api/auth/me
 *   *    /api/...          → allowlisted proxy to the same path upstream
 *
 * Returns null for any other path so the normal TanStack Start handler serves it.
 */

import { isAllowed } from "./allowlist";
import { loadConfig, type BffConfig, type Env, readProcessEnv } from "./config";
import {
  clearSession,
  isWellFormedJwt,
  readSession,
  serializeSession,
  sessionMaxAge,
} from "./cookies";
import { checkCsrf, isStateChanging } from "./csrf";

export const MAX_BODY_BYTES = 1024 * 1024;
export const UPSTREAM_TIMEOUT_MS = 15_000;

export interface BffDeps {
  fetch: typeof fetch;
  env: Env;
  /** Receives short, token-free diagnostic codes only. */
  log: (message: string) => void;
}

const defaultDeps = (): BffDeps => ({
  fetch: (...args) => globalThis.fetch(...args),
  env: readProcessEnv(),
  log: (m) => console.warn(`[bff] ${m}`),
});

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store, private",
  vary: "Cookie",
  "x-content-type-options": "nosniff",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, string> = {},
) {
  return json(status, { error: { code, message } }, extra);
}

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

export function isBffPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/bff/");
}

async function readBody(
  request: Request,
): Promise<{ ok: true; body: string } | { ok: false; res: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      res: errorResponse(413, "PAYLOAD_TOO_LARGE", "Request body is too large."),
    };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      res: errorResponse(413, "PAYLOAD_TOO_LARGE", "Request body is too large."),
    };
  }
  if (text.length > 0) {
    const ct = request.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("application/json")) {
      return {
        ok: false,
        res: errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Expected a JSON body."),
      };
    }
  }
  return { ok: true, body: text };
}

async function callUpstream(
  deps: BffDeps,
  config: BffConfig,
  path: string,
  init: { method: string; body?: string | undefined; token?: string; slug?: boolean },
): Promise<Response | null> {
  // Fresh header set: nothing from the browser request (Authorization, Cookie, Host, X-Hotel-Slug…)
  // is forwarded. The destination is always config.upstream + an allowlisted path.
  const headers: Record<string, string> = {
    accept: "application/json, application/pdf;q=0.9, text/csv;q=0.8",
  };
  if (init.body !== undefined && init.body.length > 0) headers["content-type"] = "application/json";
  if (init.token) headers["authorization"] = `Bearer ${init.token}`;
  if (init.slug && config.hotelSlug) headers["x-hotel-slug"] = config.hotelSlug;
  try {
    const reqInit: RequestInit = {
      method: init.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    };
    if (init.body !== undefined && init.body.length > 0) reqInit.body = init.body;
    return await deps.fetch(`${config.upstream}${path}`, reqInit);
  } catch {
    deps.log(`upstream unreachable: ${init.method} ${path.split("?")[0]}`);
    return null;
  }
}

/** Pass an upstream response through with only safe headers. */
function passThrough(upstream: Response, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { ...BASE_HEADERS, ...extra };
  const ct = upstream.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const cd = upstream.headers.get("content-disposition");
  if (cd) headers["content-disposition"] = cd;
  const ra = upstream.headers.get("retry-after");
  if (ra) headers["retry-after"] = ra;
  // Redirects are never followed or forwarded (redirect: "manual").
  if (upstream.status >= 300 && upstream.status < 400) {
    return errorResponse(
      502,
      "UPSTREAM_ERROR",
      "The hotel system returned an unexpected response.",
      extra,
    );
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function handleLogin(request: Request, config: BffConfig, deps: BffDeps): Promise<Response> {
  const read = await readBody(request);
  if (!read.ok) return read.res;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.body || "null");
  } catch {
    return errorResponse(400, "VALIDATION", "Username and password are required.");
  }
  const { username, password } = (parsed ?? {}) as { username?: unknown; password?: unknown };
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username.trim() ||
    !password ||
    username.length > 128 ||
    password.length > 256
  ) {
    return errorResponse(400, "VALIDATION", "Username and password are required.");
  }

  const upstream = await callUpstream(deps, config, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: username.trim(), password }),
    slug: true,
  });
  if (!upstream)
    return errorResponse(
      502,
      "UPSTREAM_UNAVAILABLE",
      "The hotel system is not reachable. Please try again.",
    );

  if (upstream.status === 401 || upstream.status === 400) {
    return errorResponse(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }
  if (upstream.status === 429) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many login attempts. Please wait and try again.",
    );
  }
  if (!upstream.ok) {
    deps.log(`login upstream status ${upstream.status}`);
    return errorResponse(502, "UPSTREAM_ERROR", "Sign-in failed. Please try again.");
  }

  let payload: { token?: unknown; user?: unknown };
  try {
    payload = (await upstream.json()) as { token?: unknown; user?: unknown };
  } catch {
    deps.log("login upstream returned non-JSON");
    return errorResponse(502, "UPSTREAM_ERROR", "Sign-in failed. Please try again.");
  }
  const token = payload.token;
  const user = payload.user as Record<string, unknown> | undefined;
  if (!isWellFormedJwt(token) || !user || typeof user !== "object") {
    deps.log("login upstream returned an unexpected shape");
    return errorResponse(502, "UPSTREAM_ERROR", "Sign-in failed. Please try again.");
  }
  const maxAge = sessionMaxAge(token);
  if (maxAge <= 0) {
    deps.log("login upstream returned an expired token");
    return errorResponse(502, "UPSTREAM_ERROR", "Sign-in failed. Please try again.");
  }

  // Only whitelisted, non-secret user fields are returned. The token never leaves the server
  // except inside the HttpOnly cookie.
  const safeUser = {
    id: user["id"],
    username: user["username"],
    full_name: user["full_name"],
    role: user["role"],
  };
  return json(
    200,
    { user: safeUser },
    { "set-cookie": serializeSession(token, maxAge, config.secureCookie) },
  );
}

async function handleProxy(
  request: Request,
  url: URL,
  upstreamPath: string,
  config: BffConfig,
  deps: BffDeps,
): Promise<Response> {
  const token = readSession(request, config.secureCookie);
  if (!token) return errorResponse(401, "UNAUTHORIZED", SESSION_EXPIRED);

  let body: string | undefined;
  if (isStateChanging(request.method)) {
    const read = await readBody(request);
    if (!read.ok) return read.res;
    body = read.body;
  }

  const path = `${upstreamPath}${url.search}`;
  const upstream = await callUpstream(deps, config, path, {
    method: request.method.toUpperCase(),
    body,
    token,
  });
  if (!upstream)
    return errorResponse(
      502,
      "UPSTREAM_UNAVAILABLE",
      "The hotel system is not reachable. Please try again.",
    );

  if (upstream.status === 401) {
    // Expired, revoked or deactivated: drop the cookie so the browser stops presenting it.
    await upstream.body?.cancel().catch(() => undefined);
    return errorResponse(401, "UNAUTHORIZED", SESSION_EXPIRED, {
      "set-cookie": clearSession(config.secureCookie),
    });
  }
  return passThrough(upstream);
}

export async function handleBff(
  request: Request,
  overrides: Partial<BffDeps> = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isBffPath(url.pathname)) return null;
  const deps: BffDeps = { ...defaultDeps(), ...overrides };

  const loaded = loadConfig(deps.env);
  if (!loaded.ok) {
    deps.log(`not configured: ${loaded.reason}`);
    return errorResponse(
      503,
      "BFF_NOT_CONFIGURED",
      "The hotel system connection is not configured.",
    );
  }
  const config = loaded.config;
  const method = request.method.toUpperCase();

  // CSRF applies to every state-changing request, including login and logout.
  const csrf = checkCsrf(request, config.allowedOrigins);
  if (!csrf.ok) {
    deps.log(`csrf rejected (${csrf.reason}): ${method} ${url.pathname}`);
    return errorResponse(403, "CSRF_REJECTED", "This request was blocked for security reasons.");
  }

  if (url.pathname === "/bff/auth/login") {
    if (method !== "POST")
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed.", { allow: "POST" });
    return handleLogin(request, config, deps);
  }
  if (url.pathname === "/bff/auth/logout") {
    if (method !== "POST")
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed.", { allow: "POST" });
    return new Response(null, {
      status: 204,
      headers: { ...BASE_HEADERS, "set-cookie": clearSession(config.secureCookie) },
    });
  }
  if (url.pathname === "/bff/auth/me") {
    if (method !== "GET")
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed.", { allow: "GET" });
    return handleProxy(request, url, "/api/auth/me", config, deps);
  }

  if (url.pathname.startsWith("/api") && isAllowed(method, url.pathname)) {
    return handleProxy(request, url, url.pathname, config, deps);
  }
  return errorResponse(404, "NOT_FOUND", "Not found.");
}
