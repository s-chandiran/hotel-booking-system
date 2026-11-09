import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createBooking, createGuest, keyFor, refreshAll, roomTypesQuery, SOURCES, type BookingSource } from "@/api/actions.api";
import { guestsQuery } from "@/api/modules.api";
import { ErrorNote, Field, Note, addDaysIso, fieldClass, outlineBtn, primaryBtn, todayIso } from "./ui";

/**
 * Creates a booking (and, if needed, its guest). The server generates the reference, takes the rate from
 * the room type and decides the status (walk-ins are confirmed). No room is chosen here: it is assigned at check-in.
 */
export function NewBookingDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const types = useQuery({ ...roomTypesQuery(), enabled: open });
  const guests = useQuery({ ...guestsQuery(), enabled: open });

  const [guestMode, setGuestMode] = useState<"existing" | "new">("existing");
  const [guestId, setGuestId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("IN");
  const [typeId, setTypeId] = useState("");
  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState(addDaysIso(todayIso(), 1));
  const [count, setCount] = useState(1);
  const [source, setSource] = useState<BookingSource>("direct");
  const [created, setCreated] = useState<{ reference: string; status: string; total: number } | null>(null);

  // Retry safety: the same content reuses its idempotency key and an already-created guest.
  const bookingKey = useRef<{ sig: string; key: string } | null>(null);
  const guestSlot = useRef<{ sig: string; id: string } | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      let gid = guestId;
      if (guestMode === "new") {
        const g = { fullName: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), ...(email.trim() ? { email: email.trim() } : {}), ...(country.trim() ? { countryCode: country.trim() } : {}) };
        const sig = JSON.stringify(g);
        if (guestSlot.current?.sig === sig) gid = guestSlot.current.id;
        else {
          gid = (await createGuest(g)).id;
          guestSlot.current = { sig, id: gid };
        }
      }
      const payload = { guestId: gid, roomTypeId: typeId, checkInDate: checkIn, checkOutDate: checkOut, guestsCount: count, source };
      bookingKey.current = { ...keyFor(bookingKey.current, payload) };
      return createBooking({ ...payload, idempotencyKey: bookingKey.current.key });
    },
    onSuccess: async (b) => {
      setCreated(b);
      bookingKey.current = null;
      guestSlot.current = null;
      await refreshAll(qc);
    },
  });

  const type = types.data?.find((t) => t.id === typeId);
  const valid = (guestMode === "existing" ? !!guestId : name.trim().length > 0) && !!typeId && checkOut > checkIn && count >= 1 && (!type || count <= type.capacity);

  const reset = () => {
    setCreated(null);
    submit.reset();
    setGuestId("");
    setName("");
    setPhone("");
    setEmail("");
    setCount(1);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <button className={primaryBtn}><CalendarPlus className="mr-2 size-4" /> New booking</button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>The rate comes from the room type and the room is assigned at check-in.</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <Note tone="success">
              Booking <strong>{created.reference}</strong> created as <strong>{created.status}</strong>. Room total ₹{created.total.toLocaleString("en-IN")} (before tax).
            </Note>
            <div className="flex gap-2">
              <button className={outlineBtn} onClick={reset}>Create another</button>
              <button className={primaryBtn} onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid && !submit.isPending) submit.mutate(); }}>
            <div className="flex gap-2 text-sm">
              {(["existing", "new"] as const).map((m) => (
                <button type="button" key={m} onClick={() => setGuestMode(m)} className={guestMode === m ? primaryBtn : outlineBtn}>{m === "existing" ? "Existing guest" : "New guest"}</button>
              ))}
            </div>
            {guestMode === "existing" ? (
              <Field label="Guest">
                <select className={fieldClass} value={guestId} onChange={(e) => setGuestId(e.target.value)} required>
                  <option value="">Select a guest…</option>
                  {guests.data?.map((g) => <option key={g.id} value={g.id}>{g.name}{g.phone ? ` · ${g.phone}` : ""}</option>)}
                </select>
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name"><input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required /></Field>
                <Field label="Phone"><input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} /></Field>
                <Field label="Email"><input type="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></Field>
                <Field label="Country code"><input className={fieldClass} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="IN" /></Field>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Room type">
                <select className={fieldClass} value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
                  <option value="">Select…</option>
                  {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name} · ₹{t.rate.toLocaleString("en-IN")}/night</option>)}
                </select>
              </Field>
              <Field label="Source">
                <select className={fieldClass} value={source} onChange={(e) => setSource(e.target.value as BookingSource)}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Check-in"><input type="date" className={fieldClass} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required /></Field>
              <Field label="Check-out"><input type="date" className={fieldClass} value={checkOut} min={addDaysIso(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} required /></Field>
              <Field label={`Guests${type ? ` (max ${type.capacity})` : ""}`}>
                <input type="number" className={fieldClass} value={count} min={1} max={type?.capacity ?? 20} onChange={(e) => setCount(Number(e.target.value))} required />
              </Field>
            </div>
            {source === "walk_in" && <p className="text-xs text-muted-foreground">Walk-in bookings are created confirmed.</p>}
            <ErrorNote error={submit.error} />
            <button type="submit" className={primaryBtn} disabled={!valid || submit.isPending}>{submit.isPending ? "Creating…" : "Create booking"}</button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
