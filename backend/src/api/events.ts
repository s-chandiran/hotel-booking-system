/**
 * In-process event bus for desktop SSE (paymentPaid).
 * Express publishes after a committed payment allocation; BFF streams to the React renderer.
 */
import { EventEmitter } from "node:events";

export interface PaymentPaidEvent {
  invoiceId: string;
  invoiceNumber: string;
  guestName: string;
  bookingReference: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function publishPaymentPaid(event: PaymentPaidEvent): void {
  bus.emit("paymentPaid", event);
}

export function onPaymentPaid(listener: (event: PaymentPaidEvent) => void): () => void {
  bus.on("paymentPaid", listener);
  return () => {
    bus.off("paymentPaid", listener);
  };
}
