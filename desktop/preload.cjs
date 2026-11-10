"use strict";

/**
 * Restricted bridge only. No Node, no arbitrary HTML/URL printing.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("staydesk", {
  getVersion: () => ipcRenderer.invoke("staydesk:getVersion"),
  /** Privileged print — invoiceId only; app loads the authorized document. */
  printInvoice: (payload) => {
    if (!payload || typeof payload.invoiceId !== "string" || !/^[1-9]\d{0,17}$/.test(payload.invoiceId)) {
      return Promise.reject(new Error("printInvoice requires { invoiceId: string }"));
    }
    return ipcRenderer.invoke("staydesk:printInvoice", { invoiceId: payload.invoiceId });
  },
  backupNow: () => ipcRenderer.invoke("staydesk:backupNow"),
  listBackups: () => ipcRenderer.invoke("staydesk:listBackups"),
  /**
   * Restore requires confirmToken === "RESTORE" after explicit UI confirmation.
   * Never call this without an operator prompt.
   */
  restoreBackup: (payload) => {
    if (!payload || typeof payload.backupId !== "string" || payload.confirmToken !== "RESTORE") {
      return Promise.reject(new Error('restoreBackup requires { backupId, confirmToken: "RESTORE" }'));
    }
    return ipcRenderer.invoke("staydesk:restoreBackup", {
      backupId: payload.backupId,
      confirmToken: "RESTORE",
    });
  },
  /** Renderer → main: show a Windows notification after SSE paymentPaid (no business logic in main). */
  notifyPaymentPaid: (payload) => {
    if (!payload || typeof payload !== "object") return Promise.resolve(false);
    return ipcRenderer.invoke("staydesk:notifyPaymentPaid", {
      invoiceNumber: String(payload.invoiceNumber || ""),
      guestName: String(payload.guestName || ""),
      bookingReference: String(payload.bookingReference || ""),
    });
  },
  isDesktop: true,
});
