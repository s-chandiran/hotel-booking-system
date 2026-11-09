/**
 * The only backend operations the browser may reach through the BFF. Anything not listed —
 * including payment-gateway callbacks/webhooks, guest-facing /public routes, admin mutations
 * and direct /api/auth/login — returns 404 without contacting the backend.
 *
 * Exactly the endpoints that exist in the backend (docs/API.md). Add a route here only when it is built.
 *
 * Path segments are restricted to [A-Za-z0-9._~-] starting with an alphanumeric, so `.`/`..`,
 * percent-encoding (`%2e`, `%2f`), backslashes and empty segments (`//`) can never match.
 */

const SEG = "[A-Za-z0-9][A-Za-z0-9._~-]{0,63}";

interface Rule {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: RegExp;
}

const r = (method: Rule["method"], path: string): Rule => ({
  method,
  pattern: new RegExp(`^${path.replace(/:seg/g, SEG)}$`),
});

export const ALLOWED_ROUTES: readonly Rule[] = [
  r("GET", "/api/auth/me"),

  // Reads (all built in backend/src/api/reads.ts).
  r("GET", "/api/dashboard"),
  r("GET", "/api/bookings"),
  r("GET", "/api/bookings/:seg"),
  r("GET", "/api/bookings/:seg/free-rooms"),
  r("GET", "/api/rooms"),
  r("GET", "/api/room-types"),
  r("GET", "/api/guests"),
  r("GET", "/api/front-desk"),
  r("GET", "/api/invoices"),
  r("GET", "/api/invoices/:seg"),
  r("GET", "/api/payments"),
  r("GET", "/api/refunds"),
  r("GET", "/api/reports"),
  r("GET", "/api/settings"),
  r("PATCH", "/api/settings"),
  r("POST", "/api/demo/clear"),

  r("POST", "/api/guests"),
  r("PATCH", "/api/guests/:seg"),
  r("POST", "/api/bookings"),
  r("PATCH", "/api/bookings/:seg"),
  r("POST", "/api/bookings/:seg/(?:confirm|cancel|check-in|check-out)"),
  r("POST", "/api/payments"),
  r("POST", "/api/payments/:seg/refund"),
  r("POST", "/api/refunds/:seg/(?:complete|reject)"),
  r("POST", "/api/invoices/:seg/void"),

  // Rooms: admin-only structure and maintenance, front-desk housekeeping (roles are enforced by the API).
  r("POST", "/api/rooms"),
  r("PATCH", "/api/rooms/:seg"),
  r("POST", "/api/rooms/:seg/(?:maintenance|housekeeping|remove)"),
];

/** Paths that must never be proxied even if a future rule would match them. */
const DENY = [
  /\/public(?:\/|$)/,
  /^\/api\/payments\/(?:callback|webhook|reconcile|initiate)/,
  /^\/api\/auth\/login/,
];

export function isAllowed(method: string, pathname: string): boolean {
  if (pathname.length > 512) return false;
  if (DENY.some((d) => d.test(pathname))) return false;
  const m = method.toUpperCase();
  return ALLOWED_ROUTES.some((rule) => rule.method === m && rule.pattern.test(pathname));
}
