// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isAllowed } from "@/server/bff/allowlist";
import { loadConfig } from "@/server/bff/config";
import {
  DEV_COOKIE_NAME,
  MAX_SESSION_SECONDS,
  SECURE_COOKIE_NAME,
  clearSession,
  readSession,
  serializeSession,
  sessionMaxAge,
} from "@/server/bff/cookies";
import { checkCsrf } from "@/server/bff/csrf";
import { makeJwt, ORIGIN, req } from "./helpers";

describe("config", () => {
  it("requires a bare http(s) upstream origin", () => {
    expect(loadConfig({}).ok).toBe(false);
    expect(loadConfig({ API_UPSTREAM_URL: "ftp://x" }).ok).toBe(false);
    expect(loadConfig({ API_UPSTREAM_URL: "http://x:5000/api" }).ok).toBe(false);
    expect(loadConfig({ API_UPSTREAM_URL: "http://user:pw@x:5000" }).ok).toBe(false);
    const ok = loadConfig({ API_UPSTREAM_URL: "http://x:5000/" });
    expect(ok.ok && ok.config.upstream).toBe("http://x:5000");
  });

  it("requires ALLOWED_ORIGINS in production and validates every entry", () => {
    expect(loadConfig({ API_UPSTREAM_URL: "http://x", NODE_ENV: "production" }).ok).toBe(false);
    expect(
      loadConfig({
        API_UPSTREAM_URL: "http://x",
        NODE_ENV: "production",
        ALLOWED_ORIGINS: "https://a.com,https://b.com/path",
      }).ok,
    ).toBe(false);
    const c = loadConfig({
      API_UPSTREAM_URL: "http://x",
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://a.com",
    });
    expect(c.ok && [...c.config.allowedOrigins]).toEqual(["https://a.com"]);
  });

  it("defaults Secure cookies on in production and off in development; rejects junk", () => {
    const prod = loadConfig({
      API_UPSTREAM_URL: "http://x",
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://a.com",
    });
    const dev = loadConfig({ API_UPSTREAM_URL: "http://x" });
    expect(prod.ok && prod.config.secureCookie).toBe(true);
    expect(dev.ok && dev.config.secureCookie).toBe(false);
    expect(loadConfig({ API_UPSTREAM_URL: "http://x", SESSION_COOKIE_SECURE: "yes" }).ok).toBe(
      false,
    );
    expect(loadConfig({ API_UPSTREAM_URL: "http://x", HOTEL_SLUG: "../evil" }).ok).toBe(false);
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Strict, Path=/ and not Secure in dev", () => {
    const c = serializeSession(makeJwt(), 3600, false);
    expect(c.startsWith(`${DEV_COOKIE_NAME}=`)).toBe(true);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=3600");
    expect(c).not.toContain("Secure");
    expect(c).not.toContain("Domain=");
  });

  it("uses the __Host- prefix and Secure in production", () => {
    const c = serializeSession(makeJwt(), 3600, true);
    expect(c.startsWith(`${SECURE_COOKIE_NAME}=`)).toBe(true);
    expect(c).toContain("Secure");
    expect(c).toContain("HttpOnly");
  });

  it("clears with Max-Age=0 and an empty value", () => {
    const c = clearSession(true);
    expect(c.startsWith(`${SECURE_COOKIE_NAME}=;`)).toBe(true);
    expect(c).toContain("Max-Age=0");
  });

  it("derives Max-Age from the JWT exp, capped at 8h, 0 when expired", () => {
    const now = 1_800_000_000_000; // whole second, so exp − now is exact
    expect(sessionMaxAge(makeJwt(600, now), now)).toBe(600);
    expect(sessionMaxAge(makeJwt(48 * 3600, now), now)).toBe(MAX_SESSION_SECONDS);
    expect(sessionMaxAge(makeJwt(-5, now), now)).toBe(0);
    expect(sessionMaxAge("a.!!!.c")).toBe(0);
  });

  it("refuses to serialize anything that is not a compact JWT (no cookie injection)", () => {
    expect(() => serializeSession("abc; Domain=evil.com", 10, false)).toThrow();
    expect(() => serializeSession("a.b.c\r\nSet-Cookie: x=y", 10, false)).toThrow();
  });

  it("reads only the configured cookie name and only well-formed values", () => {
    const jwt = makeJwt();
    expect(
      readSession(req("/", { headers: { cookie: `other=1; ${DEV_COOKIE_NAME}=${jwt}` } }), false),
    ).toBe(jwt);
    expect(
      readSession(req("/", { headers: { cookie: `${DEV_COOKIE_NAME}=${jwt}` } }), true),
    ).toBeNull();
    expect(
      readSession(req("/", { headers: { cookie: `${DEV_COOKIE_NAME}=not-a-jwt` } }), false),
    ).toBeNull();
    expect(readSession(req("/"), false)).toBeNull();
  });
});

describe("csrf", () => {
  const allowed = new Set([ORIGIN]);
  const post = (headers: Record<string, string>) =>
    req("/api/bookings", { method: "POST", headers });

  it("lets safe methods through without checks", () => {
    expect(checkCsrf(req("/api/rooms"), allowed).ok).toBe(true);
  });

  it("accepts an allowlisted Origin with the custom header", () => {
    expect(checkCsrf(post({ origin: ORIGIN, "x-staydesk-csrf": "1" }), allowed).ok).toBe(true);
  });

  it("rejects a missing custom header", () => {
    expect(checkCsrf(post({ origin: ORIGIN }), allowed).ok).toBe(false);
    expect(checkCsrf(post({ origin: ORIGIN, "x-staydesk-csrf": "0" }), allowed).ok).toBe(false);
  });

  it("rejects foreign, null and look-alike origins (exact match only)", () => {
    for (const origin of [
      "https://evil.com",
      "null",
      "http://localhost:3000.evil.com",
      "http://localhost:3001",
      "HTTP://LOCALHOST:3000/",
    ]) {
      expect(checkCsrf(post({ origin, "x-staydesk-csrf": "1" }), allowed).ok).toBe(false);
    }
  });

  it("falls back to Referer only when Origin is absent; rejects when both are missing", () => {
    expect(
      checkCsrf(post({ referer: `${ORIGIN}/bookings`, "x-staydesk-csrf": "1" }), allowed).ok,
    ).toBe(true);
    expect(
      checkCsrf(post({ referer: "https://evil.com/x", "x-staydesk-csrf": "1" }), allowed).ok,
    ).toBe(false);
    expect(checkCsrf(post({ "x-staydesk-csrf": "1" }), allowed).ok).toBe(false);
  });

  it("rejects Sec-Fetch-Site: cross-site even with a matching Origin", () => {
    expect(
      checkCsrf(
        post({ origin: ORIGIN, "x-staydesk-csrf": "1", "sec-fetch-site": "cross-site" }),
        allowed,
      ).ok,
    ).toBe(false);
  });
});

describe("proxy allowlist", () => {
  it.each([
    ["GET", "/api/auth/me"],
    ["GET", "/api/rooms"],
    ["GET", "/api/dashboard"],
    ["GET", "/api/front-desk"],
    ["GET", "/api/invoices"],
    ["GET", "/api/payments"],
    ["GET", "/api/reports"],
    ["GET", "/api/room-types"],
    ["GET", "/api/bookings"],
    ["GET", "/api/bookings/42"],
    ["GET", "/api/bookings/42/free-rooms"],
    ["POST", "/api/guests"],
    ["POST", "/api/bookings"],
    ["POST", "/api/bookings/HTL-2026-000123/check-in"],
    ["POST", "/api/bookings/42/confirm"],
    ["POST", "/api/bookings/42/check-out"],
    ["POST", "/api/payments"],
  ])("allows %s %s", (method, path) => {
    expect(isAllowed(method, path)).toBe(true);
  });

  it.each([
    ["POST", "/api/auth/login"],
    ["POST", "/api/payments/webhook"],
    ["POST", "/api/payments/callback"],
    ["POST", "/api/payments/reconcile"],
    ["POST", "/api/payments/initiate"],
    ["POST", "/api/payments/12/refund"],
    ["POST", "/api/payments/cash"],
    ["POST", "/api/bookings/42/cancel"],
    ["GET", "/api/invoices/42"],
    ["GET", "/api/invoices/42/pdf"],
    ["GET", "/api/reports/dashboard-snapshot"],
    ["GET", "/api/availability"],
    ["DELETE", "/api/guests"],
    ["PUT", "/api/payments"],
    ["GET", "/api/bookings/HTL-1/public"],
    ["POST", "/api/bookings/HTL-1/public/pay"],
    ["PUT", "/api/settings"],
    ["GET", "/api/users"],
    ["GET", "/api/app-settings"],
    ["DELETE", "/api/bookings/HTL-1"],
    ["GET", "/api/bookings/../users"],
    ["GET", "/api/bookings/%2e%2e/users"],
    ["GET", "/api/bookings/HTL%2F1"],
    ["GET", "/api//rooms"],
    ["GET", "/api/rooms/"],
    ["GET", "/api/bookings/.hidden"],
    ["GET", "/api/bookings\\..\\users"],
    ["GET", "/api/health"],
  ])("denies %s %s", (method, path) => {
    expect(isAllowed(method, path)).toBe(false);
  });
});
