import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  bookingDetailQuery, checkInBooking, checkOutBooking, confirmBooking, freeRoomsQuery, keyFor, METHODS, recordPayment, refreshAll,
  type BookingDetail, type CheckOutResult, type PaymentMethod,
} from "@/api/actions.api";
import { inr } from "@/components/app/DataTable";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import { ErrorNote, Field, Note, fieldClass, outlineBtn, primaryBtn } from "./ui";

const statusTone: Record<BookingDetail["status"], [Tone, string]> = {
  pending: ["warning", "Pending"], confirmed: ["success", "Confirmed"], checked_in: ["info", "Checked in"], checked_out: ["neutral", "Checked out"], cancelled: ["danger", "Cancelled"],
};
const invoiceTone: Record<BookingDetail["invoices"][number]["status"], [Tone, string]> = { paid: ["success", "Paid"], unpaid: ["danger", "Unpaid"], partial: ["warning", "Partial"], void: ["neutral", "Void"] };

/** Everything a front desk does with one booking: confirm, check in (choose a room), take payment, check out. */
export function BookingManager({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) {
  return (
    <Dialog open={bookingId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{bookingId && <Body id={bookingId} />}</DialogContent>
    </Dialog>
  );
}

function Body({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useQuery(bookingDetailQuery(id));
  const [checkoutResult, setCheckoutResult] = useState<CheckOutResult | null>(null);
  const [confirmingOut, setConfirmingOut] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const b = detail.data;

  const run = <T,>(fn: () => Promise<T>, msg: string) => ({
    mutationFn: fn,
    onSuccess: async (r: T) => {
      setDone(msg);
      await refreshAll(qc);
      return r;
    },
  });

  const confirm = useMutation(run(() => confirmBooking(id), "Booking confirmed."));
  const checkOut = useMutation({
    mutationFn: () => checkOutBooking(id),
    onSuccess: async (r) => {
      setCheckoutResult(r);
      setConfirmingOut(false);
      await refreshAll(qc);
    },
  });

  if (detail.isPending) return <p className="py-8 text-center text-sm text-muted-foreground">Loading booking…</p>;
  if (detail.error || !b) return <ErrorNote error={detail.error ?? new Error("Booking could not be loaded.")} />;

  const [tone, label] = statusTone[b.status];
  const payable = b.status !== "cancelled" && (b.status !== "checked_out" || b.balanceDue > 0);

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">{b.reference} <StatusBadge tone={tone}>{label}</StatusBadge></DialogTitle>
        <DialogDescription>{b.guestName} · {b.roomType}{b.roomNumber ? ` · room ${b.roomNumber}` : " · no room yet"} · {b.checkIn} → {b.checkOut} · {b.guests} guest(s) · {b.source}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-4">
        <Money label="Room total (before tax)" value={b.total} />
        <Money label="Received" value={b.received} />
        <Money label="Advance held" value={b.advanceHeld} />
        <Money label={b.balanceIsEstimate ? "Balance due (estimate)" : "Balance due"} value={b.balanceDue} strong />
      </dl>
      {b.balanceIsEstimate && <p className="text-xs text-muted-foreground">Before checkout the balance is the room total plus tax, minus money received. The final invoice is issued automatically at checkout.</p>}

      {b.invoices.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Invoices</p>
          {b.invoices.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span className="font-medium">{i.number}</span>
              <span className="flex items-center gap-3">
                <StatusBadge tone={invoiceTone[i.status][0]}>{invoiceTone[i.status][1]}</StatusBadge>
                <span>{inr(i.amount)}</span>
                <span className="text-muted-foreground">due {i.status === "void" ? "—" : inr(i.balanceDue)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {checkoutResult && (
        <Note tone={checkoutResult.invoice && checkoutResult.invoice.balanceDue > 0 ? "warning" : "success"}>
          Checked out.{" "}
          {checkoutResult.invoice
            ? <>Final invoice <strong>{checkoutResult.invoice.number}</strong>: {inr(checkoutResult.invoice.amount)}; balance due <strong>{inr(checkoutResult.invoice.balanceDue)}</strong>.</>
            : "A final invoice already existed for this stay."}
        </Note>
      )}
      {done && <Note tone="success">{done}</Note>}

      {b.status === "pending" && (
        <Section title="Confirm booking">
          <button className={primaryBtn} disabled={confirm.isPending} onClick={() => { setDone(null); confirm.mutate(); }}>{confirm.isPending ? "Confirming…" : "Confirm booking"}</button>
          <ErrorNote error={confirm.error} />
        </Section>
      )}

      {b.status === "confirmed" && <CheckInSection id={id} onDone={() => setDone("Checked in.")} />}

      {payable && <PaymentSection key={`${b.status}-${b.received}`} id={id} balance={b.balanceDue} onDone={(ref) => { setCheckoutResult(null); setDone(`Payment ${ref} recorded.`); }} />}

      {b.status === "checked_in" && !checkoutResult && (
        <Section title="Check out">
          {confirmingOut && b.balanceDue > 0 && (
            <Note tone="warning">
              Balance due {inr(b.balanceDue)}{b.balanceIsEstimate ? " (estimate until the final invoice)" : ""}. The guest can still check out; the balance stays due on the invoice.
            </Note>
          )}
          {!confirmingOut ? (
            <button className={primaryBtn} onClick={() => { setDone(null); b.balanceDue > 0 ? setConfirmingOut(true) : checkOut.mutate(); }}>Check out</button>
          ) : (
            <div className="flex gap-2">
              <button className={primaryBtn} disabled={checkOut.isPending} onClick={() => checkOut.mutate()}>{checkOut.isPending ? "Checking out…" : "Check out anyway"}</button>
              <button className={outlineBtn} onClick={() => setConfirmingOut(false)}>Cancel</button>
            </div>
          )}
          <ErrorNote error={checkOut.error} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 border-t border-border pt-3"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>;
}
function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={strong ? "text-base font-bold" : "font-semibold"}>{inr(value)}</dd></div>;
}

function CheckInSection({ id, onDone }: { id: string; onDone: () => void }) {
  const qc = useQueryClient();
  const rooms = useQuery(freeRoomsQuery(id));
  const [roomId, setRoomId] = useState("");
  const checkIn = useMutation({
    mutationFn: () => checkInBooking(id, roomId),
    onSuccess: async () => {
      onDone();
      await refreshAll(qc);
    },
  });
  return (
    <Section title="Check in and assign a room">
      {rooms.isPending ? <p className="text-sm text-muted-foreground">Finding free rooms…</p> : rooms.error ? <ErrorNote error={rooms.error} /> : rooms.data.length === 0 ? (
        <Note tone="warning">No free room of this type for these dates.</Note>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Free rooms of the booked type">
            <select className={fieldClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Select a room…</option>
              {rooms.data.map((r) => <option key={r.id} value={r.id}>{r.number}{r.floor != null ? ` · floor ${r.floor}` : ""} · {r.housekeeping}</option>)}
            </select>
          </Field>
          <button className={primaryBtn} disabled={!roomId || checkIn.isPending} onClick={() => checkIn.mutate()}>{checkIn.isPending ? "Checking in…" : "Check in"}</button>
        </div>
      )}
      <ErrorNote error={checkIn.error} />
    </Section>
  );
}

function PaymentSection({ id, balance, onDone }: { id: string; balance: number; onDone: (reference: string) => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const slot = useRef<{ sig: string; key: string } | null>(null);
  const pay = useMutation({
    mutationFn: () => {
      slot.current = keyFor(slot.current, { id, method, amount });
      return recordPayment({ bookingId: id, method, amount, idempotencyKey: slot.current.key });
    },
    onSuccess: async (r) => {
      slot.current = null;
      onDone(r.reference);
      await refreshAll(qc);
    },
  });
  const valid = /^\d{1,10}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  return (
    <Section title="Record payment or advance">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Method">
          <select className={fieldClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Amount (₹)"><input className={fieldClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        <button className={primaryBtn} disabled={!valid || pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? "Recording…" : "Record payment"}</button>
      </div>
      <ErrorNote error={pay.error} />
    </Section>
  );
}
