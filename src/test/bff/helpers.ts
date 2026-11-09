import { vi } from "vitest";
import type { BffDeps } from "@/server/bff/handler";

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Unsigned-looking but well-formed compact JWS; the BFF never verifies signatures. */
export function makeJwt(expSecondsFromNow = 8 * 3600, nowMs = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: 4,
      username: "frontdesk1",
      hotel_id: 1,
      exp: Math.floor(nowMs / 1000) + expSecondsFromNow,
    }),
  );
  return `${header}.${payload}.c2lnbmF0dXJlLXRlc3Qtb25seQ`;
}

export const ORIGIN = "http://localhost:3000";

export const DEV_ENV = { API_UPSTREAM_URL: "http://upstream.test:5000", NODE_ENV: "development" };
export const PROD_ENV = {
  API_UPSTREAM_URL: "http://upstream.test:5000",
  NODE_ENV: "production",
  ALLOWED_ORIGINS: "https://staydesk.example.com",
};

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function makeDeps(
  impl: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
    jsonResponse(200, { ok: true }),
  env: Record<string, string> = DEV_ENV,
) {
  const logs: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init ?? {}),
  );
  const deps: Partial<BffDeps> = {
    fetch: fetchMock as unknown as typeof fetch,
    env,
    log: (m) => logs.push(m),
  };
  return { deps, fetchMock, logs };
}

export function req(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; base?: string } = {},
): Request {
  const r: RequestInit = { method: init.method ?? "GET", headers: init.headers ?? {} };
  if (init.body !== undefined) r.body = init.body;
  return new Request(`${init.base ?? ORIGIN}${path}`, r);
}

/** Headers a same-origin fetch from the app would carry on a state-changing request. */
export const sameOriginWrite = (extra: Record<string, string> = {}) => ({
  origin: ORIGIN,
  "x-staydesk-csrf": "1",
  "content-type": "application/json",
  ...extra,
});
