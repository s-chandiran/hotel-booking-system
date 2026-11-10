"use strict";

/**
 * Timestamped backup: transaction-consistent mysqldump + documents folder.
 * Restore requires explicit confirmToken === "RESTORE" and never runs silently.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ensureDataDirs, composeProjectDir } = require("./paths.cjs");
const { composeArgs, composeEnv, run, assertDockerAvailable } = require("./docker.cjs");

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(src)) return;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function backupNow() {
  await assertDockerAvailable();
  const dirs = ensureDataDirs();
  const { env } = composeEnv();
  const id = stamp();
  const bundle = path.join(dirs.backups, `staydesk-backup-${id}`);
  fs.mkdirSync(bundle, { recursive: true });
  const dumpFile = path.join(bundle, "database.sql");

  await new Promise((resolve, reject) => {
    const args = composeArgs([
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases "$MYSQL_DATABASE"',
    ]);
    const child = spawn("docker", args, {
      cwd: composeProjectDir(),
      env,
      windowsHide: true,
    });
    const out = fs.createWriteStream(dumpFile);
    let stderr = "";
    child.stdout.pipe(out);
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `mysqldump failed (${code})`));
    });
  });

  copyDir(dirs.documents, path.join(bundle, "documents"));
  fs.writeFileSync(
    path.join(bundle, "manifest.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), id, includes: ["database.sql", "documents"] }, null, 2),
  );
  return { path: bundle, id };
}

/**
 * @param {{ backupId: string, confirmToken: string }} input
 * confirmToken must be exactly "RESTORE".
 */
async function restoreBackup(input) {
  if (!input || input.confirmToken !== "RESTORE") {
    throw new Error('Restore refused: pass confirmToken "RESTORE" after an explicit operator confirmation.');
  }
  if (!input.backupId || !/^[A-Za-z0-9._-]+$/.test(input.backupId)) {
    throw new Error("Restore refused: invalid backup id.");
  }
  await assertDockerAvailable();
  const dirs = ensureDataDirs();
  const bundle = path.join(dirs.backups, input.backupId);
  const dumpFile = path.join(bundle, "database.sql");
  if (!fs.existsSync(dumpFile)) {
    throw new Error(`Restore refused: backup not found at ${bundle}`);
  }

  // Health gate: API must respond before we touch the live DB.
  const health = await fetch("http://127.0.0.1:5000/health", { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!health || !health.ok) {
    throw new Error("Restore refused: local API is unhealthy. Start StayDesk services first; live data was not changed.");
  }

  const { env } = composeEnv();
  const sql = fs.readFileSync(dumpFile);
  await new Promise((resolve, reject) => {
    const args = composeArgs([
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"',
    ]);
    const child = spawn("docker", args, {
      cwd: composeProjectDir(),
      env,
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.stdin.write(sql);
    child.stdin.end();
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `mysql restore failed (${code})`));
    });
  });

  const docsSrc = path.join(bundle, "documents");
  if (fs.existsSync(docsSrc)) {
    copyDir(docsSrc, dirs.documents);
  }
  return { ok: true, path: bundle };
}

async function listBackups() {
  const dirs = ensureDataDirs();
  return fs
    .readdirSync(dirs.backups, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("staydesk-backup-"))
    .map((e) => e.name)
    .sort()
    .reverse();
}

module.exports = { backupNow, restoreBackup, listBackups };
