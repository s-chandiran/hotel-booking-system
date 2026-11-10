/**
 * Demo write actions plus the reads their forms need (docs/API.md). All calls go to the real API
 * through the BFF. The client never sends a price, an invoice line, a reference or a status: the
 * server computes them. Booking and payment submissions carry an `idempotencyKey`, so a double click
 * or retry returns the original record instead of creating a second one.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";

export interface RoomType { id: string; code: string; name: string; rate: number; capacity: number }
export interface FreeRoom { id: string; number: string; floor: number | null; housekeeping: string }
export interface BookingDetail {
  id: string; reference: string; status: "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled";
  guestName: string; roomType: string; roomNumber: string; checkIn: string; checkOut: string; guests: number; arrivalTime?: string; source: string;
  total: number; received: number; advanceHeld: number; balanceDue: number; balanceIsEstimate: boolean;
  invoices: { id: string; number: string; status: "paid" | "unpaid" | "partial" | "void"; amount: number; balanceDue: number }[];
}
export interface CheckOutResult { id: string; status: "checked_out"; invoice: { id: string; number: string; amount: number; balanceDue: number } | null }

export type BookingSource = "direct" | "booking_com" | "expedia" | "walk_in" | "phone";
export type PaymentMethod = "card" | "upi" | "cash" | "bank_transfer";

export const SOURCES: { value: BookingSource; label: string }[] = [
  { value: "direct", label: "Direct" }, { value: "phone", label: "Phone" }, { value: "walk_in", label: "Walk-in" },
  { value: "booking_com", label: "Booking.com" }, { value: "expedia", label: "Expedia" },
];
export const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" }, { value: "card", label: "Card" }, { value: "upi", label: "UPI" }, { value: "bank_transfer", label: "Bank transfer" },
];

export const newKey = (): string => crypto.randomUUID();

const post = <T>(path: string, body: unknown): Promise<T> => apiRequest<T>(path, { method: "POST", body: JSON.stringify(body) });

export const roomTypesQuery = () =>
  queryOptions({ queryKey: ["room-types"], queryFn: ({ signal }) => apiRequest<RoomType[]>("/api/room-types", { signal }), staleTime: 60_000 });
export const bookingDetailQuery = (id: string) =>
  queryOptions({ queryKey: ["booking", id], queryFn: ({ signal }) => apiRequest<BookingDetail>(`/api/bookings/${encodeURIComponent(id)}`, { signal }), staleTime: 0 });
export const freeRoomsQuery = (id: string) =>
  queryOptions({ queryKey: ["booking", id, "free-rooms"], queryFn: ({ signal }) => apiRequest<FreeRoom[]>(`/api/bookings/${encodeURIComponent(id)}/free-rooms`, { signal }), staleTime: 0 });

export type IdDocumentType = "aadhaar" | "passport" | "driving_licence";

export const createGuest = (b: {
  fullName: string;
  email?: string;
  phone?: string;
  countryCode?: string;
  idDocumentType?: IdDocumentType;
  idDocumentNumber?: string;
}) => post<{ id: string }>("/api/guests", b);
export const updateGuest = (
  id: string,
  b: {
    fullName?: string;
    email?: string;
    phone?: string;
    countryCode?: string;
    idDocumentType?: IdDocumentType | null;
    idDocumentNumber?: string | null;
  },
) => apiRequest<{ id: string }>(`/api/guests/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(b) });
export const createBooking = (b: { guestId: string; roomTypeId: string; checkInDate: string; checkOutDate: string; guestsCount: number; source: BookingSource; idempotencyKey: string }) =>
  post<{ id: string; reference: string; status: string; total: number }>("/api/bookings", b);
export const createRoom = (b: { number: string; roomTypeId: string; floor?: number }) => post<{ id: string }>("/api/rooms", b);
export const updateRoom = (id: string, b: { roomTypeId?: string; floor?: number | null }) =>
  apiRequest<{ id: string }>(`/api/rooms/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(b) });
export const setMaintenance = (id: string, outOfService: boolean, reason?: string) =>
  post<{ id: string; outOfService: boolean }>(`/api/rooms/${encodeURIComponent(id)}/maintenance`, { outOfService, ...(reason ? { reason } : {}) });
export const removeRoom = (id: string, reason: string) =>
  post<{ id: string; outOfService: true }>(`/api/rooms/${encodeURIComponent(id)}/remove`, { reason });
export const setHousekeeping = (id: string, status: "clean" | "dirty" | "inspecting") =>
  post<{ id: string; housekeeping: string }>(`/api/rooms/${encodeURIComponent(id)}/housekeeping`, { status });
export const updateBooking = (id: string, b: { checkInDate?: string; checkOutDate?: string; guestsCount?: number; expectedArrivalTime?: string | null }) =>
  apiRequest<{ id: string; nights: number; total: number }>(`/api/bookings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(b) });
export const cancelBooking = (id: string, reason: string) =>
  post<{ id: string; status: "cancelled"; advanceHeld: number }>(`/api/bookings/${encodeURIComponent(id)}/cancel`, { reason });
export const confirmBooking = (id: string) => post<{ id: string; status: string }>(`/api/bookings/${encodeURIComponent(id)}/confirm`, {});
export const checkInBooking = (id: string, roomId: string) => post<{ id: string; status: string }>(`/api/bookings/${encodeURIComponent(id)}/check-in`, { roomId });
export const checkOutBooking = (id: string) => post<CheckOutResult>(`/api/bookings/${encodeURIComponent(id)}/check-out`, {});
export const recordPayment = (b: { bookingId: string; method: PaymentMethod; amount: string; idempotencyKey: string }) =>
  post<{ id: string; reference: string; amount: number }>("/api/payments", b);

export interface RefundRow {
  id: string;
  reference: string;
  paymentId: string;
  paymentReference: string;
  guestName: string;
  amount: number;
  reason: string;
  status: "requested" | "completed" | "rejected";
  requestedAt: string;
}

export const refundsQuery = () =>
  queryOptions({
    queryKey: ["refunds"],
    queryFn: ({ signal }) => apiRequest<RefundRow[]>("/api/refunds", { signal }),
    staleTime: 15_000,
  });

export const requestRefund = (paymentId: string, b: { amount: string; reason: string; idempotencyKey: string }) =>
  post<{ id: string; reference: string; amount: number; status: string }>(`/api/payments/${encodeURIComponent(paymentId)}/refund`, b);

export const completeRefund = (id: string) => post<{ id: string; status: "completed" }>(`/api/refunds/${encodeURIComponent(id)}/complete`, {});
export const rejectRefund = (id: string) => post<{ id: string; status: "rejected" }>(`/api/refunds/${encodeURIComponent(id)}/reject`, {});

export interface InvoiceDetail {
  id: string;
  number: string;
  type: "stay" | "penalty";
  documentStatus: "issued" | "void";
  voidReason: string | null;
  guestName: string;
  reference: string;
  issued: string;
  net: number;
  tax: number;
  amount: number;
  amountPaid?: number;
  status: "paid" | "unpaid" | "partial" | "void";
  balanceDue: number;
  lines: { lineNo: number; description: string; quantity: number; unitPrice: number; lineNet: number }[];
  taxLines: { code: string; name: string; ratePercent: number; taxableBase: number; taxAmount: number }[];
}

export const invoiceDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["invoice", id],
    queryFn: ({ signal }) => apiRequest<InvoiceDetail>(`/api/invoices/${encodeURIComponent(id)}`, { signal }),
    staleTime: 0,
  });

export const voidInvoice = (id: string, reason: string) =>
  post<{ id: string; status: "void" }>(`/api/invoices/${encodeURIComponent(id)}/void`, { reason });

export type PropertySettingsPatch = {
  name?: string;
  address?: string;
  phone?: string | null;
  email?: string | null;
  checkInTime?: string;
  checkOutTime?: string;
};

export const updateSettings = (b: PropertySettingsPatch) =>
  apiRequest<{ ok: true }>("/api/settings", { method: "PATCH", body: JSON.stringify(b) });

export const clearDemoData = () => post<{ ok: true; rooms: number }>("/api/demo/clear", {});

/** After any change, every list and total may differ: refetch whatever is on screen. */
export const refreshAll = (qc: QueryClient): Promise<void> => qc.invalidateQueries();

/**
 * One idempotency key per distinct submission. Retrying the same form content reuses the key (so the
 * server returns the original record); changing the content starts a new submission with a new key.
 */
export function keyFor(slot: { sig: string; key: string } | null, payload: unknown): { sig: string; key: string } {
  const sig = JSON.stringify(payload);
  return slot && slot.sig === sig ? slot : { sig, key: newKey() };
}
