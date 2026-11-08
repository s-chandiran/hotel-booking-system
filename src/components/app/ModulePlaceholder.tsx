import { Construction } from "lucide-react";

export function ModulePlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="card-surface mx-auto mt-6 max-w-lg p-10 text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Construction className="size-6" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">This module is planned for {phase}.</p>
    </div>
  );
}
