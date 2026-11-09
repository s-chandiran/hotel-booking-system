import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { clearDemoData, refreshAll } from "@/api/actions.api";
import { ErrorNote, Note, outlineBtn, primaryBtn } from "@/features/bookings/ui";

/** One-click wipe for local demos: keeps logins, restores 10 rooms. */
export function ClearDemoPanel() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => clearDemoData(),
    onSuccess: async (r) => {
      setDone(`Cleared. ${r.rooms} rooms ready. Create guests and bookings from scratch.`);
      setConfirm(false);
      await refreshAll(qc);
    },
  });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Clear demo data</h2>
      <p className="text-sm text-muted-foreground">
        Deletes all guests, bookings, payments and invoices. Keeps login users. Resets inventory to{" "}
        <strong>10 rooms</strong> (5 Normal + 5 AC). Use this before practicing full CRUD.
      </p>
      {done ? <Note tone="success">{done}</Note> : null}
      <ErrorNote error={m.error} />
      {!confirm ? (
        <button type="button" className={outlineBtn} onClick={() => { setDone(null); setConfirm(true); }}>
          Clear all data…
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={outlineBtn} disabled={m.isPending} onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button type="button" className={primaryBtn} disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Clearing…" : "Yes, clear everything"}
          </button>
        </div>
      )}
    </div>
  );
}
