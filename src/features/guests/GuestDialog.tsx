import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createGuest, refreshAll, updateGuest } from "@/api/actions.api";
import type { Guest, IdDocumentType } from "@/types/modules";
import { ErrorNote, Field, Note, fieldClass, outlineBtn, primaryBtn } from "@/features/bookings/ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ID_TYPES: { value: IdDocumentType; label: string }[] = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "passport", label: "Passport" },
  { value: "driving_licence", label: "Driving licence" },
];

/** Add a guest, or correct one's contact details. There is no delete (guest records are kept ≥ 1 year). */
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
  const [idType, setIdType] = useState<IdDocumentType | "">(guest?.idDocumentType ?? "");
  const [idNumber, setIdNumber] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        fullName: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        countryCode: country.trim().toUpperCase(),
        ...(idType
          ? {
              idDocumentType: idType as IdDocumentType,
              ...(idNumber.trim()
                ? { idDocumentNumber: idNumber.trim() }
                : guest
                  ? {}
                  : { idDocumentNumber: idNumber.trim() }),
            }
          : {}),
      };
      if (guest) {
        const patch: Parameters<typeof updateGuest>[1] = {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          countryCode: body.countryCode,
        };
        if (idType && idNumber.trim()) {
          patch.idDocumentType = idType;
          patch.idDocumentNumber = idNumber.trim();
        }
        return updateGuest(guest.id, patch);
      }
      return createGuest({
        fullName: body.fullName,
        ...(body.phone ? { phone: body.phone } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(body.countryCode ? { countryCode: body.countryCode } : {}),
        ...(idType && idNumber.trim()
          ? { idDocumentType: idType, idDocumentNumber: idNumber.trim() }
          : {}),
      });
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
    idType && !guest && !idNumber.trim() ? "Enter the ID document number." : null,
    idNumber.trim() && !idType ? "Choose an ID document type." : null,
    idNumber.trim() && idNumber.trim().length < 4 ? "ID number must be at least 4 characters." : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{guest ? `Edit ${guest.name}` : "Add guest"}</DialogTitle>
        <DialogDescription>
          {guest
            ? "Correct the contact details. Stay history and invoices are not affected. ID numbers are masked on the guest list."
            : "Capture ID proof for police reference. Guests are kept for at least one year and cannot be deleted."}
        </DialogDescription>
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
            <Field label="ID document type">
              <select className={fieldClass} value={idType} onChange={(e) => setIdType(e.target.value as IdDocumentType | "")}>
                <option value="">Select…</option>
                {ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label={guest?.idDocumentNumberMasked ? `ID number (on file ${guest.idDocumentNumberMasked})` : "ID number"}>
              <input
                className={fieldClass}
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                maxLength={64}
                placeholder={guest ? "Leave blank to keep current" : "Enter ID number"}
                autoComplete="off"
              />
            </Field>
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
