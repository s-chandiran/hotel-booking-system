# Screens

| Screen | Route | Doc | Data source |
|---|---|---|---|
| Sign in | `/login` | [login.md](login.md) | BFF `/bff/auth/*` |
| Dashboard | `/` | TBD | live API (`/api/dashboard`) |
| Reservations | `/bookings` | [reservations.md](reservations.md) | live API, with the demo actions |
| Front Desk | `/front-desk` | [reservations.md](reservations.md) | live API, with the demo actions |
| Rooms | `/rooms` | TBD | live API |
| Guests | `/guests` | [guests.md](guests.md) | live API |
| Invoices | `/invoices` | TBD | live API, read only |
| Payments | `/payments` | TBD | live API (record payment via booking Manage) |
| Reports | `/reports` | TBD | live API, admin only (server-side 403 otherwise) |
| Settings | `/settings` | [settings.md](settings.md) | live API, admin only (server-side 403 otherwise) |
| Print invoice | `/invoices/print/:invoiceId` | [invoice-print.md](invoice-print.md) | live API, loaded only by the desktop app |

## Shared navigation and session model

- Every screen except `/login` renders inside `AppShell` (sidebar + header).
- **Session** (live API only):
  - Server: a page navigation without the session cookie is redirected to `/login` before HTML is
    served (`src/server/bff/page-guard.ts`). Every `/api/*` call needs the cookie; Express verifies
    the JWT and role on each request.
  - Client: the root route's `beforeLoad` loads `GET /bff/auth/me`; 401 → `/login`. Any API 401
    fires `session-expired` → query cache cleared → `/login`.
  - Header user chip shows the signed-in user's name/initials; the Log out button calls
    `POST /bff/auth/logout`, clears the cache and goes to `/login`.
- There is no mock-data or sample-data mode. API failures show errors; empty successful responses
  remain legitimate empty states.
- Permissions per screen are enforced by the backend roles (`front_desk < admin < super_admin`).
