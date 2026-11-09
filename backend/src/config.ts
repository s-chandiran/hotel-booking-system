import { z } from "zod";

/**
 * Environment is validated once, at use. Error messages name the variables only; values (passwords)
 * are never printed.
 */
const SAFE_IDENT = /^[A-Za-z0-9_]{1,32}$/;

const base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().regex(SAFE_IDENT).default("staydesk"),
});

const roles = {
  app: z.object({
    DB_APP_USER: z.string().regex(SAFE_IDENT),
    DB_APP_PASSWORD: z.string().min(1),
  }),
  migrator: z.object({
    DB_MIGRATOR_USER: z.string().regex(SAFE_IDENT),
    DB_MIGRATOR_PASSWORD: z.string().min(1),
  }),
} as const;

export type DbRole = keyof typeof roles;

export interface DbConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function fail(error: z.ZodError): never {
  const vars = [...new Set(error.issues.map((i) => i.path.join(".")))].join(", ");
  throw new Error(`Invalid or missing environment variables: ${vars}`);
}

export function loadDbConfig(role: DbRole, env: NodeJS.ProcessEnv = process.env): DbConfig {
  const b = base.safeParse(env);
  if (!b.success) fail(b.error);
  if (role === "app") {
    const r = roles.app.safeParse(env);
    if (!r.success) fail(r.error);
    return { nodeEnv: b.data.NODE_ENV, host: b.data.DB_HOST, port: b.data.DB_PORT, database: b.data.DB_NAME, user: r.data.DB_APP_USER, password: r.data.DB_APP_PASSWORD };
  }
  const r = roles.migrator.safeParse(env);
  if (!r.success) fail(r.error);
  return { nodeEnv: b.data.NODE_ENV, host: b.data.DB_HOST, port: b.data.DB_PORT, database: b.data.DB_NAME, user: r.data.DB_MIGRATOR_USER, password: r.data.DB_MIGRATOR_PASSWORD };
}

/** Name of the restricted application DB user, needed by the grants migration. */
export function appUserName(env: NodeJS.ProcessEnv = process.env): { user: string; database: string } {
  const b = base.safeParse(env);
  if (!b.success) fail(b.error);
  const u = z.string().regex(SAFE_IDENT).safeParse(env["DB_APP_USER"]);
  if (!u.success) throw new Error("Invalid or missing environment variables: DB_APP_USER");
  return { user: u.data, database: b.data.DB_NAME };
}
