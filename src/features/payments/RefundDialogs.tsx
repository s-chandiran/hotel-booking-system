import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  completeRefund,
  keyFor,
  refreshAll,
  rejectRefund,
  requestRefund,
  refundsQuery,
} from "@/api/actions.api";
import { useIsAdmin } from "@/features/rooms/RoomDialogs";
import { ErrorNote, Field, Note, outlineBtn, primaryBtn, fieldClass } from "@/features/bookings/ui";
import { inr } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { Payment } from "@/types/modules";

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function RequestRefundButton({ payment }: { payment: Payment }) {
  const admin = useIsAdmin();
  const [open, setOpen] = useState(false);
  if (!admin || payment.status !== "success" || !(payment.refundableAmount && payment.refundableAmount > 0)) return null;
  return (
    <>
      <button type="button" className={outlineBtn} onClick={() => setOpen(true)}>
        Refund
      </button>
      {open ? <RequestRefundDialog payment={payment} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RequestRefundDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const qc = useQueryClient();
  const max = payment.refundableAmount ?? 0;
  const [amount, setAmount] = useState(max.toFixed(2));
  const [reason, setReason] = useState("");
  const [slot, setSlot] = useState<{ sig: string; key: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => {
      const payload = { amount: amount.trim(), reason: reason.trim() };
      const next = keyFor(slot, { paymentId: payment.id, ...payload });
      setSlot(next);
      return requestRefund(payment.id, { ...payload, idempotencyKey: next.key });
    },
    onSuccess: async (r) => {
      setDone(r.reference);
      await refreshAll(qc);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim() || !amount.trim() || m.isPending || done) return;
    m.mutate();
  }

  return (
    <DialogShell title={`Refund ${payment.reference}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">
        Guest {payment.guestName}. Up to {inr(max)} may be refunded. The original payment is never edited.
      </p>
      {done ? (
        <div className="space-y-3">
          <Note tone="success">Refund {done} requested. An admin must complete or reject it.</Note>
          <button type="button" className={primaryBtn} onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={onSubmit}>
          <Field label="Amount">
            <input className={fieldClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Reason">
            <textarea className={`${fieldClass} h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
          </Field>
          <ErrorNote error={m.error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={outlineBtn} onClick={onClose} disabled={m.isPending}>
              Cancel
            </button>
            <button type="submit" className={primaryBtn} disabled={m.isPending || !reason.trim()}>
              {m.isPending ? "Submitting…" : "Request refund"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

export function PendingRefundsPanel() {
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ ...refundsQuery(), enabled: admin });
  const pending = (data ?? []).filter((r) => r.status === "requested");

  const complete = useMutation({
    mutationFn: (id: string) => completeRefund(id),
    onSuccess: () => refreshAll(qc),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectRefund(id),
    onSuccess: () => refreshAll(qc),
  });

  if (!admin) return null;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading refunds…</p>;
  if (error) return <ErrorNote error={error} />;
  if (!pending.length) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Pending refunds</h2>
      <ul className="space-y-3">
        {pending.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                {r.reference} · {inr(r.amount)} <StatusBadge tone="warning">Requested</StatusBadge>
              </p>
              <p className="text-muted-foreground">
                {r.guestName} · payment {r.paymentReference} · {r.requestedAt}
              </p>
              <p className="text-muted-foreground">{r.reason}</p>
              <ErrorNote error={(complete.variables === r.id && complete.error) || (reject.variables === r.id && reject.error) || null} />
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className={outlineBtn}
                disabled={complete.isPending || reject.isPending}
                onClick={() => reject.mutate(r.id)}
              >
                Reject
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={complete.isPending || reject.isPending}
                onClick={() => complete.mutate(r.id)}
              >
                Complete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
