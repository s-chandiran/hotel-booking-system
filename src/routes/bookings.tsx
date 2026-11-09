import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { BookingManager } from "@/features/bookings/BookingManager";
import { NewBookingDialog } from "@/features/bookings/NewBookingDialog";
import { outlineBtn } from "@/features/bookings/ui";
import { bookingsQuery } from "@/api/modules.api";
import { DataTable, PageHeader, StatRow, inr } from "@/components/app/DataTable";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import type { BookingStatus } from "@/types/modules";

const tone: Record<BookingStatus, [Tone, string]> = {
  confirmed: ["success", "Confirmed"], pending: ["warning", "Pending"], cancelled: ["danger", "Cancelled"],
  checked_in: ["info", "Checked in"], checked_out: ["neutral", "Checked out"],
};

export const Route = createFileRoute("/bookings")({
  head: () => ({
    meta: [
      { title: "Reservations — StayDesk Hotel Management" },
      { name: "description", content: "View and manage hotel reservations in StayDesk." },
      { property: "og:title", content: "Reservations — StayDesk Hotel Management" },
      { property: "og:description", content: "View and manage hotel reservations in StayDesk." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(bookingsQuery()),
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(bookingsQuery());
  const [managing, setManaging] = useState<string | null>(null);
  const c = (s: BookingStatus) => data.filter((b) => b.status === s).length;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader title="Reservations" subtitle="All bookings across channels.">
        <NewBookingDialog />
      </PageHeader>
      <StatRow items={[{ label: "Total", value: data.length }, { label: "Confirmed", value: c("confirmed") }, { label: "Pending", value: c("pending") }, { label: "In house", value: c("checked_in") }]} />
      <DataTable rows={data} rowKey={(b) => b.id} searchText={(b) => `${b.reference} ${b.guestName} ${b.roomNumber}`} columns={[
        { header: "Reference", cell: (b) => <span className="font-medium">{b.reference}</span> },
        { header: "Guest", cell: (b) => b.guestName },
        { header: "Room", cell: (b) => `${b.roomNumber || "Not assigned"} · ${b.roomType}` },
        { header: "Stay", cell: (b) => <span className="text-muted-foreground">{b.checkIn} → {b.checkOut}</span> },
        { header: "Source", cell: (b) => b.source },
        { header: "Status", cell: (b) => <StatusBadge tone={tone[b.status][0]}>{tone[b.status][1]}</StatusBadge> },
        { header: "Total", align: "right", cell: (b) => <span className="font-semibold">{inr(b.total)}</span> },
        { header: "", align: "right", cell: (b) => <button className={outlineBtn} onClick={() => setManaging(b.id)}>Manage</button> },
      ]} />
      <BookingManager bookingId={managing} onClose={() => setManaging(null)} />
    </div>
  );
}
