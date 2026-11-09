import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createGuest, refreshAll, updateGuest } from "@/api/actions.api";
import type { Guest } from "@/types/modules";
import { ErrorNote, Field, Note, fieldClass, outlineBtn, primaryBtn } from "@/features/bookings/ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Add a guest, or correct one's contact details. There is no delete (guest records are kept). */
export function GuestDialog({ guest, trigger }: { guest?: Guest; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">{open && <Form guest={guest} onClose={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function Form({ guest, onClose }: { guest: Guest | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(guest?.name ?? "");
  const [phone, setPhone] = useState(guest?.phone ?? "");
  const [email, setEmail] = useState(guest?.email ?? "");
  const [country, setCountry] = useState(guest?.countryCode ?? "IN");
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = { fullName: name.trim(), phone: phone.trim(), email: email.trim(), countryCode: country.trim().toUpperCase() };
      if (guest) return updateGuest(guest.id, body);
      return createGuest({ fullName: body.fullName, ...(body.phone ? { phone: body.phone } : {}), ...(body.email ? { email: body.email } : {}), ...(body.countryCode ? { countryCode: body.countryCode } : {}) });
    },
    onSuccess: async () => {
      setSaved(guest ? "Guest details saved." : "Guest added.");
      await refreshAll(qc);
    },
  });

  const problems = [
    name.trim() ? null : "Name is required.",
    email.trim() && !EMAIL.test(email.trim()) ? "Enter a valid email address." : null,
    country.trim() && !/^[A-Za-z]{2}$/.test(country.trim()) ? "Country must be a 2-letter code, for example IN." : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{guest ? `Edit ${guest.name}` : "Add guest"}</DialogTitle>
        <DialogDescription>{guest ? "Correct the contact details. Stay history and invoices are not affected." : "Guests can also be added while creating a booking."}</DialogDescription>
      </DialogHeader>
      {saved ? (
        <div className="space-y-3">
          <Note tone="success">{saved}</Note>
          <button className={primaryBtn} onClick={onClose}>Close</button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!problems.length && !save.isPending) save.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required /></Field>
            <Field label="Phone"><input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} /></Field>
            <Field label="Email"><input className={fieldClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></Field>
            <Field label="Country code"><input className={fieldClass} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="IN" /></Field>
          </div>
          {name.trim() !== "" && problems.map((p) => <p key={p} className="text-xs text-destructive">{p}</p>)}
          <ErrorNote error={save.error} />
          <div className="flex gap-2">
            <button type="submit" className={primaryBtn} disabled={problems.length > 0 || save.isPending}>{save.isPending ? "Saving…" : guest ? "Save changes" : "Add guest"}</button>
            <button type="button" className={outlineBtn} onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </>
  );
}
