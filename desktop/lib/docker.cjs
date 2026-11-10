"use strict";

/**
 * Docker Compose lifecycle for the single-PC demo.
 * Never runs `docker compose down -v` — volumes (including MySQL) are preserved.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { composeFilePath, composeProjectDir, envFilePath, ensureDataDirs } = require("./paths.cjs");

const APP_URL = process.env.STAYDESK_APP_URL || "http://localhost:3000";
const API_HEALTH = process.env.STAYDESK_API_HEALTH || "http://127.0.0.1:5000/health";
const HEALTH_TIMEOUT_MS = Number(process.env.STAYDESK_HEALTH_TIMEOUT_MS || 180_000);
const HEALTH_POLL_MS = 2_000;

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || composeProjectDir(),
      env: opts.env || process.env,
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("Docker was not found. Install Docker Desktop and ensure `docker` is on PATH."));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function assertDockerAvailable() {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|ENOENT|dockerDesktopLinuxEngine|Cannot connect/i.test(msg)) {
      throw new Error(
        "Docker Desktop is not running or not installed. Start Docker Desktop, then open StayDesk again. Existing hotel data is left untouched.",
      );
    }
    throw new Error(`Docker is unavailable: ${msg}`);
  }
}

function composeEnv() {
  const dirs = ensureDataDirs();
  // Use the repo directory project name by default (hotel-booking-system), not a second
  // "staydesk" project that would fight for the same host ports (3307/5000/3000).
  const env = { ...process.env, STAYDESK_DOCUMENTS: dirs.documents };
  if (process.env.COMPOSE_PROJECT_NAME) {
    env.COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME;
  } else {
    delete env.COMPOSE_PROJECT_NAME;
  }
  return { env, dirs };
}

function composeArgs(subcommand) {
  const file = composeFilePath();
  if (!fs.existsSync(file)) {
    throw new Error(`docker-compose.yml not found at ${file}`);
  }
  const args = ["compose", "-f", file];
  const envFile = envFilePath();
  if (envFile && fs.existsSync(envFile) && path.basename(envFile) !== ".env.example") {
    args.push("--env-file", envFile);
  }
  args.push(...subcommand);
  return args;
}

async function alreadyHealthy() {
  try {
    const api = await fetchOk(API_HEALTH);
    const web = await fetchOk(APP_URL);
    return Boolean(api && web);
  } catch {
    return false;
  }
}

async function startStack(onStatus) {
  await assertDockerAvailable();
  const { env, dirs } = composeEnv();

  // Reuse a stack that is already up (e.g. from `docker compose up` in the repo).
  if (await alreadyHealthy()) {
    onStatus?.("Local hotel services already running…");
    return { appUrl: APP_URL, dirs };
  }

  onStatus?.("Starting local hotel services…");
  // Never pass -v. Never recreate anonymous volumes intentionally.
  await run("docker", composeArgs(["up", "-d", "--remove-orphans"]), { env });
  onStatus?.("Waiting for database, API and application…");
  await waitHealthy(onStatus);
  return { appUrl: APP_URL, dirs };
}

async function stopStack(onStatus) {
  // Stop containers only. Volumes stay. Never `down -v`.
  try {
    await assertDockerAvailable();
  } catch {
    onStatus?.("Docker unavailable on quit — leaving containers as-is (data preserved).");
    return;
  }
  const { env } = composeEnv();
  onStatus?.("Stopping StayDesk services (keeping data)…");
  try {
    await run("docker", composeArgs(["stop"]), { env });
  } catch (err) {
    onStatus?.(err instanceof Error ? err.message : String(err));
  }
}

async function waitHealthy(onStatus) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const api = await fetchOk(API_HEALTH);
      const web = await fetchOk(APP_URL);
      if (api && web) return;
      last = !api ? "API not ready" : "Application UI not ready";
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    onStatus?.(last);
    await sleep(HEALTH_POLL_MS);
  }
  throw new Error(
    `Services did not become healthy in time (${last}). Existing MySQL data was not modified. Check Docker Desktop and ports 3000/5000/3306.`,
  );
}

async function fetchOk(url) {
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
  return res.ok || (res.status >= 200 && res.status < 500);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  APP_URL,
  startStack,
  stopStack,
  assertDockerAvailable,
  composeArgs,
  composeEnv,
  run,
};
