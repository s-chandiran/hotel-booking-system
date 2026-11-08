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

## Docker

This is a TanStack Start app. The image runs the Nitro Node server (`node .output/server/index.mjs`) on port 3000 — not a static nginx SPA.

```sh
# optional: copy env defaults
cp .env.example .env

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

Build-time env (rebuild after changing):

- `VITE_USE_MOCK` — default `true` (sample API data)
- `VITE_API_BASE_URL` — leave empty; the browser calls the same-origin BFF, never Express directly

Runtime env (server-only, see `.env.example` and `docs/ARCHITECTURE.md`):

- `API_UPSTREAM_URL` — Express API origin (default `http://host.docker.internal:5000`)
- `ALLOWED_ORIGINS` — exact origins allowed to make state-changing requests
- `SESSION_COOKIE_SECURE` — `true` behind HTTPS; `false` only for plain-http localhost

```sh
VITE_USE_MOCK=false docker compose up --build
```
