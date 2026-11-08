# StayDesk frontend — agent notes

## Commands
- `npm ci` · `npm run dev` · `npm test` (vitest) · `npm run build` · `npx tsc --noEmit -p .`
- Lint: `npm run lint` fails on CRLF line endings from `core.autocrlf=true` checkouts (pre-existing,
  thousands of `Delete ␍`). For real findings: `npx eslint . --rule '{"prettier/prettier":["error",{"endOfLine":"auto"}]}'`.
- Build for the node-server image: `VITE_USE_MOCK=false NITRO_PRESET=node-server npm run build`, run
  `node .output/server/index.mjs`.
- Docker: `docker compose up --build` → http://localhost:3000.

## Architecture gotchas
- Backend = `D:\projects\Hotel` (Express, JWT Bearer). Browser → same-origin BFF
  (`src/server/bff`, hooked in `src/server.ts`) → Express. Never call Express from browser code,
  never put the JWT anywhere but the HttpOnly cookie. See `docs/ARCHITECTURE.md`.
- BFF env is server-only (`API_UPSTREAM_URL`, `ALLOWED_ORIGINS`, `SESSION_COOKIE_SECURE`,
  `HOTEL_SLUG`) — read via `process.env` at request time, not `import.meta.env`.
- A new backend endpoint must be added to `src/server/bff/allowlist.ts` or the BFF returns 404.
- State-changing requests need `X-StayDesk-CSRF: 1` (added by `apiRequest`) and an allowlisted Origin.
- `defaultSsr: false` in `src/start.ts` — loaders run client-side only.
- BFF tests use `// @vitest-environment node`; `src/test/setup.ts` guards `window` for that.
- Backend errors are `{ error: { code, message } }`; money is integer paise (convert once in adapters, Phase 3).
- Login against the real backend writes `audit_log` + `users.last_login_at`.

## Phase status (demo 2026-11-09, plan gated per phase)
- Phase 1 (auth BFF) implemented on branch `demo/integration-2026-11-09`, uncommitted, awaiting review.
- Phases 2–6 not started; each needs explicit approval.
