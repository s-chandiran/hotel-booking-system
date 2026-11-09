# ARCHITECTURE.md — StayDesk frontend

> **Current decision (2026-11-09): live API only.** The browser talks to the same-origin BFF; the BFF
> proxies allowlisted `/api/*` calls to the Express API (`backend/`) with a Bearer JWT from an HttpOnly
> cookie. There is no mock-data mode and no client-side sample fallback. `D:\projects\Hotel` is a
> separate application and must not be used.

## Overview

```
Browser (React, TanStack Router/Query)
   │  same-origin only: /bff/auth/*, /api/*   (HttpOnly session cookie)
   ▼
TanStack Start / Nitro server  (src/server.ts → src/server/bff)
   │  Authorization: Bearer <JWT from cookie>   (server-to-server)
   ▼
Express API  (backend/src/api) → MySQL
```

- The Express backend is the source of truth for data, business rules and authentication.
  Its JWT contract is unchanged (`POST /api/auth/login` → `{ token, user }`, Bearer on every call).
- The browser **never** receives or stores the JWT. It lives only in an HttpOnly cookie that the
  BFF reads server-side.
- `defaultSsr: false` (`src/start.ts`): route loaders and `beforeLoad` run in the browser only, so
  per-user data is never server-rendered and SSR never fetches without a cookie.
- API failures surface as errors (no fabricated rows, no empty-success conversion). Legitimate empty
  arrays from a successful response remain valid empty states.

## BFF (`src/server/bff/`)

| File | Responsibility |
|---|---|
| `config.ts` | Server-only env (`API_UPSTREAM_URL`, `ALLOWED_ORIGINS`, `SESSION_COOKIE_SECURE`, `HOTEL_SLUG`). Fails closed → 503 `BFF_NOT_CONFIGURED`. |
| `cookies.ts` | Session cookie serialize/read/clear. Max-Age from JWT `exp` (decoded, not verified), capped at 8h. |
| `csrf.ts` | Origin/Referer allowlist + `X-StayDesk-CSRF: 1` + `Sec-Fetch-Site` check on state-changing methods. |
| `allowlist.ts` | Method + path allowlist for the `/api/*` proxy; deny list for gateway callbacks, `/public` routes, direct login. |
| `handler.ts` | `/bff/auth/login`, `/bff/auth/logout`, `/bff/auth/me`, `/api/*` proxy. |
| `page-guard.ts` | Document navigations without a session cookie → 302 `/login`. |

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
