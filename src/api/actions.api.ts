/**
 * The eight demo actions plus the reads their forms need (docs/API.md). Live backend only: with sample
 * data (VITE_USE_MOCK=true) the screens hide these actions instead of pretending they work.
 *
 * The client never sends a price, an invoice line, a reference or a status: the server computes them.
 * Booking and payment submissions carry an `idempotencyKey`, so a double click or retry returns the
 * original record instead of creating a second one.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";

export interface RoomType { id: string; code: string; name: string; rate: number; capacity: number }
export interface FreeRoom { id: string; number: string; floor: number | null; housekeeping: string }
export interface BookingDetail {
  id: string; reference: string; status: "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled";
  guestName: string; roomType: string; roomNumber: string; checkIn: string; checkOut: string; guests: number; source: string;
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

export const createGuest = (b: { fullName: string; email?: string; phone?: string; countryCode?: string }) => post<{ id: string }>("/api/guests", b);
export const createBooking = (b: { guestId: string; roomTypeId: string; checkInDate: string; checkOutDate: string; guestsCount: number; source: BookingSource; idempotencyKey: string }) =>
  post<{ id: string; reference: string; status: string; total: number }>("/api/bookings", b);
export const confirmBooking = (id: string) => post<{ id: string; status: string }>(`/api/bookings/${encodeURIComponent(id)}/confirm`, {});
export const checkInBooking = (id: string, roomId: string) => post<{ id: string; status: string }>(`/api/bookings/${encodeURIComponent(id)}/check-in`, { roomId });
export const checkOutBooking = (id: string) => post<CheckOutResult>(`/api/bookings/${encodeURIComponent(id)}/check-out`, {});
export const recordPayment = (b: { bookingId: string; method: PaymentMethod; amount: string; idempotencyKey: string }) =>
  post<{ id: string; reference: string; amount: number }>("/api/payments", b);

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
