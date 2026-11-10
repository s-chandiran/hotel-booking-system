# Settings (`/settings`)

Session and navigation model: see [README.md](README.md). This file records only what the desktop work added; the property form, tax components and staff table are otherwise TBD — needs confirmation.

## Access
- `GET /api/settings` is admin only (server-side 403 otherwise).

## Desktop backup panel (`DesktopBackupPanel`)
- Rendered only when the Electron preload bridge `window.staydesk` exists. In a normal browser it renders nothing.
- **Backup now** → IPC `staydesk:backupNow`: runs `mysqldump --single-transaction --routines --triggers` inside the `db` container and copies the documents folder into `C:\ProgramData\StayDesk\backups\staydesk-backup-<timestamp>\` with a `manifest.json`.
- **Restore** → pick a backup, type `RESTORE`, then IPC `staydesk:restoreBackup`. The main process refuses without the token and when the API health check fails. It pipes `database.sql` into `mysql` as root, then copies documents back.

## Known gaps
- Any signed-in user of the desktop app can back up and restore; there is no role check in the IPC layer (Q31).
- The `RESTORE` token is a UI guard, not security.
- Restore runs while the API is live. Open connections are not stopped first.
- Backups contain full guest PII in plain text (Q30).
- No backup retention or deletion.
