import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createRoom, refreshAll, removeRoom, roomTypesQuery, setHousekeeping, setMaintenance, updateRoom } from "@/api/actions.api";
import { meQuery } from "@/api/auth.api";
import { StatusBadge } from "@/components/app/StatusBadge";
import type { Room } from "@/types/modules";
import { ErrorNote, Field, Note, fieldClass, outlineBtn, primaryBtn } from "@/features/bookings/ui";

/** UI convenience only: the API enforces the admin role on every admin action. */
export const useIsAdmin = (): boolean => {
  const me = useQuery(meQuery());
  return me.data?.role === "admin" || me.data?.role === "super_admin";
};

export function AddRoomDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const types = useQuery({ ...roomTypesQuery(), enabled: open });
  const [number, setNumber] = useState("");
  const [typeId, setTypeId] = useState("");
  const [floor, setFloor] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createRoom({ number: number.trim(), roomTypeId: typeId, ...(floor !== "" ? { floor: Number(floor) } : {}) }),
    onSuccess: async () => {
      setDone(`Room ${number.trim()} added.`);
      await refreshAll(qc);
    },
  });
  const valid = /^[A-Za-z0-9-]{1,10}$/.test(number.trim()) && typeId !== "" && (floor === "" || Number.isInteger(Number(floor)));
  const reset = () => {
    setNumber("");
    setTypeId("");
    setFloor("");
    setDone(null);
    create.reset();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><button className={primaryBtn}>Add room</button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add room</DialogTitle>
          <DialogDescription>New rooms start available and clean. The number cannot be changed later.</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-3">
            <Note tone="success">{done}</Note>
            <div className="flex gap-2">
              <button className={outlineBtn} onClick={reset}>Add another</button>
              <button className={primaryBtn} onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid && !create.isPending) create.mutate(); }}>
            <Field label="Room number (letters, digits, hyphen; max 10)"><input className={fieldClass} value={number} maxLength={10} onChange={(e) => setNumber(e.target.value)} required /></Field>
            <Field label="Room type">
              <select className={fieldClass} value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
                <option value="">Select…</option>
                {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Floor (optional)"><input className={fieldClass} type="number" value={floor} onChange={(e) => setFloor(e.target.value)} /></Field>
            <ErrorNote error={create.error} />
            <button type="submit" className={primaryBtn} disabled={!valid || create.isPending}>{create.isPending ? "Adding…" : "Add room"}</button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RoomManager({ room, trigger }: { room: Room; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">{open && <Body room={room} />}</DialogContent>
    </Dialog>
  );
}

const HK: { value: "clean" | "dirty" | "inspecting"; label: string }[] = [
  { value: "clean", label: "Clean" },
  { value: "dirty", label: "Dirty" },
  { value: "inspecting", label: "Inspecting" },
];

function Body({ room }: { room: Room }) {
  const qc = useQueryClient();
  const admin = useIsAdmin();
  const types = useQuery({ ...roomTypesQuery(), enabled: admin });
  const [done, setDone] = useState<string | null>(null);
  const [floor, setFloor] = useState(room.floor === null || room.floor === undefined ? "" : String(room.floor));
  const [typeId, setTypeId] = useState(room.roomTypeId ?? "");
  const [reason, setReason] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = (msg: string) => async () => {
    setDone(msg);
    await refreshAll(qc);
  };

  const hk = useMutation({ mutationFn: (s: "clean" | "dirty" | "inspecting") => setHousekeeping(room.id!, s), onSuccess: (_d, s) => refresh(`Housekeeping set to ${s}.`)() });
  const edit = useMutation({
    mutationFn: () => updateRoom(room.id!, {
      ...(typeId !== room.roomTypeId ? { roomTypeId: typeId } : {}),
      ...(floor !== String(room.floor ?? "") ? { floor: floor === "" ? null : Number(floor) } : {}),
    }),
    onSuccess: refresh("Room updated."),
  });
  const maint = useMutation({
    mutationFn: (out: boolean) => setMaintenance(room.id!, out, out ? reason.trim() : undefined),
    onSuccess: (_d, out) => refresh(out ? "Room is now out of service." : "Room is back in service.")(),
  });
  const del = useMutation({
    mutationFn: () => removeRoom(room.id!, deleteReason.trim()),
    onSuccess: refresh("Room removed from inventory."),
  });
  const unchanged = typeId === room.roomTypeId && floor === String(room.floor ?? "");
  const tone = room.status === "available" ? "success" : room.status === "occupied" ? "info" : "danger";
  const label = room.status === "maintenance" ? "Out of service" : room.status === "occupied" ? "Occupied" : "Available";

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">Room {room.number} <StatusBadge tone={tone}>{label}</StatusBadge></DialogTitle>
        <DialogDescription>{room.type} · floor {room.floor ?? "—"} · housekeeping {room.housekeeping}</DialogDescription>
      </DialogHeader>
      {done && <Note tone="success">{done}</Note>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Housekeeping</h3>
        <div className="flex flex-wrap gap-2">
          {HK.map((h) => (
            <button key={h.value} className={room.housekeeping === h.value ? primaryBtn : outlineBtn} disabled={room.housekeeping === h.value || hk.isPending} onClick={() => { setDone(null); hk.mutate(h.value); }}>{h.label}</button>
          ))}
        </div>
        <ErrorNote error={hk.error} />
      </section>

      {admin && (
        <>
          <section className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">Edit room</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Floor"><input className={fieldClass} type="number" value={floor} onChange={(e) => setFloor(e.target.value)} /></Field>
              <Field label="Room type">
                <select className={fieldClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Room number cannot change. Type cannot change while a booking uses this room.</p>
            <ErrorNote error={edit.error} />
            <button className={primaryBtn} disabled={unchanged || edit.isPending} onClick={() => { setDone(null); edit.mutate(); }}>{edit.isPending ? "Saving…" : "Save changes"}</button>
          </section>
          <section className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">Maintenance</h3>
            {room.outOfService ? (
              <button className={primaryBtn} disabled={maint.isPending} onClick={() => { setDone(null); maint.mutate(false); }}>{maint.isPending ? "Updating…" : "Return to service"}</button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Temporary block (repair). Not possible while occupied or booked.</p>
                <Field label="Reason (required)"><input className={fieldClass} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
                <button className={outlineBtn} disabled={!reason.trim() || maint.isPending} onClick={() => { setDone(null); maint.mutate(true); }}>{maint.isPending ? "Updating…" : "Put out of service"}</button>
              </>
            )}
            <ErrorNote error={maint.error} />
          </section>
          {!room.outOfService ? (
            <section className="space-y-2 border-t border-border pt-3">
              <h3 className="text-sm font-semibold">Delete room</h3>
              <p className="text-xs text-muted-foreground">
                Removes the room from sellable inventory. The record is kept for booking history (not permanently erased). Restore later with Return to service.
              </p>
              {!confirmDelete ? (
                <button type="button" className={outlineBtn} onClick={() => setConfirmDelete(true)}>Delete room…</button>
              ) : (
                <>
                  <Field label="Reason (required)">
                    <input className={fieldClass} value={deleteReason} maxLength={200} onChange={(e) => setDeleteReason(e.target.value)} placeholder="e.g. Removed from inventory" />
                  </Field>
                  <ErrorNote error={del.error} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={outlineBtn} disabled={del.isPending} onClick={() => { setConfirmDelete(false); setDeleteReason(""); del.reset(); }}>Cancel</button>
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={!deleteReason.trim() || del.isPending}
                      onClick={() => { setDone(null); del.mutate(); }}
                    >
                      {del.isPending ? "Deleting…" : "Confirm delete"}
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
