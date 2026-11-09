import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { roomsQuery } from "@/api/modules.api";
import { DataTable, PageHeader, StatRow, inr } from "@/components/app/DataTable";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import type { RoomStatus } from "@/types/dashboard";

const tone: Record<RoomStatus, [Tone, string]> = {
  available: ["success", "Available"], occupied: ["info", "Occupied"], maintenance: ["danger", "Maintenance"],
};
const hk = { clean: ["success", "Clean"], dirty: ["danger", "Dirty"], inspecting: ["warning", "Inspecting"] } as const;

export const Route = createFileRoute("/rooms")({
  head: () => ({
    meta: [
      { title: "Room Management — StayDesk Hotel Management" },
      { name: "description", content: "Room inventory, rates, status and housekeeping in StayDesk." },
      { property: "og:title", content: "Room Management — StayDesk Hotel Management" },
      { property: "og:description", content: "Room inventory, rates, status and housekeeping in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(roomsQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(roomsQuery());
  const c = (s: RoomStatus) => data.filter((r) => r.status === s).length;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Room Management" subtitle="Inventory, rates and housekeeping." />
      <StatRow items={[{ label: "Rooms", value: data.length }, { label: "Available", value: c("available") }, { label: "Occupied", value: c("occupied") }, { label: "Needs cleaning", value: data.filter((r) => r.housekeeping === "dirty").length }]} />
      <DataTable rows={data} rowKey={(r) => r.number} searchText={(r) => `${r.number} ${r.type} ${r.status}`} columns={[
        { header: "Room", cell: (r) => <span className="font-medium">{r.number}</span> },
        { header: "Floor", cell: (r) => r.floor },
        { header: "Type", cell: (r) => r.type },
        { header: "Capacity", cell: (r) => `${r.capacity} guests` },
        { header: "Status", cell: (r) => <StatusBadge tone={tone[r.status][0]}>{tone[r.status][1]}</StatusBadge> },
        { header: "Housekeeping", cell: (r) => <StatusBadge tone={hk[r.housekeeping][0]}>{hk[r.housekeeping][1]}</StatusBadge> },
        { header: "Rate / night", align: "right", cell: (r) => <span className="font-semibold">{inr(r.rate)}</span> },
      ]} />
    </div>
  );
}
