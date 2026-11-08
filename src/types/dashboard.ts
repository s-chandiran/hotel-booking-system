// Provisional shapes: replace with the backend's real contracts once documented.
export type RoomStatus = "available" | "occupied" | "reserved" | "maintenance";

export interface DashboardStats {
  totalRooms: number;
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  checkInsToday: number;
  checkOutsToday: number;
  bookingsToday: number;
  revenueToday: number | null;
  revenueMonth: number | null;
  currency: string;
}

export interface Movement {
  id: string;
  reference: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  time: string;
  status: "pending" | "done";
}

export interface RecentBooking {
  id: string;
  reference: string;
  guestName: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  status: "confirmed" | "pending" | "cancelled" | "checked_in";
  total: number;
}

export interface RoomTile {
  number: string;
  floor: number;
  type: string;
  status: RoomStatus;
}

export interface DashboardData {
  propertyName: string;
  stats: DashboardStats;
  occupancyWeek: { day: string; rate: number }[];
  arrivals: Movement[];
  departures: Movement[];
  recentBookings: RecentBooking[];
  rooms: RoomTile[];
}
