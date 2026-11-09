import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BedDouble, CalendarPlus, DoorOpen, LogIn, LogOut, Wrench, Wallet, KeyRound } from "lucide-react";
import { dashboardQuery } from "@/api/dashboard.api";
import { Card, EmptyState, StatusBadge, type Tone } from "@/components/app/StatusBadge";
import type { Movement, RecentBooking, RoomStatus } from "@/types/dashboard";
import { cn } from "@/lib/utils";

const roomTone: Record<RoomStatus, { tone: Tone; label: string; tile: string }> = {
  available: { tone: "success", label: "Available", tile: "bg-success-soft text-success" },
  occupied: { tone: "info", label: "Occupied", tile: "bg-info-soft text-info" },
  maintenance: { tone: "danger", label: "Maintenance", tile: "bg-danger-soft text-destructive" },
};
const bookingTone: Record<RecentBooking["status"], { tone: Tone; label: string }> = {
  confirmed: { tone: "success", label: "Confirmed" },
  pending: { tone: "warning", label: "Pending" },
  cancelled: { tone: "danger", label: "Cancelled" },
  checked_in: { tone: "info", label: "Checked in" },
  checked_out: { tone: "neutral", label: "Checked out" },
};

const greeting = (): string => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export function Dashboard() {
  const { data } = useSuspenseQuery(dashboardQuery());
  const s = data.stats;
  const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: s.currency, maximumFractionDigits: 0 }).format(n);
  const occ = Math.round((s.occupied / s.totalRooms) * 100);

  const stats = [
    { label: "Total rooms", value: s.totalRooms, icon: BedDouble, tone: "text-foreground bg-muted" },
    { label: "Available", value: s.available, icon: KeyRound, tone: "text-success bg-success-soft" },
    { label: "Occupied", value: s.occupied, icon: DoorOpen, tone: "text-info bg-info-soft" },
    { label: "Maintenance", value: s.maintenance, icon: Wrench, tone: "text-destructive bg-danger-soft" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{greeting()}</h2>
          <p className="text-sm text-muted-foreground">Here's what's happening at {data.propertyName} today.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <QuickAction to="/bookings" icon={CalendarPlus} label="New booking" primary />
          <QuickAction to="/front-desk" icon={LogIn} label="Arrivals" />
          <QuickAction to="/front-desk" icon={LogOut} label="Departures" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="card-surface flex items-center gap-3 p-4">
            <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tone)}><Icon className="size-5" /></div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Occupancy this week" className="lg:col-span-2" action={<span className="text-xs text-muted-foreground">Today {occ}%</span>}>
          <div className="flex h-44 items-end gap-2 sm:gap-4">
            {data.occupancyWeek.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{d.rate}%</span>
                <div className="w-full rounded-md bg-muted" style={{ height: "120px" }}>
                  <div className="h-full w-full origin-bottom rounded-md bg-primary transition-transform" style={{ transform: `scaleY(${d.rate / 100})` }} />
                </div>
                <span className="text-xs text-muted-foreground">{d.day}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Today at a glance">
          <ul className="space-y-3 text-sm">
            <Glance label="Check-ins" value={s.checkInsToday} />
            <Glance label="Check-outs" value={s.checkOutsToday} />
            <Glance label="New bookings" value={s.bookingsToday} />
            {s.revenueToday !== null && <Glance label="Revenue today" value={money(s.revenueToday)} />}
            {s.revenueMonth !== null && <Glance label="Revenue this month" value={money(s.revenueMonth)} />}
          </ul>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
            <Wallet className="size-4" /> Revenue figures come from the billing system.
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <MovementList title="Today's arrivals" items={data.arrivals} doneLabel="Checked in" />
        <MovementList title="Today's departures" items={data.departures} doneLabel="Checked out" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card title="Room status" className="xl:col-span-2" action={<Link to="/rooms" className="text-xs font-semibold text-primary">View rooms</Link>}>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(roomTone) as RoomStatus[]).map((k) => <StatusBadge key={k} tone={roomTone[k].tone}>{roomTone[k].label}</StatusBadge>)}
          </div>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10 xl:grid-cols-8">
            {data.rooms.map((r) => (
              <div key={r.number} title={`${r.number} · ${r.type} · ${roomTone[r.status].label}`} className={cn("rounded-md py-2 text-center text-xs font-semibold", roomTone[r.status].tile)}>
                {r.number}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Recent bookings" className="xl:col-span-3" action={<Link to="/bookings" className="text-xs font-semibold text-primary">View all</Link>}>
          {data.recentBookings.length === 0 ? <EmptyState text="No bookings yet." /> : (
            <>
              <ul className="divide-y divide-border md:hidden">
                {data.recentBookings.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{b.guestName}</p>
                      <p className="text-xs text-muted-foreground">{b.reference} · Room {b.roomNumber}</p>
                    </div>
                    <StatusBadge tone={bookingTone[b.status].tone}>{bookingTone[b.status].label}</StatusBadge>
                  </li>
                ))}
              </ul>
              <table className="hidden w-full text-sm md:table">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="pb-2 font-medium">Reference</th><th className="pb-2 font-medium">Guest</th><th className="pb-2 font-medium">Room</th><th className="pb-2 font-medium">Stay</th><th className="pb-2 font-medium">Status</th><th className="pb-2 text-right font-medium">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recentBookings.map((b) => (
                    <tr key={b.id}>
                      <td className="py-3 font-medium">{b.reference}</td>
                      <td className="py-3">{b.guestName}</td>
                      <td className="py-3">{b.roomNumber}</td>
                      <td className="py-3 text-muted-foreground">{b.checkIn.slice(5)} → {b.checkOut.slice(5)}</td>
                      <td className="py-3"><StatusBadge tone={bookingTone[b.status].tone}>{bookingTone[b.status].label}</StatusBadge></td>
                      <td className="py-3 text-right font-semibold">{money(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Glance({ label, value }: { label: string; value: React.ReactNode }) {
  return <li className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{value}</span></li>;
}

function QuickAction({ to, icon: Icon, label, primary }: { to: "/bookings" | "/front-desk"; icon: typeof LogIn; label: string; primary?: boolean }) {
  return (
    <Link to={to} className={cn("inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors", primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border bg-card hover:bg-muted")}>
      <Icon className="size-4" /> {label}
    </Link>
  );
}

function MovementList({ title, items, doneLabel }: { title: string; items: Movement[]; doneLabel: string }) {
  return (
    <Card title={title} action={<span className="text-xs text-muted-foreground">{items.length} guests</span>}>
      {items.length === 0 ? <EmptyState text="Nothing scheduled today." /> : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                {m.guestName.split(" ").map((p) => p[0]).join("").slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.guestName}</p>
                <p className="truncate text-xs text-muted-foreground">Room {m.roomNumber} · {m.roomType} · {m.time}</p>
              </div>
              <StatusBadge tone={m.status === "done" ? "success" : "neutral"}>{m.status === "done" ? doneLabel : "Expected"}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
