# StayDesk API (Express, `backend/src/api/`)

Status: **Gate 3b, demo scope** (data-model.md D6). Every endpoint below exists in code and is covered by
`backend/src/integration/api.itest.ts`. Anything not listed does not exist (refunds, void, cancel,
housekeeping updates, PDF, exports): ask before assuming.

## How it is reached

Browser → same-origin BFF (`src/server/bff`) → this API. Browsers never call it directly, so there is
no CORS. The BFF turns the HttpOnly session cookie into `Authorization: Bearer <jwt>` and forwards only
allowlisted paths. The BFF allowlist (`src/server/bff/allowlist.ts`) lists exactly these endpoints and nothing else; anything
not built returns 404 without reaching this API.

- Start: `npm run dev:api` (in `backend/`, reads `../.env`) or `docker compose up -d --build` (starts db, runs migrate and seed, then api and web).
- It runs as the restricted app DB user and **refuses to start** while migrations are pending (it never
  runs them) or when `JWT_SECRET` is missing or shorter than 32 characters.
- Health: `GET /health` → `{ "status": "ok" }` (public, says nothing else).

| Variable | Default | Meaning |
|---|---|---|
| `JWT_SECRET` | none, required | HS256 signing key, 32+ characters. Never committed |
| `JWT_TTL_SECONDS` | 28800 | Session length (300–86400). The BFF cookie lives as long as the token |
| `API_PORT` | 5000 | Listen port |
| `HOTEL_SLUG` | `demo-hotel` | Property used when login has no `X-Hotel-Slug` header |
| `DB_*` | see `.env.example` | App-user connection settings |

## Conventions

- JSON in, JSON out. Bodies are limited to 32 KB. Every response has `Cache-Control: no-store`.
- **Errors:** `{ "error": { "code": "…", "message": "…" } }`. The code is stable and the message holds no
  personal data. Unexpected failures are a generic `500 INTERNAL`, with details only in the server log
  (method, path and an error code, never bodies, tokens or guest data).
- **Validation is strict.** Unknown fields are refused with `400 VALIDATION`. A client cannot send a
  price, an invoice line, a reference, a status or a property id: the server computes all of them.
- **Money** is returned as numbers for display only. The server calculates in whole minor units (paise)
  from DECIMAL columns and never uses floats. Request amounts are strings like `"1500.00"`.
- **Property scope:** every query is limited to the property in the caller's token. Another
  property's records are reported as not found.
- **Idempotency:** `POST /api/bookings` and `POST /api/payments` need `idempotencyKey` (8–64 characters of
  `A–Z a–z 0–9 _ -`, one per form submission, in the body because the BFF forwards no custom headers). The
  same key returns the original record (still `201`). The same key with different details is
  `409 IDEMPOTENCY_CONFLICT`.

## Authentication

| Endpoint | Role | Notes |
|---|---|---|
| `POST /api/auth/login` | public | Body `{ username, password }`. Header `X-Hotel-Slug` selects the property. Returns `{ token, user: { id, username, full_name, role } }` |
| `GET /api/auth/me` | any | Returns `{ user }` |

- Wrong password, unknown user, unknown hotel and an inactive account all return the same
  `401 INVALID_CREDENTIALS` and take comparable time (a dummy bcrypt comparison).
- Throttle: 5 failures per property + username + client address in 15 minutes → `429 RATE_LIMITED` (in
  memory: it resets on restart and is per instance).
- Tokens are HS256 JWTs with `sub`, `pid` and `exp`. Verification pins the algorithm and checks signature and
  expiry. A token without `exp`, or one that is expired, tampered, signed with another key, or
  from another property, is `401 UNAUTHORIZED`. The account is reloaded on every request, so
  deactivating a user (or changing their role) takes effect at once.
- Roles: `front_desk < admin < super_admin` (§10). Role failures are `403 FORBIDDEN`.

## Read endpoints

Shapes follow `src/types/dashboard.ts` and `src/types/modules.ts`, with these deliberate differences for Gate 4:

| Endpoint | Role | Differences from the frontend type |
|---|---|---|
| `GET /api/dashboard` | any | No `reserved` (D2). `revenueToday` and `revenueMonth` are `null` for `front_desk`. `arrivals`/`departures` are today's bookings. `occupancyWeek` is stayed room-nights ÷ rooms for the last 7 days |
| `GET /api/bookings` | any | `roomNumber` is `""` until check-in assigns a room. `source` is the display label |
| `GET /api/bookings/:id` | any | **New.** Adds `received`, `advanceHeld`, `balanceDue`, `balanceIsEstimate` and `invoices[]`. Before the final invoice, `balanceDue` is room total + room tax in effect today − money received, and `balanceIsEstimate` is true. This is the checkout warning figure (D-D) |
| `GET /api/bookings/:id/free-rooms` | any | **New.** Rooms the booking can be checked in to (D-F) |
| `GET /api/room-types` | any | **New.** `{ id, code, name, rate, capacity }`, for the booking form |
| `GET /api/rooms` | any | Status is `available \| occupied \| maintenance`, derived. Adds `id` |
| `GET /api/guests` | any | `stays` counts checked-in and checked-out bookings. `country` is the country name. Adds `idDocumentType` (`aadhaar \| passport \| driving_licence \| null`) and `idDocumentNumberMasked` (`••••` + last 4, or `""`). The full number is never returned |
| `GET /api/events` | any | **New.** Server-Sent Events stream (`text/event-stream`) for the desktop app. Sends `: ping` every 15 s and `event: paymentPaid` with `{ invoiceId, invoiceNumber, guestName, bookingReference }` once, when an issued invoice first reaches a zero balance (after a payment or the checkout invoice). Delivery is once per invoice (audit action `payment_paid_notified`). In-process only and **not scoped by property or role** (single-property demo). Through the BFF the stream ends when the browser disconnects |
| `GET /api/front-desk` | any | Today's arrivals and departures, with `balance` (invoice balance, or the estimate above) and `bookingStatus` |
| `GET /api/invoices` | any | `status` is `paid \| unpaid \| partial \| void`. Adds `balanceDue` and `amountPaid` (allocated amount). `GET /api/invoices/:id` also returns `amountPaid` |
| `GET /api/payments` | any | `status` is the payment's own (`pending \| success \| failed`), never `refunded` (G9). Adds `refundedAmount`. `invoiceNumber` lists allocated invoices, or `Advance` (G10) |
| `GET /api/reports` | admin | Last 6 months. **Revenue is invoiced net** of issued invoices, excluding tax, void invoices and advances (D-G). Occupancy is stayed room-nights ÷ (all rooms × days). ADR is revenue ÷ room-nights. These occupancy and ADR definitions are provisional (Q16, Q22) |
| `GET /api/settings` | admin | `taxRate` is the sum of the room tax components in effect today. `taxComponents[]` is added (G11) |

## The eight demo actions (front_desk and above)

| Action | Endpoint | Body | Result and rules |
|---|---|---|---|
| Create guest | `POST /api/guests` | `{ fullName, email?, phone?, countryCode?, idDocumentType?, idDocumentNumber? }` | `201 { id }`. ID type and number (4–64 chars, spaces removed) must be given together or not at all (`INVALID_GUEST`). `PATCH /api/guests/:id` takes the same two fields. ID numbers never appear in audit details |
| Create booking | `POST /api/bookings` | `{ guestId, roomTypeId, checkInDate, checkOutDate, guestsCount, source, expectedArrivalTime?, idempotencyKey }` | `201 { id, reference, status, total }`. Reference is generated (`BK-…`). Status is `pending`, or `confirmed` for `source: walk_in` (D-B). The room rate is the room type's rate at this moment (snapshot). No room is assigned (D-F) |
| Confirm | `POST /api/bookings/:id/confirm` | `{}` | `pending → confirmed` |
| Assign room and check in | `POST /api/bookings/:id/check-in` | `{ roomId }` | `confirmed → checked_in`. Refused when the room is the wrong type, out of service, occupied (`ROOM_OCCUPIED`) or held by another booking for those dates (`ROOM_UNAVAILABLE`) |
| Record payment or advance | `POST /api/payments` | `{ bookingId, method, amount, idempotencyKey }` | `201 { id, reference, amount }`. Recorded as received. Reference is generated (`PAY-…`). It is applied to open invoices oldest first, and any rest stays as the booking's advance (a liability, never revenue) |
| Check out | `POST /api/bookings/:id/check-out` | `{}` | `checked_in → checked_out`; the room becomes Available + Dirty; **the final invoice is issued in the same transaction** from nights × the booking's stored rate plus the tax components in effect (D-C). Returns `invoice: { id, number, amount, balanceDue }`. Checkout is allowed with a balance due (D-D) |

Domain error codes and statuses: `404` `BOOKING_NOT_FOUND`, `GUEST_NOT_FOUND`, `ROOM_NOT_FOUND`,
`ROOM_TYPE_NOT_FOUND`; `409` `INVALID_TRANSITION`, `ROOM_UNAVAILABLE`, `ROOM_OCCUPIED`, `ROOM_OUT_OF_SERVICE`,
`ROOM_TYPE_MISMATCH`, `STAY_INVOICE_EXISTS`, `IDEMPOTENCY_CONFLICT`; `422` other rule violations
(`OVER_CAPACITY`, `INVALID_DATES`, `INVALID_AMOUNT`). `500` `SEQUENCE_NOT_CONFIGURED` means a property has no
reference or invoice counter row.

## Known gaps

- Frontend types are aligned for the demo screens (no `reserved`, no `refunded` payment status). The Settings
  screen still shows the single `taxRate`, not `taxComponents[]` (G11).
- No cancel, void, refund, housekeeping, PDF or export endpoints (deferred).
- The payment form records `success` only. There is no payment gateway.
- Login throttling is in memory, per instance. A multi-instance deployment needs a shared store.
- Pre-invoice balance uses the tax components in effect today. The invoice itself uses the checkout date.
