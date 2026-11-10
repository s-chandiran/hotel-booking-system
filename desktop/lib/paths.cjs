"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

/** Host data root — never inside Program Files or the .exe. */
function dataRoot() {
  const base = process.env.PROGRAMDATA || "C:\\ProgramData";
  return path.join(base, "StayDesk");
}

function ensureDataDirs() {
  const root = dataRoot();
  const dirs = {
    root,
    documents: path.join(root, "documents"),
    config: path.join(root, "config"),
    logs: path.join(root, "logs"),
    backups: path.join(root, "backups"),
  };
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

/**
 * Repo root in development; packaged resources/compose next to the installer assets.
 * Never points at the live MySQL volume.
 */
function composeProjectDir() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "..", "..");
  }
  return path.join(process.resourcesPath, "compose");
}

function composeFilePath() {
  return path.join(composeProjectDir(), "docker-compose.yml");
}

function envFilePath() {
  const packaged = path.join(composeProjectDir(), ".env");
  if (fs.existsSync(packaged)) return packaged;
  const example = path.join(composeProjectDir(), ".env.example");
  const devEnv = path.join(composeProjectDir(), ".env");
  if (fs.existsSync(devEnv)) return devEnv;
  return example;
}

module.exports = {
  dataRoot,
  ensureDataDirs,
  composeProjectDir,
  composeFilePath,
  envFilePath,
};
