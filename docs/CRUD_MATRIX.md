# Screen CRUD matrix and checklist (2026-11-09)

Derived from the code, not assumed. "Service" = `backend/src/services/*`, "API" = `backend/src/api/*`.
Legend: ✅ done · ⛔ not built · 🚫 deliberately not offered (reason given). Working rules marked **ASSUMED**
are recorded as Q25–Q29 in `docs/domain/OPEN_QUESTIONS.md` for the customer to confirm.

**No hard delete anywhere.** The app DB user has no DELETE grant, every FK is RESTRICT, financial and audit
tables are append-only by trigger. "Delete" means a controlled action: cancel, void, out-of-service.

## Matrix

| Screen | Create | Read | Update | Delete / controlled action | Roles (API-enforced) |
|---|---|---|---|---|---|
| **Guests** | API ✅ (`POST /api/guests`, via booking dialog); **screen button ⛔** | ✅ list | ⛔ service + `PATCH /api/guests/:id` + form | 🚫 no delete (PII retention and erasure wait for Q19; bookings and invoices reference guests) | front_desk+ |
| **Reservations** | ✅ dialog | ✅ list + detail | ⛔ service + `PATCH /api/bookings/:id` (dates, guests, arrival time) | confirm ✅; **cancel: service ✅, API/UI ⛔**; 🚫 no delete (cancel is the archive) | front_desk+ |
| **Rooms** | ⛔ service + `POST /api/rooms` | ✅ list | ⛔ floor/type (admin); housekeeping (front_desk+) | maintenance on/off ⛔ (admin); 🚫 no delete (out of service is the archive; no `rooms.is_active`) | admin for create/type/maintenance; front_desk+ housekeeping |
| **Front desk** | check-in with room assignment ✅; check-out ✅ (final invoice ✅) | ✅ today's list | 🚫 room reassignment while in house is not approved (D-F: assigned at check-in only) | — | front_desk+ |
| **Payments** | record payment/advance ✅ (Manage dialog) | ✅ list (+ `refundableAmount`) | 🚫 never edited (immutable by trigger and grant) | **refund request/complete/reject ✅** (migration 013, admin UI on Payments) | record: front_desk+; refunds: admin+ (§10) |
| **Invoices** | ✅ automatic at checkout (D-C). 🚫 no manual issue (not approved; penalty invoices wait for Q13) | ✅ list; **detail with lines and tax ⛔** | 🚫 never edited (immutable) | **void: service ✅, API/UI ⛔** (reason required, number kept) | read: front_desk+; void: admin+ |
| **Settings** | 🚫 staff/accounts and tax components wait for Q14/Q15/Q6 | ✅ | ⛔ property details (name, address, phone, email, times) + audit | — | admin+ (server 403 otherwise) |
| **Dashboard** | — | ✅ | — | — | front_desk+ (revenue admin+) |
| **Reports** | — | ✅ | — | — | admin+ |
| **Header** | — | — | — | search box and bell are decorative → **remove** | — |

## Existing building blocks (do not duplicate)

- Services: `createGuest`; `createBooking`, `confirmBooking`, `checkIn`, `checkOut`, `cancelBooking`,
  `freeRoomsForBooking`; `recordPayment`, `settlePayment`, `issueInvoice`, `voidInvoice`, `requestRefund`,
  `completeRefund`, `rejectRefund`; `nextReference`; audit via `audit()`.
- API: 12 reads and 6 writes (docs/API.md). Strict zod bodies, idempotency keys, `requireRole`.
- DB grants already allow the updates below (migration 010): `guests` name/email/phone/country/vip,
  `bookings` dates/guests/arrival time, `rooms` type/floor/out-of-service/housekeeping, `properties`
  details. **No migration is needed except 013 (refund reference + idempotency).**

## Working rules for the missing logic (ASSUMED → Q25–Q29)

- **Guest update (Q27):** name, email, phone, country. `is_vip` stays read-only. No deletion.
- **Booking update (Q25):** only `pending` or `confirmed`; dates, guests count and arrival time. The room total
  is recomputed from the booking's stored nightly rate (no repricing). Room type is not editable. If a room
  is assigned, the overlap and capacity rules are re-checked under locks.
- **Cancel (Q13 working assumption):** `pending`/`confirmed` → `cancelled` with a reason. Money received stays
  as the booking's held advance. Nothing is refunded or penalised automatically.
- **Rooms (Q26):** a room is created `available`, `clean`. Maintenance is refused while the room is occupied or
  has a pending/confirmed booking assigned to it (Q21 assumption). The room type changes only when no active
  booking is assigned. The room number is immutable. Housekeeping moves `clean/dirty/inspecting` freely
  (R21, front_desk+).
- **Refunds (Q8, Q28):** admin+ requests a refund (the amount is capped by the payment, a pending refund
  reserves its amount, allocations are released as needed). A second admin action completes or rejects it.
  The reference is server-generated (`RF-…`). Duplicate protection by idempotency key.
- **Void invoice:** admin+, reason required, the number stays and is never reused, allocated money returns
  to the booking's advance.
- **Settings (Q29):** admin+ may change name, address, phone, email and check-in/out times. Currency, timezone
  and country are not changed here. Every change is audited with old and new values (no secrets).

## Test plan per screen

Each row: create, read, update, controlled action, invalid input, wrong role (API 403), API integration
(HTTP), browser interaction, and a regression of the screens the change touches (Dashboard, Rooms,
Reservations, Payments, Invoices).

## Checklist (updated as work proceeds)

| # | Increment | Status |
|---|---|---|
| 0 | Discovery and this matrix | ✅ |
| 1 | Guests: create button, view, update | ⛔ |
| 2 | Reservations: update, cancel | ⛔ |
| 3 | Rooms: create, update, maintenance, housekeeping | ⛔ |
| 4 | Front desk: reviewed, no new flow needed (assignment, check-in, check-out exist) | ⛔ |
| 5 | Payments: refunds (admin) | ✅ |
| 6 | Invoices: detail view, void (admin) | ⛔ |
| 7 | Settings: admin property update with audit | ⛔ |
| 8 | Dashboard/reports refresh, remove decorative header controls, regression, docs | ⛔ |

Blocked: none. Open business confirmations are Q25–Q29 (working assumptions above are used meanwhile).
