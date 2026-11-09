import { createFileRoute } from "@tanstack/react-router";
import { GuestDialog } from "@/features/guests/GuestDialog";
import { outlineBtn, primaryBtn } from "@/features/bookings/ui";
import { useSuspenseQuery } from "@tanstack/react-query";
import { guestsQuery } from "@/api/modules.api";
import { DataTable, PageHeader, StatRow } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";

export const Route = createFileRoute("/guests")({
  head: () => ({
    meta: [
      { title: "Guests — StayDesk Hotel Management" },
      { name: "description", content: "Guest profiles and stay history in StayDesk." },
      { property: "og:title", content: "Guests — StayDesk Hotel Management" },
      { property: "og:description", content: "Guest profiles and stay history in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(guestsQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(guestsQuery());
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Guests" subtitle="Guest profiles and stay history.">
        <GuestDialog trigger={<button className={primaryBtn}>Add guest</button>} />
      </PageHeader>
      <StatRow items={[{ label: "Guests", value: data.length }, { label: "VIP", value: data.filter((g) => g.vip).length }, { label: "Repeat guests", value: data.filter((g) => g.stays > 1).length }, { label: "International", value: data.filter((g) => g.country !== "India").length }]} />
      <DataTable rows={data} rowKey={(g) => g.id} searchText={(g) => `${g.name} ${g.email} ${g.phone}`} columns={[
        { header: "Name", cell: (g) => <span className="font-medium">{g.name} {g.vip && <StatusBadge tone="warning">VIP</StatusBadge>}</span> },
        { header: "Email", cell: (g) => <span className="text-muted-foreground">{g.email}</span> },
        { header: "Phone", cell: (g) => g.phone },
        { header: "Country", cell: (g) => g.country },
        { header: "Stays", align: "right", cell: (g) => g.stays },
        { header: "Last stay", align: "right", cell: (g) => g.lastStay },
        { header: "", align: "right", cell: (g) => <GuestDialog guest={g} trigger={<button className={outlineBtn}>Edit</button>} /> },
      ]} />
    </div>
  );
}
