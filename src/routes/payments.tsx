import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { paymentsQuery } from "@/api/modules.api";
import { DataTable, PageHeader, StatRow, inr } from "@/components/app/DataTable";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import type { Payment } from "@/types/modules";

const tone: Record<Payment["status"], [Tone, string]> = { success: ["success", "Received"], pending: ["warning", "Pending"], failed: ["danger", "Failed"] };

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [
      { title: "Payments — StayDesk Hotel Management" },
      { name: "description", content: "Payments received from guests in StayDesk." },
      { property: "og:title", content: "Payments — StayDesk Hotel Management" },
      { property: "og:description", content: "Payments received from guests in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(paymentsQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(paymentsQuery());
  const sum = (s: Payment["status"]) => inr(data.filter((p) => p.status === s).reduce((a, p) => a + p.amount, 0));
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Payments" subtitle="Money received against invoices." />
      <StatRow items={[{ label: "Transactions", value: data.length }, { label: "Received", value: sum("success") }, { label: "Pending", value: sum("pending") }, { label: "Refunded", value: inr(data.reduce((a, p) => a + (p.refundedAmount ?? 0), 0)) }]} />
      <DataTable rows={data} rowKey={(p) => p.id} searchText={(p) => `${p.reference} ${p.guestName} ${p.invoiceNumber} ${p.method}`} columns={[
        { header: "Reference", cell: (p) => <span className="font-medium">{p.reference}</span> },
        { header: "Guest", cell: (p) => p.guestName },
        { header: "Invoice", cell: (p) => p.invoiceNumber },
        { header: "Date", cell: (p) => p.date },
        { header: "Method", cell: (p) => p.method },
        { header: "Status", cell: (p) => <StatusBadge tone={tone[p.status][0]}>{tone[p.status][1]}</StatusBadge> },
        { header: "Amount", align: "right", cell: (p) => <span className="font-semibold">{inr(p.amount)}</span> },
      ]} />
    </div>
  );
}
