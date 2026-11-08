// Provisional shapes: replace with the backend's real contracts once documented.
import type { RoomStatus } from "./dashboard";

export type BookingStatus = "confirmed" | "pending" | "cancelled" | "checked_in" | "checked_out";

export interface Booking {
  id: string; reference: string; guestName: string; roomNumber: string; roomType: string;
  checkIn: string; checkOut: string; guests: number; source: string; status: BookingStatus; total: number;
}
export interface Room {
  number: string; floor: number; type: string; status: RoomStatus; rate: number; capacity: number; housekeeping: "clean" | "dirty" | "inspecting";
}
export interface Guest {
  id: string; name: string; email: string; phone: string; country: string; stays: number; lastStay: string; vip: boolean;
}
export interface FrontDeskItem {
  id: string; reference: string; guestName: string; roomNumber: string; kind: "arrival" | "departure"; time: string; status: "pending" | "done"; balance: number;
}
export interface Invoice {
  id: string; number: string; guestName: string; reference: string; issued: string; amount: number; tax: number; status: "paid" | "unpaid" | "partial" | "void";
}
export interface Payment {
  id: string; reference: string; invoiceNumber: string; guestName: string; date: string; method: "Card" | "UPI" | "Cash" | "Bank transfer"; amount: number; status: "success" | "pending" | "refunded" | "failed";
}
export interface ReportData {
  months: { month: string; revenue: number; occupancy: number; adr: number }[];
  bySource: { source: string; bookings: number }[];
  byRoomType: { type: string; revenue: number }[];
}
export interface SettingsData {
  property: { name: string; address: string; phone: string; email: string; currency: string; timezone: string; checkInTime: string; checkOutTime: string; taxRate: number };
  staff: { id: string; name: string; email: string; role: string; active: boolean }[];
}
