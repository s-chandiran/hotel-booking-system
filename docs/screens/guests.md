# Guests (`/guests`)

Session and navigation model: see [README.md](README.md).

## Purpose
List guests and add or correct a guest record, including ID proof (police reference). Guests are never deleted.

## Access
- Reached from the sidebar. Server guard: `GET /api/guests` and the guest writes need a session, any role (`front_desk` and above).
- UI gate: none beyond the session. Role-based hiding is not built.

## Data flow
- `GET /api/guests` → list (`idDocumentType`, `idDocumentNumberMasked`, never the full number).
- `POST /api/guests`, `PATCH /api/guests/:id` → `GuestDialog` (`src/features/guests/GuestDialog.tsx`).

## UI
- Table columns include **ID proof** (`type ••••last4`, or `—`). Search covers name, email, phone and the masked number.
- Dialog: ID type select (Aadhaar, Passport, Driving licence) and ID number input.
  - New guest: type and number must be given together. Number is at least 4 characters.
  - Editing: the field shows `ID number (on file ••••1234)`. Blank keeps the current number. A new number is sent only when both type and number are filled.

## Business rules
- The service rejects a type without a number, or the reverse (`INVALID_GUEST`). Numbers are stored with spaces removed, plus the last 4 digits for display.
- Audit details record only `id_document`, never the number.

## Known gaps
- The full ID number is stored in plain text and included in backups (Q30). Production blocker.
- The ID type cannot be cleared from the dialog once set (the clear path exists in the API only).
- No role check on who may correct ID data. TBD — needs confirmation (Q15, Q30).
