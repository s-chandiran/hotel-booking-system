import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { refreshAll, updateSettings } from "@/api/actions.api";
import { ErrorNote, Field, Note, fieldClass, outlineBtn, primaryBtn } from "@/features/bookings/ui";
import type { SettingsData } from "@/types/modules";

export function PropertySettingsForm({
  property,
  taxComponents,
}: {
  property: SettingsData["property"];
  taxComponents?: SettingsData["taxComponents"];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(property.name);
  const [address, setAddress] = useState(property.address);
  const [phone, setPhone] = useState(property.phone);
  const [email, setEmail] = useState(property.email);
  const [checkInTime, setCheckInTime] = useState(property.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(property.checkOutTime);
  const [done, setDone] = useState(false);

  const m = useMutation({
    mutationFn: () =>
      updateSettings({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        checkInTime,
        checkOutTime,
      }),
    onSuccess: async () => {
      setDone(true);
      await refreshAll(qc);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (m.isPending) return;
    setDone(false);
    m.mutate();
  }

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Property name">
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
          </Field>
          <Field label="Phone">
            <input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Email">
            <input className={fieldClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
          </Field>
          <Field label="Address">
            <input className={fieldClass} value={address} onChange={(e) => setAddress(e.target.value)} required maxLength={500} />
          </Field>
          <Field label="Check-in time">
            <input className={fieldClass} type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} required />
          </Field>
          <Field label="Check-out time">
            <input className={fieldClass} type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} required />
          </Field>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Currency</dt>
            <dd className="text-sm font-medium">{property.currency}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Time zone</dt>
            <dd className="text-sm font-medium">{property.timezone}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tax rate (in effect)</dt>
            <dd className="text-sm font-medium">{property.taxRate}%</dd>
          </div>
        </dl>
        <ErrorNote error={m.error} />
        {done ? <Note tone="success">Property details saved.</Note> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={outlineBtn}
            disabled={m.isPending}
            onClick={() => {
              setName(property.name);
              setAddress(property.address);
              setPhone(property.phone);
              setEmail(property.email);
              setCheckInTime(property.checkInTime);
              setCheckOutTime(property.checkOutTime);
              setDone(false);
              m.reset();
            }}
          >
            Reset
          </button>
          <button type="submit" className={primaryBtn} disabled={m.isPending}>
            {m.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
      {taxComponents?.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Tax components</h3>
          <p className="mb-3 text-xs text-muted-foreground">Read-only. Rate changes are a new effective-dated row; issued invoices keep their snapshot.</p>
          <ul className="space-y-2 text-sm">
            {taxComponents.map((t) => (
              <li key={`${t.code}-${t.effectiveFrom}`} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0">
                <span>
                  {t.name} ({t.code}) · {t.ratePercent}%
                </span>
                <span className="text-muted-foreground">
                  from {t.effectiveFrom}
                  {t.effectiveTo ? ` to ${t.effectiveTo}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
