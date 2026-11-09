# StayDesk frontend — agent notes

## Commands
- `npm ci` · `npm run dev` · `npm test` (vitest) · `npm run build` · `npx tsc --noEmit -p .`
- Lint: `npm run lint` fails on CRLF line endings from `core.autocrlf=true` checkouts (pre-existing,
  thousands of `Delete ␍`). For real findings: `npx eslint . --rule '{"prettier/prettier":["error",{"endOfLine":"auto"}]}'`.
- Build for the node-server image: `NITRO_PRESET=node-server npm run build`, run
  `node .output/server/index.mjs`.
- Docker live demo (`.env` has `API_UPSTREAM_URL=http://api:5000`, the DB and `JWT_SECRET` values):
  `docker compose --profile tools up -d --build web api db`, then once
  `docker compose --profile tools run --rm migrate` and `docker compose --profile tools run --rm seed`.
  Open http://localhost:3000 and sign in with the `DEMO_*` accounts from `.env`. Name the services: a
  bare `--profile tools up` would also start the one-off `migrate` and `seed`.
- Host run without Docker: build with `NITRO_PRESET=node-server npm run build`, start the API with
  `npm run dev:api` (in `backend/`) and the web with `HOST=127.0.0.1 PORT=3000 API_UPSTREAM_URL=http://127.0.0.1:5000
  SESSION_COOKIE_SECURE=false node .output/server/index.mjs`. Browse **127.0.0.1:3000**: if the Docker `web` container is up,
  `localhost:3000` (IPv6) reaches that one instead.
- Backend (`backend/`, its own package): `npm ci` · `npx tsc --noEmit -p tsconfig.json` · `npm test`
  (money unit tests) · `npm run build`. With a local MySQL: `npm run db:migrate`, `npm run db:status`,
  `npm run db:seed:demo` (env from `.env.example`).
- DB integration tests: `npm run test:db` (in `backend/`). They need the Docker `db` running, and
  they read the repo-root `.env` (`src/integration/setup.ts`). Files are `src/integration/*.itest.ts`,
  kept out of `npm test`. Each run adds an `itest-<random>` property that can't be deleted (no DELETE
  grant); recreate the volume to clear it.
- API (Gate 3b, `backend/src/api/`): `npm run dev:api` (reads `../.env`; needs `JWT_SECRET` of 32+ chars)
  or `docker compose --profile tools up -d --build api` (port 5000, loopback only). Contract in
  `docs/API.md`. It refuses to start with pending migrations. Run `npm run build` before the Docker
  image build checks, and never put `JWT_SECRET` in a committed file.
- DB via Docker (needs `.env` with the DB passwords). Each is a single cmd.exe line:
  `docker compose --profile tools up -d db`, then `docker compose --profile tools run --rm migrate`,
  then `docker compose --profile tools run --rm seed`. `db` is in the `tools` profile, so plain
  `docker compose up` doesn't start it.

## Architecture gotchas
- **Own backend in this repo (decision 2026-11-09):** MySQL 8.4 + Express/TS + knex under `backend/`.
  Frontend mock-data mode was removed (2026-11-09): all screens use the live API via the BFF.
  `D:\projects\Hotel` is a DIFFERENT application: never read, edit or start sessions there.
- The domain is fixed in `docs/domain/data-model.md` (approved). Don't make financial or business
  decisions while writing tables or code: follow that doc and `docs/DATABASE.md`, and raise anything
  new in `docs/domain/OPEN_QUESTIONS.md`.
- DB gotchas:
  - Host port 3306 is taken on this machine, so the local `.env` uses `DB_PORT=3307`. Containers
    still reach `db:3306`.
  - `backend/vitest.config.ts` must exist, or vitest walks up to the frontend config (jsdom +
    `src/test/setup.ts`) and fails.
  - Docker Desktop may need starting first (`docker info` fails on the `dockerDesktopLinuxEngine` pipe).
  - MySQL users are created by `backend/docker/db-init/01-users.sh` only on an **empty** volume.
    After a password change, recreate the `staydesk-mysql` volume or run ALTER USER.
  - The `db` service needs `--log-bin-trust-function-creators=1`, or the non-SUPER migrator cannot
    create triggers.
  - The app DB user has no DELETE and only column-level UPDATE (migration 010). A new updatable
    column must be added there.
  - Financial tables are immutable by trigger (008). Corrections are new rows, never edits.
  - Totals inside locking reads must not use subqueries (see `docs/DATABASE.md` §9a).
  - Service transactions are READ COMMITTED (`inTx`). Under REPEATABLE READ, gap locks deadlocked
    parallel invoice issues. Don't open a top-level transaction with plain `db.transaction` in
    services.
  - Amount limits F1.2–F1.4 are service-only. The DB accepts an over-allocating or over-refunding
    INSERT by the app user (DATABASE.md §9b).
  - On the host, run migrations with `npx tsx --env-file=../.env src/db/migrate.ts latest` (in
    `backend/`); `npm run db:migrate` alone lacks the DB variables. `db/migration-source.ts` keeps
    host and Docker runs compatible.
  - Intermittent test-runner deaths (about 3–7% of full runs: "Worker exited unexpectedly", or only the
    `RUN` line with exit 127) happen on this Windows + Node 24 machine, with no assertion failure and
    never a false pass. If a run has no `Tests … passed` summary, just rerun it. The config uses
    `pool: "threads"` (DATABASE.md §9d).
  - References (`BK-`, `PAY-`) are server-generated from `number_sequences`. Only the seed passes
    its own. A new property needs `booking` and `payment` sequence rows.
  - `.sh` files must stay LF (`backend/.gitattributes`).
- The notes below describe the dormant Phase 1 BFF, whose upstream contract was modelled on that
  other app (TBD — needs confirmation if a backend is ever chosen). Browser → same-origin BFF
  (`src/server/bff`, hooked in `src/server.ts`) → Express. Never call Express from browser code,
  never put the JWT anywhere but the HttpOnly cookie. See `docs/ARCHITECTURE.md`.
- BFF env is server-only (`API_UPSTREAM_URL`, `ALLOWED_ORIGINS`, `SESSION_COOKIE_SECURE`,
  `HOTEL_SLUG`) — read via `process.env` at request time, not `import.meta.env`.
- A new backend endpoint must be added to `src/server/bff/allowlist.ts` or the BFF returns 404.
- State-changing requests need `X-StayDesk-CSRF: 1` (added by `apiRequest`) and an allowlisted Origin.
- `defaultSsr: false` in `src/start.ts` — loaders run client-side only.
- BFF tests use `// @vitest-environment node`; `src/test/setup.ts` guards `window` for that.

## Phase status (demo 2026-11-09, plan gated per phase)
- Phase 1 (auth BFF) committed on branch `demo/integration-2026-11-09` (40ffacb, 2026-11-08); not pushed.
- Old Phases 2–6 superseded by the backend gates below.
- Gate 1 (domain model + OPEN_QUESTIONS Q1–Q24): **approved 2026-11-09**.
- Gate 2 (DB design, `docs/DATABASE.md` + `docs/dsd/data-model.md`): **approved 2026-11-09**.
- Gate 3a (backend skeleton, migrations 001–010, financial and booking services, idempotent demo
  seed, compose `db`/`migrate`/`seed`): **run and verified 2026-11-09** on MySQL 8.4.11.
  - All 10 migrations applied. The seed created 86 rows, and a re-run created 0.
  - Grants, triggers and checks refused every forbidden financial write.
  - Booking status has no DB trigger (service-level only).
  - The `v_invoice_balance.balance_due` for void invoices returns integer `0` instead of `0.00`. Fix
    with a new migration (never edit 009).
- Gate 3b (Express API + auth, DB integration tests, `docs/API.md`, compose `api`): in progress.
  - **P0 done 2026-11-09:** 17 tests passed on 6 runs after the READ COMMITTED fix. Results are in
    DATABASE.md §9b.
  - **Demo scope approved 2026-11-09 (D-A to D-I in `docs/domain/data-model.md` §0).** Eight
    mutations are in scope:
    - guest, booking, confirm;
    - assign room at check-in only;
    - check in, payment/advance, check out;
    - final invoice issued automatically at checkout, with server-built lines.
  - Focused P1 tests T1–T4, T2b and T7 done (DATABASE.md §9c): 32 tests passing.
  - **Plan approved 2026-11-09.** D-I stays option (a): no booking-status DB guard. Bookings get
    idempotency keys as well as payments.
  - Done: migrations 011 and 012, references, idempotency, walk-in, `ROOM_OCCUPIED`, checkout
    invoice, free rooms, `createGuest` (DATABASE.md §9d). 40 integration tests passing.
  - **API built (not yet reviewed by the user):** Express 5 + JWT (HS256, exp, account reloaded per
    request), bcrypt login with throttling, `requireRole`, strict zod bodies, the eight demo mutations
    and the read endpoints, `docs/API.md`, compose `api`. 58 integration tests (T8 = `api.itest.ts`).
  - The BFF allowlist and frontend types do not match the API yet (Gate 4). `reserved` is not emitted.
  - **Gate 4 demo integration done 2026-11-09** (user: emergency demo, deadline 9:00): BFF allowlist aligned with the API,
    `reserved` and `refunded` removed from the frontend, New booking dialog and Manage dialog
    (`src/features/bookings/`), live data on every screen. Verified in the browser on a throwaway `itest-` property:
    login → dashboard → new guest + booking → confirm → advance → check in (room picked) → checkout warning → final
    invoice → pay balance → rooms/invoices/payments updated. Screen doc: `docs/screens/reservations.md`.
  - Not done: cancel/refund/void, housekeeping, PDF, Settings tax components, role-based UI hiding.
  Test priorities agreed with the user (2026-11-09). Each test must report **which boundary
  rejected** the operation: app-user grant, DB trigger/constraint, or service validation.
  - P0:
    - concurrent invoice issue: unique numbers, no lost values on successful issues, rollback on a
      failed issue, void numbers never reused;
    - concurrent over-allocation (payment and invoice limits);
    - concurrent over-refund (requested + completed ≤ payment);
    - refund against an allocated payment (allocations stay consistent).
  - P1:
    - invalid booking transitions rejected by the service;
    - direct booking-status manipulation: check whether it can break a critical invariant (e.g.
      occupancy), and only then decide on extra DB protection. Don't mirror the whole state
      machine in triggers;
    - migration 011 fixing `balance_due` for void invoices (value and `0.00` format);
    - full regression of the seeded financial stories (balances, advances, tax snapshots).
  - Don't call the financial safeguards "fully verified" until the P0 parallel tests pass.
  - Keep the Docker DB running during 3b.
  - Never commit `.env`, generated passwords, DB dumps or real customer data.
- Gate 4 (BFF/frontend integration): not started.
- Booking-status changes are **service-only** apart from the occupancy unique key (T2b, DATABASE.md
  §9c). Check-in of a non-overlapping booking into a still-occupied room is caught only by that key
  (raw `ER_DUP_ENTRY`).
