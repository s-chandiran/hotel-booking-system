# Sign in (`/login`)

## Purpose
Staff sign-in. Exchanges a username/password for a session cookie via the BFF.

## Reached / exited
- Reached: any page navigation without a session cookie (server 302), any API 401
  (`session-expired`), the header Log out button, or typing `/login`.
- Exited: successful sign-in → `/`. If already signed in, `/login` redirects to `/`.

## Permissions
- UI: public page, rendered without `AppShell`.
- Server: `POST /bff/auth/login` requires an allowlisted Origin (or Referer) and
  `X-StayDesk-CSRF: 1`; credentials are checked by Express `POST /api/auth/login`.

## Data flow
| Call | When | Result |
|---|---|---|
| `GET /bff/auth/me` | route `beforeLoad` | 200 → redirect `/`; 401 → show form |
| `POST /bff/auth/login` `{username, password}` | submit | 200 `{user}` + HttpOnly cookie; 401 invalid credentials; 429 rate limited; 502/503 backend unreachable / BFF not configured |

## UI structure
Brand mark, "Sign in" heading, Username and Password fields (existing `Input`/`Label`), inline
error (`role="alert"`), full-width submit button with spinner. Built with existing components and
theme tokens; no new styles.

## Behaviour and rules
- Submit disabled until both fields are filled; password cleared after a failed attempt.
- On success the query cache is cleared (no data from a previous user) and seeded with the user.
- Error text comes from the BFF and is generic ("Invalid username or password.") — never reveals
  whether the username exists (backend BR-59).
- Fields are never pre-filled; no credentials exist in frontend source.

## Edge cases
- Backend down → "The hotel system is not reachable. Please try again."
- BFF env missing → "The hotel system connection is not configured." (503).
- Upstream returns a malformed/expired token → 502, no cookie set.

## Known gaps
- No "forgot password" / change-password UI (backend has `POST /api/auth/change-password`).
