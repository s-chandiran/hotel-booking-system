/** Starts the real Express app on an ephemeral port for HTTP-level integration tests (CRUD increments). */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { createApp } from "../api/app.js";
import { resetLoginThrottle } from "../api/auth.js";
import { loadApiConfig } from "../api/config.js";
import { createUser, type Fixture } from "./harness.js";

export interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
type Role = "front_desk" | "admin" | "super_admin";

export interface Api {
  call: (method: string, path: string, o?: { token?: string; body?: unknown }) => Promise<Reply>;
  /** Logs in a fresh user of the role in the fixture's property and returns its token. */
  tokenFor: (role: Role) => Promise<string>;
  expectError: (r: Reply, status: number, code: string) => void;
  close: () => Promise<void>;
}

export async function startApi(fx: Fixture): Promise<Api> {
  const config = loadApiConfig();
  const slug = `itest-${fx.tag}`;
  const server = await new Promise<Server>((resolve) => {
    const s = createApp(fx.db, config).listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: Api["call"] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { accept: "application/json", "x-hotel-slug": slug };
    if (o.token) headers["authorization"] = `Bearer ${o.token}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${base}${path}`, { method, headers, body: o.body === undefined ? null : JSON.stringify(o.body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const tokenFor: Api["tokenFor"] = async (role) => {
    resetLoginThrottle();
    const u = await createUser(fx, role);
    const r = await call("POST", "/api/auth/login", { body: { username: u.username, password: u.password } });
    expect(r.status).toBe(200);
    return r.body.token as string;
  };
  const expectError: Api["expectError"] = (r, status, code) => {
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error: { code, message: expect.any(String) } });
  };
  return { call, tokenFor, expectError, close: () => new Promise((r) => server.close(() => r())) };
}
