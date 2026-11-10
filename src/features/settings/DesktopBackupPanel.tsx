import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNote, Note, outlineBtn, primaryBtn } from "@/features/bookings/ui";
import { isStaydeskDesktop } from "@/lib/desktop";
import { Card } from "@/components/app/StatusBadge";

/**
 * Desktop-only backup/restore. Restore requires typing RESTORE — never silent overwrite.
 */
export function DesktopBackupPanel() {
  if (!isStaydeskDesktop() || !window.staydesk) return null;

  return (
    <Card title="Desktop backup">
      <BackupBody />
    </Card>
  );
}

function BackupBody() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["desktop-backups"],
    queryFn: () => window.staydesk!.listBackups(),
  });

  const backup = useMutation({
    mutationFn: () => window.staydesk!.backupNow(),
    onSuccess: async (r) => {
      setMessage(`Backup saved: ${r.id}`);
      await qc.invalidateQueries({ queryKey: ["desktop-backups"] });
    },
  });

  const restore = useMutation({
    mutationFn: () => {
      if (confirm !== "RESTORE" || !selected) {
        throw new Error('Type RESTORE and choose a backup before restoring.');
      }
      return window.staydesk!.restoreBackup({ backupId: selected, confirmToken: "RESTORE" });
    },
    onSuccess: (r) => {
      setMessage(`Restored from ${r.path}. Reload the app if lists look stale.`);
      setConfirm("");
    },
  });

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Creates a timestamped MySQL dump (transaction-consistent) plus the documents folder under{" "}
        <code className="text-xs">C:\ProgramData\StayDesk\backups</code>. Restore never runs without typing{" "}
        <strong>RESTORE</strong>.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={backup.isPending} onClick={() => { setMessage(null); backup.mutate(); }}>
          {backup.isPending ? "Backing up…" : "Backup now"}
        </button>
      </div>
      {list.data && list.data.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <label className="block text-xs font-medium text-muted-foreground">Restore from</label>
          <select className="w-full rounded-md border border-input bg-background px-3 py-2" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select a backup…</option>
            {list.data.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <label className="block text-xs font-medium text-muted-foreground">Type RESTORE to confirm overwrite</label>
          <input className="w-full rounded-md border border-input bg-background px-3 py-2" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" autoComplete="off" />
          <button
            type="button"
            className={outlineBtn}
            disabled={restore.isPending || confirm !== "RESTORE" || !selected}
            onClick={() => {
              setMessage(null);
              restore.mutate();
            }}
          >
            {restore.isPending ? "Restoring…" : "Restore backup"}
          </button>
        </div>
      ) : (
        <p className="text-muted-foreground">No backups yet.</p>
      )}
      {message ? <Note tone="success">{message}</Note> : null}
      <ErrorNote error={backup.error || restore.error || list.error} />
    </div>
  );
}
