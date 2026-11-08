// SAMPLE DATA ONLY — for visual development while the backend contract is not wired.
import type { Booking, FrontDeskItem, Guest, Invoice, Payment, ReportData, Room, SettingsData } from "@/types/modules";
import { dashboardMock } from "./dashboard.mock";

const rate: Record<string, number> = { Standard: 2600, Deluxe: 4200, Suite: 7800 };

export const roomsMock: Room[] = dashboardMock.rooms.map((r, i) => ({
  ...r,
  rate: rate[r.type] ?? 2600,
  capacity: r.type === "Suite" ? 4 : r.type === "Deluxe" ? 3 : 2,
  housekeeping: (["clean", "clean", "dirty", "inspecting"] as const)[i % 4] ?? "clean",
}));

const names = ["Ananya Rao", "Michael Chen", "Priya Nair", "Lucas Martin", "Sara Ibrahim", "Rahul Verma", "Emma Wilson", "Karthik S", "Olivia Brown", "Arjun Mehta", "Fatima Khan", "David Lee", "Meera Iyer", "Tom Becker", "Divya Menon", "Hiro Tanaka"];
const countries = ["India", "Singapore", "India", "France", "UAE", "India", "UK", "India", "USA", "India", "India", "Korea", "India", "Germany", "India", "Japan"];
const sources = ["Direct", "Booking.com", "Expedia", "Walk-in", "Phone"];
const statuses: Booking["status"][] = ["confirmed", "pending", "checked_in", "checked_out", "confirmed", "cancelled"];

export const bookingsMock: Booking[] = names.map((guestName, i) => {
  const room = roomsMock[(i * 3) % roomsMock.length]!;
  const nights = (i % 4) + 1;
  const day = 4 + (i % 12);
  return {
    id: `b${i + 1}`, reference: `BK-${10430 - i}`, guestName, roomNumber: room.number, roomType: room.type,
    checkIn: `2026-11-${String(day).padStart(2, "0")}`, checkOut: `2026-11-${String(day + nights).padStart(2, "0")}`,
    guests: (i % 3) + 1, source: sources[i % sources.length]!, status: statuses[i % statuses.length]!, total: room.rate * nights,
  };
});

export const guestsMock: Guest[] = names.map((name, i) => ({
  id: `g${i + 1}`, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
  phone: `+91 98${String(40000000 + i * 137911).slice(0, 8)}`, country: countries[i]!, stays: (i % 5) + 1,
  lastStay: `2026-${String((i % 10) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`, vip: i % 6 === 0,
}));

export const frontDeskMock: FrontDeskItem[] = [
  ...dashboardMock.arrivals.map((a, i) => ({ id: a.id, reference: a.reference, guestName: a.guestName, roomNumber: a.roomNumber, kind: "arrival" as const, time: a.time, status: a.status, balance: [0, 4200, 2600, 8400][i] ?? 0 })),
  ...dashboardMock.departures.map((d, i) => ({ id: d.id, reference: d.reference, guestName: d.guestName, roomNumber: d.roomNumber, kind: "departure" as const, time: d.time, status: d.status, balance: [0, 3150, 1200][i] ?? 0 })),
];

const invStatus: Invoice["status"][] = ["paid", "unpaid", "paid", "partial", "paid", "void"];
export const invoicesMock: Invoice[] = bookingsMock.slice(0, 12).map((b, i) => ({
  id: `i${i + 1}`, number: `INV-${2026110 + i}`, guestName: b.guestName, reference: b.reference, issued: b.checkOut,
  amount: Math.round(b.total * 1.12), tax: Math.round(b.total * 0.12), status: invStatus[i % invStatus.length]!,
}));

const methods: Payment["method"][] = ["Card", "UPI", "Cash", "Bank transfer"];
const payStatus: Payment["status"][] = ["success", "success", "pending", "success", "refunded", "failed"];
export const paymentsMock: Payment[] = invoicesMock.filter((i) => i.status !== "void").map((inv, i) => ({
  id: `p${i + 1}`, reference: `PAY-${55010 + i}`, invoiceNumber: inv.number, guestName: inv.guestName, date: inv.issued,
  method: methods[i % methods.length]!, amount: inv.status === "partial" ? Math.round(inv.amount / 2) : inv.amount, status: payStatus[i % payStatus.length]!,
}));

export const reportsMock: ReportData = {
  months: [
    { month: "Jun", revenue: 2810000, occupancy: 64, adr: 3900 }, { month: "Jul", revenue: 3020000, occupancy: 69, adr: 4010 },
    { month: "Aug", revenue: 3340000, occupancy: 74, adr: 4120 }, { month: "Sep", revenue: 3100000, occupancy: 70, adr: 4050 },
    { month: "Oct", revenue: 3710000, occupancy: 81, adr: 4300 }, { month: "Nov", revenue: 3920000, occupancy: 84, adr: 4380 },
  ],
  bySource: [{ source: "Direct", bookings: 142 }, { source: "Booking.com", bookings: 118 }, { source: "Expedia", bookings: 64 }, { source: "Walk-in", bookings: 37 }, { source: "Phone", bookings: 29 }],
  byRoomType: [{ type: "Standard", revenue: 1240000 }, { type: "Deluxe", revenue: 1580000 }, { type: "Suite", revenue: 1100000 }],
};

export const settingsMock: SettingsData = {
  property: { name: "Sample Property", address: "12 Beach Road, Chennai 600001", phone: "+91 44 2345 6789", email: "frontdesk@example.com", currency: "INR", timezone: "Asia/Kolkata", checkInTime: "14:00", checkOutTime: "11:00", taxRate: 12 },
  staff: [
    { id: "s1", name: "Front Desk", email: "frontdesk@example.com", role: "Receptionist", active: true },
    { id: "s2", name: "Lakshmi P", email: "lakshmi@example.com", role: "Manager", active: true },
    { id: "s3", name: "Vijay K", email: "vijay@example.com", role: "Housekeeping", active: true },
    { id: "s4", name: "Neha G", email: "neha@example.com", role: "Accounts", active: false },
  ],
};
