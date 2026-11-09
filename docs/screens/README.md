# Screens

| Screen | Route | Doc | Data source |
|---|---|---|---|
| Sign in | `/login` | [login.md](login.md) | BFF `/bff/auth/*` |
| Dashboard | `/` | TBD | live API (`/api/dashboard`) when `VITE_USE_MOCK=false` |
| Reservations | `/bookings` | [reservations.md](reservations.md) | live API, with the demo actions |
| Front Desk | `/front-desk` | [reservations.md](reservations.md) | live API, with the demo actions |
| Rooms | `/rooms` | TBD | live API, read only |
| Guests | `/guests` | TBD | live API, read only |
| Invoices | `/invoices` | TBD | live API, read only |
| Payments | `/payments` | TBD | live API, read only |
| Reports | `/reports` | TBD | live API, admin only (server-side 403 otherwise) |
| Settings | `/settings` | TBD | live API, admin only (server-side 403 otherwise) |

## Shared navigation and session model

- Every screen except `/login` renders inside `AppShell` (sidebar + header).
- **Session** (when `VITE_USE_MOCK=false`):
  - Server: a page navigation without the session cookie is redirected to `/login` before HTML is
    served (`src/server/bff/page-guard.ts`). Every `/api/*` call needs the cookie; Express verifies
    the JWT and role on each request.
  - Client: the root route's `beforeLoad` loads `GET /bff/auth/me`; 401 → `/login`. Any API 401
    fires `session-expired` → query cache cleared → `/login`.
  - Header user chip shows the signed-in user's name/initials; the Log out button calls
    `POST /bff/auth/logout`, clears the cache and goes to `/login`.
- **Sample-data mode** (`VITE_USE_MOCK` unset/`true`): no login, a yellow banner states that sample
  data is shown, Log out is disabled.
- Permissions per screen are enforced by the backend roles (`front_desk < admin < super_admin`);
  the UI does not hide or grant anything based on role yet.
