# Reservations (`/bookings`) and Front desk (`/front-desk`)

Status: live-data demo flow (Gate 4, demo scope D6). All data and actions use the real API.

## Purpose

List every booking, create a booking, and run one booking through its stay: confirm → check in
(assign a room) → record payment or advance → check out (final invoice issued automatically). The
Front desk screen lists today's arrivals and departures with the same Manage dialog.

## Reached and left

Sidebar → Reservations / Check-in / out, or the Dashboard buttons "New booking", "Arrivals" and
"Departures". Leaving is a normal navigation. Dialogs close with Esc, the × button or Done.

## Permissions

- UI: any signed-in user sees these screens and actions (roles are `front_desk` and above).
- Server: `authRequired` on every `/api` route. All eight demo actions are open to `front_desk`, `admin`
  and `super_admin` (data-model.md §10). There is no per-role hiding in the UI yet.

## Data flow (all through the BFF, which adds the Bearer token from the HttpOnly cookie)

| Action | Call |
|---|---|
| Lists | `GET /api/bookings`, `GET /api/front-desk` |
| New booking form | `GET /api/room-types`, `GET /api/guests`, `POST /api/guests` (new guest), `POST /api/bookings` |
| Manage dialog | `GET /api/bookings/:id` (money summary, invoices) |
| Confirm | `POST /api/bookings/:id/confirm` |
| Check in | `GET /api/bookings/:id/free-rooms`, `POST /api/bookings/:id/check-in` `{ roomId }` |
| Payment or advance | `POST /api/payments` `{ bookingId, method, amount, idempotencyKey }` |
| Check out | `POST /api/bookings/:id/check-out`, which returns the final invoice (number, amount, balance due) |

After any action every cached list is refetched (`invalidateQueries`), so the Dashboard, Rooms, Invoices
and Payments screens match.

## UI structure

- **New booking dialog** (`features/bookings/NewBookingDialog.tsx`): existing or new guest, room type,
  source, dates, guests (capped at the room type's capacity). The result shows the generated reference,
  status and room total before tax.
- **Manage dialog** (`features/bookings/BookingManager.tsx`): header with status, a money summary (room
  total before tax, received, advance held, balance due), the invoice list, then only the actions valid
  for the booking's status.

## Business rules shown on screen

- The server owns every price, reference and status. The form sends none of them (strict API validation
  refuses them).
- A walk-in booking is created confirmed (D-B). Others start pending and need an explicit Confirm.
- No room is chosen at booking time. Check-in lists free rooms of the booked type for the booked dates (D-F).
- **Balance due before checkout is an estimate**: room total plus the room tax in effect today, minus money received.
  After checkout it is the final invoice's balance. The checkout step warns when the balance is above zero
  and still allows it (D-D).
- The final invoice is issued automatically at checkout, from nights × the booking's stored rate plus tax
  (D-C). Advances are applied to it automatically. Paying the rest afterwards marks it Paid.
- After checkout the room shows Available + Dirty (D-H). There is no mark-clean action yet.
- Duplicate submit protection: a booking or payment retried with the same content reuses its
  idempotency key, so the server returns the original record. Changing the content starts a new submission.

## Errors

API failures are shown in the dialog (red note) with the server's message, for example "The room is still
occupied by another guest". A list that cannot load shows the error page with the API's message. Nothing
fabricates data on failure.

## Known gaps

- No cancel, no refund, no void, no invoice PDF, no housekeeping update (deferred).
- The Manage dialog is the only place to act on a booking: there is no booking detail page.
- The pre-checkout balance estimate uses today's tax components, while the invoice uses the checkout date's.
- A cancelled booking can't be managed (no actions are offered).
- No role-specific hiding in the UI.
- The Guests screen has no create button. A guest is created from the New booking dialog.
