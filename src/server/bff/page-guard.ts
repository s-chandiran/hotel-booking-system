/**
 * Server-side gate for page loads: a browser navigating to an app page without a session cookie
 * is redirected to /login before any HTML is served. This is a UX/defence-in-depth layer only —
 * data is protected by the BFF proxy (every /api call needs a valid cookie, verified by Express).
 *
 * Presence of the cookie is checked here, not validity; an expired cookie is caught by the first
 * /api call (401 → cookie cleared → client redirects to /login).
 */

import { loadConfig, readProcessEnv, type Env } from "./config";
import { readSession } from "./cookies";

const PUBLIC_PAGES = new Set(["/login"]);

function isDocumentNavigation(request: Request): boolean {
  if (request.method !== "GET") return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest !== null) return dest === "document";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function looksLikeAsset(pathname: string): boolean {
  const last = pathname.split("/").pop() ?? "";
  return (
    last.includes(".") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/@") ||
    pathname.startsWith("/_") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/src/")
  );
}

export function guardPage(
  request: Request,
  opts: { authEnabled: boolean; env?: Env },
): Response | null {
  if (!opts.authEnabled) return null;
  if (!isDocumentNavigation(request)) return null;
  const url = new URL(request.url);
  if (PUBLIC_PAGES.has(url.pathname) || looksLikeAsset(url.pathname)) return null;

  const loaded = loadConfig(opts.env ?? readProcessEnv());
  // Misconfigured BFF: let the page render; its data calls will show the 503 error state.
  if (!loaded.ok) return null;
  if (readSession(request, loaded.config.secureCookie)) return null;

  return new Response(null, {
    status: 302,
    headers: { location: "/login", "cache-control": "no-store, private", vary: "Cookie" },
  });
}
