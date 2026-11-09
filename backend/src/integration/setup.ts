import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Loads the repo-root .env (DB_PORT, DB_APP_USER/PASSWORD …). Values are never printed.
const envFile = resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env["NODE_ENV"] = "test";
// Tests run on the host, against the published port of the compose `db` service.
process.env["DB_HOST"] ||= "127.0.0.1";
// API tests sign real JWTs. A throwaway secret per run, never the one in .env.
process.env["JWT_SECRET"] = `test-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}-padding-padding`;
