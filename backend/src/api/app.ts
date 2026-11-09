import express, { type Express } from "express";
import type { Knex } from "knex";
import { authenticate, loginHandler, meHandler } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { errorHandler, sendError } from "./http.js";
import { readRoutes } from "./reads.js";
import { writeRoutes } from "./writes.js";

/**
 * The Express app. Deny by default: only /health and POST /api/auth/login are public. Everything else
 * under /api needs a valid Bearer JWT (sent by the BFF from its HttpOnly cookie). Browsers never call
 * this server directly (fixed decision D1), so there is no CORS.
 */
export function createApp(db: Knex, config: ApiConfig, log: (line: string) => void = () => undefined): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(express.json({ limit: "32kb" }));

  app.post("/api/auth/login", loginHandler(db, config));
  app.use("/api", authenticate(db, config));
  app.get("/api/auth/me", meHandler);
  app.use("/api", readRoutes(db));
  app.use("/api", writeRoutes(db));

  app.use((_req, res) => sendError(res, 404, "NOT_FOUND", "Not found"));
  app.use(errorHandler(log));
  return app;
}
