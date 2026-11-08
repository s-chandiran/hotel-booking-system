import { queryOptions } from "@tanstack/react-query";
import { apiRequest, USE_MOCK } from "./client";
import { endpoints } from "./endpoints";
import type { Booking, FrontDeskItem, Guest, Invoice, Payment, ReportData, Room, SettingsData } from "@/types/modules";

type Key = "bookings" | "rooms" | "guests" | "frontDesk" | "invoices" | "payments" | "reports" | "settings";

async function fetchModule<T>(key: Key, signal?: AbortSignal): Promise<T> {
  if (USE_MOCK) {
    const m = await import("./mock/modules.mock");
    const map = { bookings: m.bookingsMock, rooms: m.roomsMock, guests: m.guestsMock, frontDesk: m.frontDeskMock, invoices: m.invoicesMock, payments: m.paymentsMock, reports: m.reportsMock, settings: m.settingsMock };
    await new Promise((r) => setTimeout(r, 200));
    return map[key] as T;
  }
  return apiRequest<T>(endpoints[key], { signal: signal ?? null });
}

const q = <T,>(key: Key) => () =>
  queryOptions({ queryKey: [key], queryFn: ({ signal }) => fetchModule<T>(key, signal), staleTime: 30_000 });

export const bookingsQuery = q<Booking[]>("bookings");
export const roomsQuery = q<Room[]>("rooms");
export const guestsQuery = q<Guest[]>("guests");
export const frontDeskQuery = q<FrontDeskItem[]>("frontDesk");
export const invoicesQuery = q<Invoice[]>("invoices");
export const paymentsQuery = q<Payment[]>("payments");
export const reportsQuery = q<ReportData>("reports");
export const settingsQuery = q<SettingsData>("settings");
