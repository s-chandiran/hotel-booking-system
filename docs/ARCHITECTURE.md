# ARCHITECTURE.md — StayDesk frontend

## Overview

```
Browser (React, TanStack Router/Query)
   │  same-origin only: /bff/auth/*, /api/*   (HttpOnly session cookie)
   ▼
TanStack Start / Nitro server  (src/server.ts → src/server/bff)
   │  Authorization: Bearer <JWT from cookie>   (server-to-server)
   ▼
Express API  (separate repo: D:\projects\Hotel\server) ──► MySQL 8
```

- The Express backend is the source of truth for data, business rules and authentication.
  Its JWT contract is unchanged (`POST /api/auth/login` → `{ token, user }`, Bearer on every call).
- The browser **never** receives or stores the JWT. It lives only in an HttpOnly cookie that the
  BFF reads server-side.
- `defaultSsr: false` (`src/start.ts`): route loaders and `beforeLoad` run in the browser only, so
  per-user data is never server-rendered and SSR never fetches without a cookie.
- Sample data (`src/api/mock`) is used only when `VITE_USE_MOCK` is not `"false"`; a banner says so.

## BFF (`src/server/bff/`)

| File | Responsibility |
|---|---|
| `config.ts` | Server-only env (`API_UPSTREAM_URL`, `ALLOWED_ORIGINS`, `SESSION_COOKIE_SECURE`, `HOTEL_SLUG`). Fails closed → 503 `BFF_NOT_CONFIGURED`. |
| `cookies.ts` | Session cookie serialize/read/clear. Max-Age from JWT `exp` (decoded, not verified), capped at 8h. |
| `csrf.ts` | Origin/Referer allowlist + `X-StayDesk-CSRF: 1` + `Sec-Fetch-Site` check on state-changing methods. |
| `allowlist.ts` | Method + path allowlist for the `/api/*` proxy; deny list for gateway callbacks, `/public` routes, direct login. |
| `handler.ts` | `/bff/auth/login`, `/bff/auth/logout`, `/bff/auth/me`, `/api/*` proxy. |
| `page-guard.ts` | Document navigations without a session cookie → 302 `/login` (skipped in mock mode). |

### Request flow

1. **Login** — `POST /bff/auth/login {username,password}` → CSRF check → upstream `/api/auth/login`
   (optional `X-Hotel-Slug` from `HOTEL_SLUG`) → token validated as compact JWT and unexpired →
   `Set-Cookie` → body `{ user: {id, username, full_name, role} }` only.
2. **Data** — `GET/POST /api/...` → allowlist → cookie required (401 without calling upstream) →
   fresh upstream headers (`accept`, `content-type` for JSON bodies, `authorization`) — browser
   `Authorization`, `Cookie`, `Host`, `X-Hotel-Slug` are never forwarded → response passed through
   with only `content-type`, `content-disposition`, `retry-after`.
3. **Expiry** — upstream 401 → cookie cleared + 401 → client dispatches `session-expired` → query
   cache cleared → `/login`.
4. **Logout** — `POST /bff/auth/logout` (CSRF-checked) clears the cookie; client clears its cache.

### Security properties

| Property | How |
|---|---|
| JWT confidentiality | HttpOnly cookie only; never in response bodies; BFF logs contain codes/paths only, never tokens, cookies or bodies. |
| Cookie | `HttpOnly; Path=/; SameSite=Strict; Max-Age`; `Secure` + `__Host-` prefix when `SESSION_COOKIE_SECURE=true` (default in production). No `Domain`. |
| CSRF | Exact-match Origin allowlist (Referer origin if Origin absent; both absent → 403) **and** custom header **and** `Sec-Fetch-Site != cross-site`, on every POST/PUT/PATCH/DELETE including login/logout. |
| No open proxy | Fixed upstream origin from env; method+path allowlist; segments `[A-Za-z0-9._~-]` starting alphanumeric (no `..`, `%2e`, `%2f`, `\`, `//`); upstream redirects never followed (`redirect: "manual"` → 502). |
| Caching | Every BFF response `Cache-Control: no-store, private`, `Vary: Cookie`. Client query cache cleared on login, logout and 401. |
| Limits | JSON bodies only (415 otherwise), 1 MB cap (413), 15 s upstream timeout (502). |
| Authorization | Unchanged — Express `authRequired`/`requireRole` decide every request. The BFF adds no privilege. |

## Environment

See `.env.example`. `VITE_*` values are embedded at build time into the **browser** bundle — never
put secrets there. BFF variables are read from the server process environment at request time.

## Known gaps

- Login rate limiting in Express sees every user as the BFF's IP (`X-Forwarded-For` not set).
- The page guard checks cookie presence only; validity is enforced on the first `/api` call.
- List endpoints for invoices/payments and a guest list do not exist in the backend yet (Phase 4).
