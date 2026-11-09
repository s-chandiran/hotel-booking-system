import { z } from "zod";

/**
 * API settings, validated once at start. Errors name the variables, never their values.
 * JWT_SECRET is required and must be long; there is no default, so a missing secret stops the API
 * instead of silently signing tokens with a known value.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(5000),
  JWT_SECRET: z.string().min(32),
  /** Session length in seconds. The BFF cookie lives exactly as long as the token. */
  JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
  /** Property used when a login request carries no X-Hotel-Slug header. */
  HOTEL_SLUG: z.string().regex(/^[a-z0-9-]{1,40}$/).default("demo-hotel"),
});

export type ApiConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  jwtSecret: string;
  jwtTtlSeconds: number;
  defaultHotelSlug: string;
};

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const r = schema.safeParse({ ...env, HOTEL_SLUG: env["HOTEL_SLUG"] || undefined });
  if (!r.success) {
    const vars = [...new Set(r.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid or missing environment variables: ${vars}`);
  }
  const d = r.data;
  return { nodeEnv: d.NODE_ENV, port: d.API_PORT, jwtSecret: d.JWT_SECRET, jwtTtlSeconds: d.JWT_TTL_SECONDS, defaultHotelSlug: d.HOTEL_SLUG };
}
