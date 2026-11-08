import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { settingsQuery } from "@/api/modules.api";
import { DataTable, PageHeader } from "@/components/app/DataTable";
import { Card, StatusBadge } from "@/components/app/StatusBadge";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — StayDesk Hotel Management" },
      { name: "description", content: "Property details and staff accounts in StayDesk." },
      { property: "og:title", content: "Settings — StayDesk Hotel Management" },
      { property: "og:description", content: "Property details and staff accounts in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(settingsQuery());
  const p = data.property;
  const fields: [string, string][] = [
    ["Property name", p.name], ["Address", p.address], ["Phone", p.phone], ["Email", p.email],
    ["Currency", p.currency], ["Time zone", p.timezone], ["Check-in time", p.checkInTime], ["Check-out time", p.checkOutTime], ["Tax rate", `${p.taxRate}%`],
  ];
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Settings" subtitle="Property details and staff accounts." />
      <Card title="Property">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-sm font-medium">{v}</dd></div>
          ))}
        </dl>
      </Card>
      <DataTable title="Staff" rows={data.staff} rowKey={(s) => s.id} searchText={(s) => `${s.name} ${s.email} ${s.role}`} columns={[
        { header: "Name", cell: (s) => <span className="font-medium">{s.name}</span> },
        { header: "Email", cell: (s) => <span className="text-muted-foreground">{s.email}</span> },
        { header: "Role", cell: (s) => s.role },
        { header: "Status", cell: (s) => <StatusBadge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Disabled"}</StatusBadge> },
      ]} />
    </div>
  );
}
