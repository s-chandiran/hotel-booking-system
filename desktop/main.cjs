"use strict";

/**
 * StayDesk Electron main process.
 * - Starts/stops Docker Compose (never down -v)
 * - Loads the existing web UI at localhost:3000
 * - Restricted IPC: version, print by invoiceId, backup/restore, OS notification relay
 */

const path = require("node:path");
const { app, BrowserWindow, ipcMain, Notification, dialog } = require("electron");
const { ensureDataDirs } = require("./lib/paths.cjs");
const { startStack, stopStack, APP_URL } = require("./lib/docker.cjs");
const { backupNow, restoreBackup, listBackups } = require("./lib/backup.cjs");

let mainWindow = null;
let splashWindow = null;
let shuttingDown = false;
let stackStarted = false;

function preloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 280,
    frame: false,
    resizable: false,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  return splashWindow;
}

function setSplashStatus(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents
    .executeJavaScript(
      `window.staydeskSplash && window.staydeskSplash.setStatus(${JSON.stringify(String(text))})`,
    )
    .catch(() => undefined);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

async function boot() {
  ensureDataDirs();
  createSplash();
  createMainWindow();

  try {
    await startStack((status) => setSplashStatus(status));
    stackStarted = true;
    mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      console.error(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error(`[did-fail-load] ${code} ${desc} ${url}`);
    });
    // Prefer the sign-in page so the first paint does not race a guarded "/" redirect.
    const startUrl = `${APP_URL.replace(/\/$/, "")}/login`;
    await mainWindow.loadURL(startUrl);
    mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSplashStatus(message);
    dialog.showErrorBox("StayDesk could not start", message);
    // Do not wipe data. Leave Docker volumes intact even if start failed mid-way.
    app.quit();
  }
}

async function safeQuit() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (stackStarted) {
      await stopStack((s) => setSplashStatus(s));
    }
  } catch {
    // Ignore stop errors — never escalate to volume deletion.
  }
}

function registerIpc() {
  ipcMain.handle("staydesk:getVersion", () => app.getVersion());

  ipcMain.handle("staydesk:printInvoice", async (_evt, payload) => {
    const invoiceId = payload?.invoiceId;
    if (typeof invoiceId !== "string" || !/^[1-9]\d{0,17}$/.test(invoiceId)) {
      throw new Error("Invalid invoiceId");
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("Application window is not ready");
    }

    // Print window shares the session cookie jar; authorization stays in the web app.
    const printWin = new BrowserWindow({
      width: 900,
      height: 1100,
      show: false,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        session: mainWindow.webContents.session,
      },
    });

    const url = `${APP_URL.replace(/\/$/, "")}/invoices/print/${encodeURIComponent(invoiceId)}`;
    try {
      await printWin.loadURL(url);
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Print document timed out")), 30_000);
        printWin.webContents
          .executeJavaScript("window.__staydeskPrintReady === true")
          .then(async (ready) => {
            if (!ready) {
              // Wait briefly for React to mark ready.
              for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 250));
                const ok = await printWin.webContents.executeJavaScript("window.__staydeskPrintReady === true");
                if (ok) break;
              }
            }
            clearTimeout(t);
            printWin.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
              if (!success) reject(new Error(failureReason || "Print cancelled or failed"));
              else resolve();
            });
          })
          .catch(reject);
      });

      // Also save an A4 PDF under ProgramData documents.
      const dirs = ensureDataDirs();
      const pdfPath = path.join(dirs.documents, `invoice-${invoiceId}-${Date.now()}.pdf`);
      const pdf = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
      });
      require("node:fs").writeFileSync(pdfPath, pdf);
      return { ok: true, pdfPath };
    } finally {
      if (!printWin.isDestroyed()) printWin.destroy();
    }
  });

  ipcMain.handle("staydesk:backupNow", async () => backupNow());
  ipcMain.handle("staydesk:listBackups", async () => listBackups());
  ipcMain.handle("staydesk:restoreBackup", async (_evt, payload) => restoreBackup(payload));

  ipcMain.handle("staydesk:notifyPaymentPaid", async (_evt, payload) => {
    if (!Notification.isSupported()) return false;
    const number = payload?.invoiceNumber || "invoice";
    const guest = payload?.guestName || "Guest";
    const n = new Notification({
      title: "Invoice fully paid",
      body: `${number} for ${guest} is paid in full.`,
    });
    n.show();
    return true;
  });
}

app.whenReady().then(() => {
  registerIpc();
  void boot();
});

app.on("window-all-closed", () => {
  // Windows desktop app: quit when the last window closes.
  app.quit();
});

app.on("before-quit", (e) => {
  if (shuttingDown) return;
  e.preventDefault();
  void safeQuit().finally(() => app.exit(0));
});

// Unexpected termination: never run destructive compose commands from crash hooks.
process.on("uncaughtException", (err) => {
  console.error("[staydesk]", err);
});
