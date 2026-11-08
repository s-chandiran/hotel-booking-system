import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { reportsQuery } from "@/api/modules.api";
import { PageHeader, StatRow, inr } from "@/components/app/DataTable";
import { Card } from "@/components/app/StatusBadge";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — StayDesk Hotel Management" },
      { name: "description", content: "Revenue, occupancy and booking channel reports in StayDesk." },
      { property: "og:title", content: "Reports — StayDesk Hotel Management" },
      { property: "og:description", content: "Revenue, occupancy and booking channel reports in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsQuery()),
  component: Page,
});

function Bars({ items }: { items: { label: string; value: number; text: string }[] }) {
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="mb-1 flex justify-between"><span>{i.label}</span><span className="font-semibold">{i.text}</span></div>
          <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Page() {
  const { data } = useSuspenseQuery(reportsQuery());
  const last = data.months.at(-1)!;
  const total = data.months.reduce((s, m) => s + m.revenue, 0);
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Reports" subtitle="Last six months of performance." />
      <StatRow items={[{ label: "6-month revenue", value: inr(total) }, { label: "This month", value: inr(last.revenue) }, { label: "Occupancy", value: `${last.occupancy}%` }, { label: "Avg. daily rate", value: inr(last.adr) }]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Monthly revenue" className="lg:col-span-2">
          <Bars items={data.months.map((m) => ({ label: `${m.month} · ${m.occupancy}% occupancy`, value: m.revenue, text: inr(m.revenue) }))} />
        </Card>
        <Card title="Bookings by source">
          <Bars items={data.bySource.map((s) => ({ label: s.source, value: s.bookings, text: String(s.bookings) }))} />
        </Card>
        <Card title="Revenue by room type" className="lg:col-span-3">
          <Bars items={data.byRoomType.map((r) => ({ label: r.type, value: r.revenue, text: inr(r.revenue) }))} />
        </Card>
      </div>
    </div>
  );
}
