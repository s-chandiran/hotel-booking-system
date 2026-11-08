# Screens

| Screen | Route | Doc | Data source |
|---|---|---|---|
| Sign in | `/login` | [login.md](login.md) | BFF `/bff/auth/*` |
| Dashboard | `/` | TBD (Phase 3) | mock until Phase 3 |
| Reservations | `/bookings` | TBD (Phase 3) | mock until Phase 3 |
| Front Desk | `/front-desk` | TBD (Phase 5) | mock |
| Rooms | `/rooms` | TBD (Phase 3) | mock |
| Guests | `/guests` | TBD (Phase 4) | mock |
| Invoices | `/invoices` | TBD (Phase 4) | mock |
| Payments | `/payments` | TBD (Phase 4) | mock |
| Reports | `/reports` | TBD (P2) | mock |
| Settings | `/settings` | TBD (P2) | mock |

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
