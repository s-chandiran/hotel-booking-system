import {
  LayoutDashboard, CalendarRange, BedDouble, Users, DoorOpen, CreditCard, FileText, BarChart3, Settings,
  type LucideIcon,
} from "lucide-react";

type NavItem = { to: "/" | "/bookings" | "/rooms" | "/guests" | "/front-desk" | "/payments" | "/invoices" | "/reports" | "/settings"; label: string; icon: LucideIcon };

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/bookings", label: "Reservations", icon: CalendarRange },
      { to: "/rooms", label: "Room Management", icon: BedDouble },
      { to: "/guests", label: "Guests", icon: Users },
      { to: "/front-desk", label: "Check-in / out", icon: DoorOpen },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/payments", label: "Payments", icon: CreditCard },
      { to: "/invoices", label: "Invoices", icon: FileText },
      { to: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  { label: "System", items: [{ to: "/settings", label: "Settings", icon: Settings }] },
];

export const allNavItems = navGroups.flatMap((g) => g.items);
