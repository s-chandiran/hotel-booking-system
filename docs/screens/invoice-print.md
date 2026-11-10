# Print invoice (`/invoices/print/:invoiceId`)

Session and navigation model: see [README.md](README.md).

## Purpose
A plain, print-styled invoice document that the Electron main process loads for printing and PDF export. It is not linked from the sidebar.

## How it is reached
- Invoice dialog (`src/features/invoices/InvoiceDialogs.tsx`) calls `window.staydesk.printInvoice({ invoiceId })` (desktop only).
- Main process (`desktop/main.cjs`, `staydesk:printInvoice`) validates the id (`^[1-9]\d{0,17}$`), opens a hidden window that shares the main window's session cookies, and loads this route.

## Access
- Rendered outside `AppShell` and skips the client-side session probe (`__root.tsx`). The data call `GET /api/invoices/:id` still needs the session, so an unauthenticated window shows "Invoice could not be loaded".

## Data flow
- `GET /api/invoices/:id` via `invoiceDetailQuery`. Shows lines, tax snapshot, net, tax, total, `amountPaid`, `balanceDue`, status. Void invoices show `—` for paid and balance.
- When data has loaded the page sets `window.__staydeskPrintReady = true`.

## Behaviour
- The main process waits up to about 10 seconds for the ready flag, shows the print dialog, then also saves an A4 PDF as `invoice-<id>-<timestamp>.pdf` in `C:\ProgramData\StayDesk\documents`.

## Known gaps
- If the ready flag never appears, printing proceeds after the wait anyway and may print the loading text.
- No property name, address or GST number on the document. TBD — needs confirmation.
- The PDF folder is bind-mounted into containers but nothing in the API reads it yet.
