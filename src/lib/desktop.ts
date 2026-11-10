/** Typed access to the Electron preload bridge (absent in a normal browser). */

export interface StaydeskDesktopBridge {
  isDesktop: true;
  getVersion: () => Promise<string>;
  printInvoice: (payload: { invoiceId: string }) => Promise<{ ok: true; pdfPath?: string }>;
  backupNow: () => Promise<{ path: string; id: string }>;
  listBackups: () => Promise<string[]>;
  restoreBackup: (payload: { backupId: string; confirmToken: "RESTORE" }) => Promise<{ ok: true; path: string }>;
  notifyPaymentPaid: (payload: {
    invoiceNumber: string;
    guestName: string;
    bookingReference: string;
  }) => Promise<boolean>;
}

declare global {
  interface Window {
    staydesk?: StaydeskDesktopBridge;
  }
}

export function isStaydeskDesktop(): boolean {
  return typeof window !== "undefined" && window.staydesk?.isDesktop === true;
}
