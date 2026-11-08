/**
 * The only backend operations the browser may reach through the BFF. Anything not listed —
 * including payment-gateway callbacks/webhooks, guest-facing /public routes, admin mutations
 * and direct /api/auth/login — returns 404 without contacting the backend.
 *
 * List endpoints planned for Phase 4 (invoices/payments lists) are added here only when they exist
 * in the backend.
 *
 * Path segments are restricted to [A-Za-z0-9._~-] starting with an alphanumeric, so `.`/`..`,
 * percent-encoding (`%2e`, `%2f`), backslashes and empty segments (`//`) can never match.
 */

const SEG = "[A-Za-z0-9][A-Za-z0-9._~-]{0,63}";

interface Rule {
  method: "GET" | "POST" | "PUT" | "DELETE";
  pattern: RegExp;
}

const r = (method: Rule["method"], path: string): Rule => ({
  method,
  pattern: new RegExp(`^${path.replace(/:seg/g, SEG)}$`),
});

export const ALLOWED_ROUTES: readonly Rule[] = [
  r("GET", "/api/auth/me"),

  r("GET", "/api/reports/:seg"),
  r("GET", "/api/reports/:seg/export"),

  r("GET", "/api/rooms"),
  r("GET", "/api/room-types"),
  r("GET", "/api/room-types/:seg"),
  r("GET", "/api/availability"),

  r("GET", "/api/bookings"),
  r("POST", "/api/bookings"),
  r("GET", "/api/bookings/:seg"),
  r("POST", "/api/bookings/:seg/(?:confirm|check-in|check-out|cancel)"),
  r("GET", "/api/bookings/:seg/charges"),

  r("GET", "/api/guests"),
  r("GET", "/api/guests/:seg"),

  r("GET", "/api/invoices/:seg"),
  r("GET", "/api/invoices/:seg/pdf"),

  r("GET", "/api/payments"),
  r("GET", "/api/payments/refunds"),
  r("POST", "/api/payments/cash"),

  r("GET", "/api/settings"),
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
