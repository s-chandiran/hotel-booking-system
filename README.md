# Pixel Perfect Replica

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8851c91e-2094-4ada-afbb-4928a75cb281).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Windows desktop demo (Electron)

Offline single-PC packaging lives in [`desktop/`](desktop/). Electron starts the existing Docker Compose stack and opens the UI in a desktop window. Operator steps: [`docs/DESKTOP_OPERATOR.md`](docs/DESKTOP_OPERATOR.md).

```bat
cd desktop
npm install
npm start
```

Docker Desktop must be running. Images must already be built/pulled for a true offline demo. Quit never removes the MySQL volume.

## Docker (client demo)

Start **Docker Desktop**, then from the repo root:

```sh
cp .env.example .env
docker compose up -d --build
```

This one command starts everything in order: `db` → `migrate` (applies migrations, then exits) →
`seed` (login users + rooms, skips what already exists, then exits) → `api` → `web`. `migrate` and
`seed` showing as **Exited (0)** in `docker compose ps -a` is normal. Give `web` a few seconds after
it starts before opening the page.

Open [http://localhost:3000](http://localhost:3000).

| Username | Password | Role |
|---|---|---|
| `frontdesk` | `Demo@1234` | Front desk (bookings, check-in/out, payments) |
| `admin` | `Demo@1234` | Admin (Settings, void, reports) |
| `superadmin` | `Demo@1234` | Super admin |

Seed also creates **10 rooms**: `101–105` Normal (₹2500) and `201–205` AC (₹3500). No sample guests/bookings — create those live in the demo.

Redeploy after code changes:

```sh
docker compose down
docker compose up -d --build
```

Data stays in the `staydesk-mysql` volume across `down`/`up`. Only `docker compose down -v` deletes it.
To wipe guests/bookings/money but keep logins: `docker compose --profile tools run --rm clear-demo`.

Build-time env (rebuild `web` after changing):

- `VITE_API_BASE_URL` — leave empty; the browser calls the same-origin BFF, never Express directly

Runtime env (server-only, see `.env.example` and `docs/ARCHITECTURE.md`):

- `API_UPSTREAM_URL` — Express API origin (`http://api:5000` in Compose)
- `ALLOWED_ORIGINS` — exact origins allowed to make state-changing requests
- `SESSION_COOKIE_SECURE` — `true` behind HTTPS; `false` only for plain-http localhost

All screens load from the real MySQL-backed API through the BFF. There is no mock-data mode.
