import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, EmptyState } from "./StatusBadge";

export interface Column<T> { header: string; cell: (row: T) => React.ReactNode; align?: "right" }

export const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export function StatRow({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="card-surface p-4">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className="text-xl font-bold">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

export function DataTable<T>({ rows, columns, rowKey, searchText, title }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; searchText: (r: T) => string; title?: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => rows.filter((r) => searchText(r).toLowerCase().includes(q.toLowerCase())), [rows, q, searchText]);
  return (
    <Card title={title ?? `${filtered.length} records`} action={
      <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm">
        <Search className="size-4 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-32 bg-transparent outline-none sm:w-48" />
      </label>
    }>
      {filtered.length === 0 ? <EmptyState text="No matching records." /> : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>{columns.map((c) => <th key={c.header} className={`pb-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={rowKey(r)} className="hover:bg-muted/50">
                  {columns.map((c) => <td key={c.header} className={`py-3 pr-3 ${c.align === "right" ? "text-right" : ""}`}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
