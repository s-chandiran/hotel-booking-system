/**
 * Session cookie that carries the backend JWT. HttpOnly, so browser JavaScript can never read it.
 * The JWT is only decoded here to read `exp` for Max-Age — it is NOT verified here; the Express
 * backend verifies it on every request.
 */

export const SECURE_COOKIE_NAME = "__Host-staydesk_session";
export const DEV_COOKIE_NAME = "staydesk_session";

/** Upper bound on cookie lifetime: the backend's default JWT_EXPIRES_IN is 8h. */
export const MAX_SESSION_SECONDS = 8 * 60 * 60;

// Compact JWS: three base64url segments. Anything else is never stored or forwarded — this also
// blocks header/cookie injection (no `;`, `,`, whitespace or CR/LF can pass).
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function cookieName(secure: boolean): string {
  return secure ? SECURE_COOKIE_NAME : DEV_COOKIE_NAME;
}

export function isWellFormedJwt(token: unknown): token is string {
  return typeof token === "string" && token.length <= 4096 && JWT_RE.test(token);
}

function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

/** Seconds until the token's `exp`, capped at MAX_SESSION_SECONDS. 0 when expired/unreadable exp. */
export function sessionMaxAge(token: string, nowMs: number = Date.now()): number {
  try {
    const payloadSeg = token.split(".")[1];
    if (!payloadSeg) return 0;
    const payload = JSON.parse(base64UrlDecode(payloadSeg)) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp))
      return MAX_SESSION_SECONDS;
    const remaining = Math.floor(payload.exp - nowMs / 1000);
    if (remaining <= 0) return 0;
    return Math.min(remaining, MAX_SESSION_SECONDS);
  } catch {
    return 0;
  }
}

function attributes(secure: boolean, maxAge: number): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function serializeSession(token: string, maxAge: number, secure: boolean): string {
  if (!isWellFormedJwt(token)) throw new Error("refusing to serialize a malformed session token");
  return `${cookieName(secure)}=${token}; ${attributes(secure, Math.max(0, Math.floor(maxAge)))}`;
}

export function clearSession(secure: boolean): string {
  return `${cookieName(secure)}=; ${attributes(secure, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Reads the session token from the Cookie header; returns null unless it is a well-formed JWT. */
export function readSession(request: Request, secure: boolean): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = cookieName(secure);
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() !== name) continue;
    const value = pair.slice(idx + 1).trim();
    return isWellFormedJwt(value) ? value : null;
  }
  return null;
}
