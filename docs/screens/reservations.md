# Reservations (`/bookings`) and Front desk (`/front-desk`)

Status: live-data demo flow (Gate 4, demo scope D6), plus edit and cancel (commit 86108aa). All data
and actions use the real API.

## Purpose

List every booking, create a booking, and run one booking through its stay: confirm → check in
(assign a room) → record payment or advance → check out (final invoice issued automatically). Before
check-in a booking can also be edited or cancelled. The Front desk screen lists today's arrivals and
departures with the same Manage dialog.

This is the screen to use to explain the application's workflow: one booking, managed from the Manage
dialog, changes the Dashboard, Rooms, Invoices and Payments screens.

### Demo walkthrough (verified in the browser 2026-11-09)

1. Reservations → **Manage** on a Pending booking → **Confirm booking**.
2. **Record payment or advance** (for example ₹1,000 cash). A `PAY-` reference is shown and the
   estimated balance drops.
3. **Check in and assign a room**: the list holds only free rooms of the booked type, so an occupied room
   is missing from it.
4. **Check out**. If money is still due, a warning appears and **Check out anyway** goes ahead. The final
   invoice (`INV/…`) is issued with tax, and advances are applied to it.
5. **Record payment** of the remaining balance. The invoice turns **Paid** with ₹0 due.
6. Show **Invoices** (the invoice is Paid) and **Room Management** (the room is Available + Dirty).

## Reached and left

Sidebar → Reservations / Check-in / out, or the Dashboard buttons "New booking", "Arrivals" and
"Departures". Leaving is a normal navigation. Dialogs close with Esc, the × button or Done.

## Permissions

- UI: any signed-in user sees these screens and actions (roles are `front_desk` and above).
- Server: `authRequired` on every `/api` route. All eight demo actions are open to `front_desk`, `admin`
  and `super_admin` (data-model.md §10). Edit (`PATCH /bookings/:id`) and Cancel (`/cancel`) have no route-level
  `requireRole` in `backend/src/api/writes.ts`, so any signed-in role can use them. Whether cancel should be
  restricted to a role: TBD — needs confirmation. There is no per-role hiding in the UI yet.

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
| Edit details (pending/confirmed) | `PATCH /api/bookings/:id` with only the changed fields: `checkInDate`, `checkOutDate`, `guestsCount`, `expectedArrivalTime`. Returns the new nights and total. |
| Cancel (pending/confirmed) | `POST /api/bookings/:id/cancel` `{ reason }` |

After any action every cached list is refetched (`invalidateQueries`), so the Dashboard, Rooms, Invoices
and Payments screens match.

## UI structure

- **New booking dialog** (`features/bookings/NewBookingDialog.tsx`): existing or new guest, room type,
  source, dates, guests (capped at the room type's capacity). The result shows the generated reference,
  status and room total before tax.
- **Manage dialog** (`features/bookings/BookingManager.tsx`): header with status, a money summary (room
  total before tax, received, advance held, balance due), the invoice list, then only the actions valid
  for the booking's status:

  | Status | Sections shown |
  |---|---|
  | Pending | Confirm, Record payment, Edit details, Cancel |
  | Confirmed | Check in (room picker), Record payment, Edit details, Cancel |
  | Checked in | Record payment, Check out |
  | Checked out | Record payment only while the balance is above zero |
  | Cancelled | No actions. A note says how much advance is still held. |

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
- After checkout the room shows Available + Dirty (D-H). It is set back to clean on the Room Management
  screen (`src/features/rooms/RoomDialogs.tsx`), not in this dialog.
- Editing keeps the booked nightly rate, and the server recalculates the total.
- Cancelling needs a reason and cannot be undone. Money already received stays held for the guest, and
  nothing is refunded automatically. Refunds are handled from the Payments screen
  (`src/features/payments/RefundDialogs.tsx`).
- Duplicate submit protection: a booking or payment retried with the same content reuses its
  idempotency key, so the server returns the original record. Changing the content starts a new submission.

## Errors

API failures are shown in the dialog (red note) with the server's message, for example "The room is still
occupied by another guest". A list that cannot load shows the error page with the API's message. Nothing
fabricates data on failure.

## Known gaps

- No invoice PDF or print. Neither the frontend nor this dialog offers one.
- Refund, invoice void and housekeeping exist only on other screens (Payments, Invoices, Room
  Management). They can't be reached from this dialog.
- Changes to a checked-in booking (for example extending the stay) aren't offered. Edit details is
  for pending and confirmed bookings only.
- The Manage dialog is the only place to act on a booking: there is no booking detail page.
- The pre-checkout balance estimate uses today's tax components, while the invoice uses the checkout date's.
- A cancelled booking can't be managed (no actions are offered).
- No role-specific hiding in the UI.
- A room that is occupied can still show housekeeping "Dirty" (seen on room 101 on 2026-11-09). Nothing
  links stay status to housekeeping apart from checkout setting Dirty.
- Right after `docker compose up`, the first page load can get 500s for JS bundles while `web`
  starts. A reload fixes it (seen 2026-11-09, cause not investigated).
