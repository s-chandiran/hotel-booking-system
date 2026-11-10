import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { invoiceDetailQuery, refreshAll, voidInvoice } from "@/api/actions.api";
import { ErrorNote, Field, Note, outlineBtn, primaryBtn, fieldClass } from "@/features/bookings/ui";
import { useIsAdmin } from "@/features/rooms/RoomDialogs";
import { inr } from "@/components/app/DataTable";
import { StatusBadge, type Tone } from "@/components/app/StatusBadge";
import type { Invoice } from "@/types/modules";
import { isStaydeskDesktop } from "@/lib/desktop";

const payTone: Record<Invoice["status"], [Tone, string]> = {
  paid: ["success", "Paid"],
  unpaid: ["danger", "Unpaid"],
  partial: ["warning", "Partial"],
  void: ["neutral", "Void"],
};

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
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

export function InvoiceActions({ invoice }: { invoice: Invoice }) {
  const admin = useIsAdmin();
  const [view, setView] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const canVoid = admin && invoice.status !== "void";
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={outlineBtn} onClick={() => setView(true)}>
        View
      </button>
      {canVoid ? (
        <button type="button" className={outlineBtn} onClick={() => setVoidOpen(true)}>
          Void
        </button>
      ) : null}
      {view ? <InvoiceDetailDialog invoiceId={invoice.id} onClose={() => setView(false)} /> : null}
      {voidOpen ? <VoidInvoiceDialog invoice={invoice} onClose={() => setVoidOpen(false)} /> : null}
    </div>
  );
}

function InvoiceDetailDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const q = useQuery(invoiceDetailQuery(invoiceId));
  const [printError, setPrintError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const d = q.data;
  const amountPaid = d ? (d.amountPaid ?? Math.max(0, d.amount - d.balanceDue)) : 0;

  async function onPrint() {
    if (!isStaydeskDesktop() || !window.staydesk) {
      // Browser fallback: open the authorized print route (same session cookie).
      window.open(`/invoices/print/${encodeURIComponent(invoiceId)}`, "_blank", "noopener,noreferrer");
      return;
    }
    setPrinting(true);
    setPrintError(null);
    try {
      await window.staydesk.printInvoice({ invoiceId });
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "Print failed");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <DialogShell title={d ? d.number : "Invoice"} onClose={onClose}>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {q.error ? <ErrorNote error={q.error} /> : null}
      {d ? (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={payTone[d.status][0]}>{payTone[d.status][1]}</StatusBadge>
            {d.documentStatus === "void" ? <StatusBadge tone="neutral">Document void</StatusBadge> : null}
            <span className="text-muted-foreground">{d.type === "penalty" ? "Penalty" : "Stay"}</span>
          </div>
          <p>
            {d.guestName} · booking {d.reference} · issued {d.issued}
          </p>
          {d.voidReason ? <Note tone="warning">Void reason: {d.voidReason}</Note> : null}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lines</h3>
            <ul className="space-y-1">
              {d.lines.map((l) => (
                <li key={l.lineNo} className="flex justify-between gap-3">
                  <span>
                    {l.description} × {l.quantity}
                  </span>
                  <span className="shrink-0 font-medium">{inr(l.lineNet)}</span>
                </li>
              ))}
            </ul>
          </div>
          {d.taxLines.length ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax snapshot</h3>
              <ul className="space-y-1">
                {d.taxLines.map((t) => (
                  <li key={t.code} className="flex justify-between gap-3">
                    <span>
                      {t.name} ({t.ratePercent}%)
                    </span>
                    <span className="shrink-0">{inr(t.taxAmount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-1 border-t border-border pt-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net</span>
              <span>{inr(d.net)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{inr(d.tax)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{inr(d.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount paid</span>
              <span>{d.documentStatus === "void" ? "—" : inr(amountPaid)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Balance due</span>
              <span>{d.documentStatus === "void" ? "—" : inr(d.balanceDue)}</span>
            </div>
          </div>
          {printError ? <p className="text-xs text-destructive">{printError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} onClick={onClose}>
              Close
            </button>
            <button type="button" className={outlineBtn} onClick={() => void onPrint()} disabled={printing}>
              {printing ? "Printing…" : "Print / PDF"}
            </button>
          </div>
        </div>
      ) : null}
    </DialogShell>
  );
}

function VoidInvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const m = useMutation({
    mutationFn: () => voidInvoice(invoice.id, reason.trim()),
    onSuccess: async () => {
      setDone(true);
      await refreshAll(qc);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim() || m.isPending || done) return;
    m.mutate();
  }

  return (
    <DialogShell title={`Void ${invoice.number}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">
        The invoice number and amounts stay on record. Allocated payments return to the booking as advance.
      </p>
      {done ? (
        <div className="space-y-3">
          <Note tone="success">Invoice voided.</Note>
          <button type="button" className={primaryBtn} onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={onSubmit}>
          <Field label="Reason">
            <textarea className={`${fieldClass} h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
          </Field>
          <ErrorNote error={m.error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={outlineBtn} onClick={onClose} disabled={m.isPending}>
              Cancel
            </button>
            <button type="submit" className={primaryBtn} disabled={m.isPending || !reason.trim()}>
              {m.isPending ? "Voiding…" : "Void invoice"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}
