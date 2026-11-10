import type { ReactNode } from "react";
import { ApiError } from "@/api/client";

export const fieldClass = "h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";
export const primaryBtn = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
export const outlineBtn = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3.5 text-sm font-semibold hover:bg-muted disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Failures are shown, never hidden or replaced by sample data. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong.";
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-danger-soft px-3 py-2 text-sm text-destructive">
      {msg}
    </p>
  );
}

export function Note({ tone, children }: { tone: "success" | "warning"; children: ReactNode }) {
  const cls = tone === "success" ? "border-success/30 bg-success-soft text-success" : "border-warning/30 bg-warning-soft text-warning";
  return <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</p>;
}

/** Business “today” in Indian Standard Time (property timezone for the India demo). */
export const todayIso = (timeZone = "Asia/Kolkata"): string =>
  new Date().toLocaleDateString("en-CA", { timeZone });
export const addDaysIso = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
