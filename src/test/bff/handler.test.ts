// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleBff } from "@/server/bff/handler";
import { guardPage } from "@/server/bff/page-guard";
import { DEV_COOKIE_NAME, SECURE_COOKIE_NAME } from "@/server/bff/cookies";
import {
  DEV_ENV,
  jsonResponse,
  makeDeps,
  makeJwt,
  ORIGIN,
  PROD_ENV,
  req,
  sameOriginWrite,
} from "./helpers";

const USER = { id: 4, username: "frontdesk1", full_name: "A. Kumar", role: "front_desk" };
const cookieFor = (jwt: string, name = DEV_COOKIE_NAME) => ({ cookie: `${name}=${jwt}` });

async function bodyText(res: Response | null): Promise<string> {
  return res ? await res.text() : "";
}

function loginRequest(headers: Record<string, string> = sameOriginWrite(), base?: string) {
  const init: Parameters<typeof req>[1] = {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "frontdesk1", password: "pw" }),
  };
  if (base) init.base = base;
  return req("/bff/auth/login", init);
}

describe("handleBff routing", () => {
  it("ignores non-BFF paths so the app handler serves them", async () => {
    const { deps, fetchMock } = makeDeps();
    expect(await handleBff(req("/"), deps)).toBeNull();
    expect(await handleBff(req("/bookings"), deps)).toBeNull();
    expect(await handleBff(req("/apiary"), deps)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the upstream is not configured", async () => {
    const { deps, fetchMock } = makeDeps(undefined, {});
    const res = await handleBff(req("/api/rooms", { headers: cookieFor(makeJwt()) }), deps);
    expect(res?.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("login", () => {
  it("sets an HttpOnly SameSite=Strict cookie and returns only the user — never the token", async () => {
    const jwt = makeJwt();
    const { deps, fetchMock, logs } = makeDeps(() =>
      jsonResponse(200, { token: jwt, user: { ...USER, password_hash: "x" } }),
    );
    const res = await handleBff(loginRequest(), deps);

    expect(res?.status).toBe(200);
    const setCookie = res!.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${DEV_COOKIE_NAME}=${jwt};`)).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(res!.headers.get("cache-control")).toBe("no-store, private");

    const text = await bodyText(res);
    expect(text).not.toContain(jwt);
    expect(JSON.parse(text)).toEqual({ user: USER });
    expect(logs.join("\n")).not.toContain(jwt);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://upstream.test:5000/api/auth/login");
    expect((init?.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("uses a Secure __Host- cookie in production", async () => {
    const { deps } = makeDeps(() => jsonResponse(200, { token: makeJwt(), user: USER }), PROD_ENV);
    const res = await handleBff(
      loginRequest(
        sameOriginWrite({ origin: "https://staydesk.example.com" }),
        "https://staydesk.example.com",
      ),
      deps,
    );
    expect(res?.status).toBe(200);
    const setCookie = res!.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${SECURE_COOKIE_NAME}=`)).toBe(true);
    expect(setCookie).toContain("Secure");
  });

  it("sends the configured hotel slug, never one from the browser", async () => {
    const { deps, fetchMock } = makeDeps(
      () => jsonResponse(200, { token: makeJwt(), user: USER }),
      {
        ...DEV_ENV,
        HOTEL_SLUG: "demo",
      },
    );
    await handleBff(loginRequest(sameOriginWrite({ "x-hotel-slug": "other-hotel" })), deps);
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["x-hotel-slug"]).toBe("demo");
  });

  it("maps bad credentials to a generic 401 without a cookie", async () => {
    const { deps } = makeDeps(() =>
      jsonResponse(401, {
        error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password." },
      }),
    );
    const res = await handleBff(loginRequest(), deps);
    expect(res?.status).toBe(401);
    expect(res!.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a malformed or expired upstream token instead of storing it", async () => {
    for (const token of ["not-a-jwt", makeJwt(-10)]) {
      const { deps, logs } = makeDeps(() => jsonResponse(200, { token, user: USER }));
      const res = await handleBff(loginRequest(), deps);
      expect(res?.status).toBe(502);
      expect(res!.headers.get("set-cookie")).toBeNull();
      expect(await bodyText(res)).not.toContain(token);
      expect(logs.join("\n")).not.toContain(token);
    }
  });

  it("validates the credentials payload before calling upstream", async () => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleBff(
      req("/bff/auth/login", {
        method: "POST",
        headers: sameOriginWrite(),
        body: JSON.stringify({ username: "a" }),
      }),
      deps,
    );
    expect(res?.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no Origin or Referer", { "x-staydesk-csrf": "1", "content-type": "application/json" }],
    ["a foreign Origin", sameOriginWrite({ origin: "https://evil.example" })],
    ["no CSRF header", { origin: ORIGIN, "content-type": "application/json" }],
  ])("is CSRF-rejected with %s", async (_label, headers) => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleBff(loginRequest(headers as Record<string, string>), deps);
    expect(res?.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the backend is unreachable", async () => {
    const { deps } = makeDeps(() => {
      throw new TypeError("fetch failed");
    });
    const res = await handleBff(loginRequest(), deps);
    expect(res?.status).toBe(502);
  });
});

describe("logout", () => {
  it("clears the cookie", async () => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleBff(
      req("/bff/auth/logout", { method: "POST", headers: sameOriginWrite() }),
      deps,
    );
    expect(res?.status).toBe(204);
    const setCookie = res!.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${DEV_COOKIE_NAME}=;`)).toBe(true);
    expect(setCookie).toContain("Max-Age=0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires CSRF protection and POST", async () => {
    const { deps } = makeDeps();
    expect((await handleBff(req("/bff/auth/logout", { method: "POST" }), deps))?.status).toBe(403);
    expect((await handleBff(req("/bff/auth/logout"), deps))?.status).toBe(405);
  });
});

describe("authenticated proxy", () => {
  it("returns 401 without contacting the backend when there is no session cookie", async () => {
    const { deps, fetchMock } = makeDeps();
    for (const path of ["/api/rooms", "/bff/auth/me"]) {
      const res = await handleBff(req(path), deps);
      expect(res?.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a browser-supplied Authorization header (it is never a credential)", async () => {
    const { deps, fetchMock } = makeDeps();
    const res = await handleBff(
      req("/api/rooms", { headers: { authorization: `Bearer ${makeJwt()}` } }),
      deps,
    );
    expect(res?.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attaches the cookie's JWT as Bearer and forwards no browser credentials or host", async () => {
    const jwt = makeJwt();
    const { deps, fetchMock } = makeDeps(() =>
      jsonResponse(200, [{ id: 1 }], { "set-cookie": "upstream=1" }),
    );
    const res = await handleBff(
      req("/api/bookings?status=confirmed&arrivals=today", {
        headers: {
          cookie: `${DEV_COOKIE_NAME}=${jwt}; other=secret`,
          authorization: "Bearer attacker",
          "x-hotel-slug": "other",
          "x-forwarded-host": "evil",
        },
      }),
      deps,
    );
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual([{ id: 1 }]);
    expect(res!.headers.get("set-cookie")).toBeNull();
    expect(res!.headers.get("cache-control")).toBe("no-store, private");
    expect(res!.headers.get("vary")).toBe("Cookie");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://upstream.test:5000/api/bookings?status=confirmed&arrivals=today",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${jwt}`);
    expect(Object.keys(headers).sort()).toEqual(["accept", "authorization"]);
    expect(init?.redirect).toBe("manual");
  });

  it("maps /bff/auth/me to upstream /api/auth/me", async () => {
    const { deps, fetchMock } = makeDeps(() => jsonResponse(200, { user: USER }));
    const res = await handleBff(req("/bff/auth/me", { headers: cookieFor(makeJwt()) }), deps);
    expect(await res!.json()).toEqual({ user: USER });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://upstream.test:5000/api/auth/me");
  });

  it("clears the cookie when the backend rejects the token (expired/revoked)", async () => {
    const { deps } = makeDeps(() =>
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Session expired." } }),
    );
    const res = await handleBff(req("/api/rooms", { headers: cookieFor(makeJwt()) }), deps);
    expect(res?.status).toBe(401);
    expect(res!.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("passes backend business errors through unchanged (e.g. 409)", async () => {
    const body = {
      error: { code: "NO_AVAILABILITY", message: "No Deluxe rooms free for those dates." },
    };
    const { deps } = makeDeps(() => jsonResponse(409, body));
    const res = await handleBff(
      req("/api/bookings", {
        method: "POST",
        headers: { ...sameOriginWrite(), ...cookieFor(makeJwt()) },
        body: "{}",
      }),
      deps,
    );
    expect(res?.status).toBe(409);
    expect(await res!.json()).toEqual(body);
  });

  it("forwards a JSON body on allowed writes and requires CSRF for them", async () => {
    const jwt = makeJwt();
    const { deps, fetchMock } = makeDeps(() => jsonResponse(200, { ok: true }));
    const body = JSON.stringify({ room_id: 47 });

    const blocked = await handleBff(
      req("/api/bookings/HTL-2026-000123/check-in", {
        method: "POST",
        headers: { ...cookieFor(jwt), "content-type": "application/json" },
        body,
      }),
      deps,
    );
    expect(blocked?.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    const ok = await handleBff(
      req("/api/bookings/HTL-2026-000123/check-in", {
        method: "POST",
        headers: { ...sameOriginWrite(), ...cookieFor(jwt) },
        body,
      }),
      deps,
    );
    expect(ok?.status).toBe(200);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("rejects non-JSON and oversized bodies", async () => {
    const { deps, fetchMock } = makeDeps();
    const headers = {
      ...sameOriginWrite({ "content-type": "text/plain" }),
      ...cookieFor(makeJwt()),
    };
    expect(
      (await handleBff(req("/api/bookings", { method: "POST", headers, body: "x" }), deps))?.status,
    ).toBe(415);
    const big = JSON.stringify({ x: "a".repeat(1024 * 1024) });
    expect(
      (
        await handleBff(
          req("/api/bookings", {
            method: "POST",
            headers: { ...sameOriginWrite(), ...cookieFor(makeJwt()) },
            body: big,
          }),
          deps,
        )
      )?.status,
    ).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/auth/login"],
    ["POST", "/api/payments/webhook"],
    ["GET", "/api/users"],
    ["GET", "/api/bookings/%2e%2e/users"],
    ["GET", "/api/health"],
    ["GET", "/bff/anything"],
  ])(
    "returns 404 for non-allowlisted %s %s without contacting the backend",
    async (method, path) => {
      const { deps, fetchMock } = makeDeps();
      const headers: Record<string, string> = {
        ...cookieFor(makeJwt()),
        ...(method === "GET" ? {} : sameOriginWrite()),
      };
      const res = await handleBff(
        req(path, { method, headers, ...(method === "GET" ? {} : { body: "{}" }) }),
        deps,
      );
      expect(res?.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("never follows or forwards upstream redirects", async () => {
    const { deps } = makeDeps(
      () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    );
    const res = await handleBff(req("/api/rooms", { headers: cookieFor(makeJwt()) }), deps);
    expect(res?.status).toBe(502);
    expect(res!.headers.get("location")).toBeNull();
  });

  it("returns a generic 502 when the backend is down, without leaking the token", async () => {
    const jwt = makeJwt();
    const { deps, logs } = makeDeps(() => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const res = await handleBff(req("/api/rooms", { headers: cookieFor(jwt) }), deps);
    expect(res?.status).toBe(502);
    expect(await bodyText(res)).not.toContain(jwt);
    expect(logs.join("\n")).not.toContain(jwt);
  });

  it("does not accept the dev cookie name when Secure cookies are on", async () => {
    const { deps, fetchMock } = makeDeps(undefined, PROD_ENV);
    const res = await handleBff(
      req("/api/rooms", { headers: cookieFor(makeJwt()), base: "https://staydesk.example.com" }),
      deps,
    );
    expect(res?.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("page guard", () => {
  const nav = (path: string, headers: Record<string, string> = {}) =>
    req(path, { headers: { accept: "text/html", "sec-fetch-dest": "document", ...headers } });

  it("redirects page navigations without a session cookie to /login", () => {
    const res = guardPage(nav("/bookings"), { authEnabled: true, env: DEV_ENV });
    expect(res?.status).toBe(302);
    expect(res!.headers.get("location")).toBe("/login");
  });

  it("lets through /login, assets, non-document requests and signed-in users", () => {
    expect(guardPage(nav("/login"), { authEnabled: true, env: DEV_ENV })).toBeNull();
    expect(guardPage(nav("/assets/app.js"), { authEnabled: true, env: DEV_ENV })).toBeNull();
    expect(
      guardPage(req("/bookings", { headers: { "sec-fetch-dest": "script" } }), {
        authEnabled: true,
        env: DEV_ENV,
      }),
    ).toBeNull();
    expect(
      guardPage(nav("/bookings", cookieFor(makeJwt())), { authEnabled: true, env: DEV_ENV }),
    ).toBeNull();
  });

  it("is off in sample-data mode", () => {
    expect(guardPage(nav("/bookings"), { authEnabled: false, env: DEV_ENV })).toBeNull();
  });
});
