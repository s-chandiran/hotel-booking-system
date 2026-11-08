// SAMPLE DATA ONLY — for visual development while the backend contract is not wired.
import type { DashboardData, RoomStatus, RoomTile } from "@/types/dashboard";

const types = ["Standard", "Deluxe", "Suite"];
const pattern: RoomStatus[] = ["occupied", "available", "occupied", "reserved", "available", "occupied", "maintenance", "occupied", "available", "reserved"];
const rooms: RoomTile[] = [1, 2, 3, 4].flatMap((floor) =>
  Array.from({ length: 10 }, (_, i) => ({
    number: `${floor}${String(i + 1).padStart(2, "0")}`,
    floor,
    type: types[(i + floor) % 3] ?? "Standard",
    status: pattern[(i + floor * 3) % pattern.length] ?? "available",
  })),
);
const count = (s: RoomStatus) => rooms.filter((r) => r.status === s).length;

export const dashboardMock: DashboardData = {
  propertyName: "Sample Property",
  stats: {
    totalRooms: rooms.length,
    available: count("available"),
    occupied: count("occupied"),
    reserved: count("reserved"),
    maintenance: count("maintenance"),
    checkInsToday: 6,
    checkOutsToday: 4,
    bookingsToday: 9,
    revenueToday: 184500,
    revenueMonth: 3920000,
    currency: "INR",
  },
  occupancyWeek: [
    { day: "Mon", rate: 62 }, { day: "Tue", rate: 58 }, { day: "Wed", rate: 71 },
    { day: "Thu", rate: 76 }, { day: "Fri", rate: 88 }, { day: "Sat", rate: 94 }, { day: "Sun", rate: 80 },
  ],
  arrivals: [
    { id: "a1", reference: "BK-10421", guestName: "Ananya Rao", roomNumber: "204", roomType: "Deluxe", time: "12:00", status: "done" },
    { id: "a2", reference: "BK-10422", guestName: "Michael Chen", roomNumber: "310", roomType: "Suite", time: "14:00", status: "pending" },
    { id: "a3", reference: "BK-10425", guestName: "Priya Nair", roomNumber: "105", roomType: "Standard", time: "15:30", status: "pending" },
    { id: "a4", reference: "BK-10427", guestName: "Lucas Martin", roomNumber: "402", roomType: "Deluxe", time: "18:00", status: "pending" },
  ],
  departures: [
    { id: "d1", reference: "BK-10388", guestName: "Sara Ibrahim", roomNumber: "208", roomType: "Standard", time: "10:00", status: "done" },
    { id: "d2", reference: "BK-10391", guestName: "Rahul Verma", roomNumber: "303", roomType: "Suite", time: "11:00", status: "pending" },
    { id: "d3", reference: "BK-10395", guestName: "Emma Wilson", roomNumber: "109", roomType: "Deluxe", time: "12:00", status: "pending" },
  ],
  recentBookings: [
    { id: "b1", reference: "BK-10430", guestName: "Karthik S", roomNumber: "206", checkIn: "2026-11-10", checkOut: "2026-11-13", status: "confirmed", total: 21600 },
    { id: "b2", reference: "BK-10429", guestName: "Olivia Brown", roomNumber: "401", checkIn: "2026-11-09", checkOut: "2026-11-11", status: "pending", total: 18400 },
    { id: "b3", reference: "BK-10428", guestName: "Arjun Mehta", roomNumber: "305", checkIn: "2026-11-08", checkOut: "2026-11-12", status: "checked_in", total: 42000 },
    { id: "b4", reference: "BK-10426", guestName: "Fatima Khan", roomNumber: "102", checkIn: "2026-11-14", checkOut: "2026-11-15", status: "cancelled", total: 5200 },
    { id: "b5", reference: "BK-10424", guestName: "David Lee", roomNumber: "207", checkIn: "2026-11-12", checkOut: "2026-11-16", status: "confirmed", total: 28800 },
  ],
  rooms,
};
