/** Business date (YYYY-MM-DD) of an instant in the property's timezone. */
export function businessDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Indian financial year (April–March) of a business date, e.g. 2026-11-09 → "2026-27". Provisional (Q11b). */
export function financialYear(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function nightsBetweenDates(checkIn: string, checkOut: string): number {
  return (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
}
