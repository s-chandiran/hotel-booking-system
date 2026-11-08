import { createFileRoute } from "@tanstack/react-router";
import { dashboardQuery } from "@/api/dashboard.api";
import { Dashboard } from "@/features/dashboard/Dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — StayDesk Hotel Management" },
      { name: "description", content: "Live overview of rooms, arrivals, departures and bookings for your hotel." },
      { property: "og:title", content: "Dashboard — StayDesk Hotel Management" },
      { property: "og:description", content: "Live overview of rooms, arrivals, departures and bookings for your hotel." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery()),
  component: Dashboard,
  pendingComponent: () => (
    <div className="grid gap-3 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="card-surface h-20 animate-pulse" />)}</div>
  ),
});
