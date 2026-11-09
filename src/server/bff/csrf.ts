/**
 * CSRF defence for state-changing requests, layered on top of the SameSite=Strict cookie:
 *  1. Origin must exactly match the allowlist (Referer's origin when Origin is absent;
 *     both absent → reject).
 *  2. A custom header the browser can only send same-origin via fetch (a cross-site form
 *     cannot set it, and a cross-site fetch with it would need a CORS preflight we never grant).
 *  3. Sec-Fetch-Site: cross-site is rejected outright when the browser sends it.
 */

export const CSRF_HEADER = "x-staydesk-csrf";
export const CSRF_HEADER_VALUE = "1";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export type CsrfResult = { ok: true } | { ok: false; reason: string };

export function checkCsrf(request: Request, allowedOrigins: ReadonlySet<string>): CsrfResult {
  if (!isStateChanging(request.method)) return { ok: true };

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, reason: "cross-site request" };
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    // "null" (sandboxed iframes, file://) is never allowed.
    if (!allowedOrigins.has(origin)) return { ok: false, reason: "origin not allowed" };
  } else {
    const referer = request.headers.get("referer");
    if (!referer) return { ok: false, reason: "missing origin and referer" };
    const refOrigin = originOf(referer);
    if (!refOrigin || !allowedOrigins.has(refOrigin))
      return { ok: false, reason: "referer not allowed" };
  }

  if (request.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    return { ok: false, reason: "missing csrf header" };
  }
  return { ok: true };
}
