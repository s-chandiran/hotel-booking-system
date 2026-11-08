import { cn } from "@/lib/utils";

const tones = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type Tone = keyof typeof tones;

export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Card({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("card-surface p-5", className)}>
      {title && (
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
