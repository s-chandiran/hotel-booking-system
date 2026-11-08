import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { frontDeskQuery } from "@/api/modules.api";
import { DataTable, PageHeader, StatRow, inr } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { FrontDeskItem } from "@/types/modules";

export const Route = createFileRoute("/front-desk")({
  head: () => ({
    meta: [
      { title: "Check-in / Check-out — StayDesk Hotel Management" },
      { name: "description", content: "Today's arrivals and departures at the front desk." },
      { property: "og:title", content: "Check-in / Check-out — StayDesk Hotel Management" },
      { property: "og:description", content: "Today's arrivals and departures at the front desk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(frontDeskQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(frontDeskQuery());
  const arr = data.filter((d) => d.kind === "arrival");
  const dep = data.filter((d) => d.kind === "departure");
  const cols = (done: string) => [
    { header: "Reference", cell: (d: FrontDeskItem) => <span className="font-medium">{d.reference}</span> },
    { header: "Guest", cell: (d: FrontDeskItem) => d.guestName },
    { header: "Room", cell: (d: FrontDeskItem) => d.roomNumber },
    { header: "Time", cell: (d: FrontDeskItem) => d.time },
    { header: "Status", cell: (d: FrontDeskItem) => <StatusBadge tone={d.status === "done" ? "success" : "neutral"}>{d.status === "done" ? done : "Expected"}</StatusBadge> },
    { header: "Balance due", align: "right" as const, cell: (d: FrontDeskItem) => <span className="font-semibold">{inr(d.balance)}</span> },
  ];
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Check-in / Check-out" subtitle="Today's arrivals and departures." />
      <StatRow items={[{ label: "Arrivals", value: arr.length }, { label: "Checked in", value: arr.filter((a) => a.status === "done").length }, { label: "Departures", value: dep.length }, { label: "Checked out", value: dep.filter((a) => a.status === "done").length }]} />
      <DataTable title="Arrivals" rows={arr} rowKey={(d) => d.id} searchText={(d) => `${d.guestName} ${d.reference} ${d.roomNumber}`} columns={cols("Checked in")} />
      <DataTable title="Departures" rows={dep} rowKey={(d) => d.id} searchText={(d) => `${d.guestName} ${d.reference} ${d.roomNumber}`} columns={cols("Checked out")} />
    </div>
  );
}
