import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { invoicesQuery } from "@/api/modules.api";
import { InvoiceActions } from "@/features/invoices/InvoiceDialogs";
import { DataTable, PageHeader, StatRow, inr } from "@/components/app/DataTable";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import type { Invoice } from "@/types/modules";

const tone: Record<Invoice["status"], [Tone, string]> = { paid: ["success", "Paid"], unpaid: ["danger", "Unpaid"], partial: ["warning", "Partial"], void: ["neutral", "Void"] };

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices — StayDesk Hotel Management" },
      { name: "description", content: "Guest invoices, taxes and payment status in StayDesk." },
      { property: "og:title", content: "Invoices — StayDesk Hotel Management" },
      { property: "og:description", content: "Guest invoices, taxes and payment status in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(invoicesQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(invoicesQuery());
  const live = data.filter((i) => i.status !== "void");
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Invoices" subtitle="Billing for guest stays. Issued amounts are never edited; void keeps the number on record." />
      <StatRow items={[{ label: "Invoices", value: data.length }, { label: "Billed", value: inr(live.reduce((s, i) => s + i.amount, 0)) }, { label: "Unpaid", value: data.filter((i) => i.status === "unpaid").length }, { label: "Tax collected", value: inr(live.reduce((s, i) => s + i.tax, 0)) }]} />
      <DataTable rows={data} rowKey={(i) => i.id} searchText={(i) => `${i.number} ${i.guestName} ${i.reference}`} columns={[
        { header: "Invoice", cell: (i) => <span className="font-medium">{i.number}</span> },
        { header: "Guest", cell: (i) => i.guestName },
        { header: "Booking", cell: (i) => i.reference },
        { header: "Issued", cell: (i) => i.issued },
        { header: "Status", cell: (i) => <StatusBadge tone={tone[i.status][0]}>{tone[i.status][1]}</StatusBadge> },
        { header: "Tax", align: "right", cell: (i) => inr(i.tax) },
        { header: "Total", align: "right", cell: (i) => <span className="font-semibold">{inr(i.amount)}</span> },
        { header: "Paid", align: "right", cell: (i) => (i.status === "void" ? "—" : inr(i.amountPaid ?? Math.max(0, i.amount - (i.balanceDue ?? 0)))) },
        { header: "Balance due", align: "right", cell: (i) => (i.status === "void" ? "—" : inr(i.balanceDue ?? 0)) },
        { header: "", align: "right", cell: (i) => <InvoiceActions invoice={i} /> },
      ]} />
    </div>
  );
}
