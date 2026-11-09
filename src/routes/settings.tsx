import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { settingsQuery } from "@/api/modules.api";
import { ClearDemoPanel } from "@/features/settings/ClearDemoPanel";
import { PropertySettingsForm } from "@/features/settings/PropertySettingsForm";
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
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Settings" subtitle="Property details and staff accounts. Currency, timezone and tax rates are not edited here." />
      <Card title="Property">
        <PropertySettingsForm key={`${data.property.name}|${data.property.checkInTime}|${data.property.checkOutTime}|${data.property.phone}|${data.property.email}|${data.property.address}`} property={data.property} taxComponents={data.taxComponents} />
      </Card>
      <ClearDemoPanel />
      <DataTable title="Staff" rows={data.staff} rowKey={(s) => s.id} searchText={(s) => `${s.name} ${s.email} ${s.role}`} columns={[
        { header: "Name", cell: (s) => <span className="font-medium">{s.name}</span> },
        { header: "Email", cell: (s) => <span className="text-muted-foreground">{s.email}</span> },
        { header: "Role", cell: (s) => s.role },
        { header: "Status", cell: (s) => <StatusBadge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Disabled"}</StatusBadge> },
      ]} />
    </div>
  );
}
