# StayDesk desktop operator guide (Windows offline demo)

## What you are running

StayDesk.exe is an Electron shell. It starts the existing Docker Compose stack (MySQL 8, Express API, React/Nitro web UI) on this PC and opens the UI in a desktop window. No cloud server is required after images are present locally.

## First-time setup (needs internet once)

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) and start it. Check your organisation’s Docker Desktop licence before commercial use.
2. Copy `.env.example` to `.env` in the compose project (dev: repo root; packaged: next to the bundled compose file) and keep demo passwords for the client demo only.
3. From the project root, build and pull once while online:

   ```bat
   docker compose up -d --build
   docker compose stop
   ```

4. Install StayDesk (NSIS installer from `desktop/` electron-builder output) or run in development:

   ```bat
   cd desktop
   npm install
   npm start
   ```

After images exist on the machine, normal daily use can be offline.

## Daily use

1. Start Docker Desktop.
2. Double-click StayDesk (or `npm start` in `desktop/`).
3. Wait for the splash screen health checks (database → API → UI).
4. Sign in with the seed users from the project README (`frontdesk` / `admin` / `superadmin`, password `Demo@1234` in the demo env).
5. On quit, StayDesk stops containers with `docker compose stop`. It never runs `docker compose down -v`. Hotel data in the MySQL volume is preserved.

## Data layout

| Path | Purpose |
|---|---|
| Docker volume `staydesk-mysql` | Live database (not inside the .exe) |
| `C:\ProgramData\StayDesk\documents` | Generated invoice PDFs (bind-mounted into containers) |
| `C:\ProgramData\StayDesk\backups` | Timestamped DB dump + documents copies |
| `C:\ProgramData\StayDesk\logs` | Desktop diagnostics (if written) |
| `C:\ProgramData\StayDesk\config` | Future local config |

## Backup and restore

In the desktop app: **Settings → Desktop backup**.

- **Backup now** runs `mysqldump --single-transaction` and copies `documents` into a timestamped folder under `backups`.
- **Restore** requires choosing a backup and typing `RESTORE`. It refuses if the API is unhealthy or confirmation is missing. It never silently overwrites.

## Demo features added for this release

- IST (`Asia/Kolkata`) business “today” on the booking form
- Guest ID proof type + number (masked on the guest list); records are not deleted (retain ≥ 1 year for police reference)
- Invoice total / amount paid / balance due; Print/PDF via `printInvoice({ invoiceId })` only
- Windows notification when an invoice becomes fully paid (SSE → React → Electron IPC)
- Existing partial payments and GST tax snapshot unchanged

## Failures that do not destroy data

- Docker Desktop not installed/running → clear error; volumes untouched
- Health check timeout → clear error; volumes untouched
- Unexpected Electron crash → do not run destructive compose commands; start StayDesk again after Docker is healthy

## Multi-PC later

This demo is one reception PC. The same Express API can later serve LAN clients; that is a bind-address / packaging change, not a rewrite.
