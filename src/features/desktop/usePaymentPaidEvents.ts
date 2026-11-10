import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isStaydeskDesktop } from "@/lib/desktop";

interface PaymentPaidPayload {
  invoiceId: string;
  invoiceNumber: string;
  guestName: string;
  bookingReference: string;
}

/**
 * Express paymentPaid → Nitro BFF SSE → React → Electron IPC → Windows notification.
 * Also invalidates queries so dashboards refresh. Safe no-op when EventSource fails.
 *
 * Pass `queryClient` from the router context — RootComponent mounts this hook above
 * QueryClientProvider, so useQueryClient() is not available here.
 */
export function usePaymentPaidEvents(enabled: boolean, queryClient: QueryClient): void {
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    let closed = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource("/api/events");
      } catch {
        return;
      }
      es.addEventListener("paymentPaid", (msg) => {
        let data: PaymentPaidPayload | null = null;
        try {
          data = JSON.parse((msg as MessageEvent).data) as PaymentPaidPayload;
        } catch {
          return;
        }
        void queryClient.invalidateQueries();
        if (isStaydeskDesktop() && window.staydesk) {
          void window.staydesk.notifyPaymentPaid({
            invoiceNumber: data.invoiceNumber,
            guestName: data.guestName,
            bookingReference: data.bookingReference,
          });
        }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        // Do not hammer reconnect while signed out / unauthorized.
        if (!closed) retryTimer = setTimeout(connect, 15_000);
      };
    };

    connect();

    const onFocus = () => {
      void queryClient.invalidateQueries();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, queryClient]);
}
