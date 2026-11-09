/**
 * Money as integer minor units (paise) in BigInt. It is never a float (D4, R13).
 * DB DECIMAL(12,2) values arrive as strings ("1234.50") and go back as strings.
 */
export type Minor = bigint;

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export function toMinor(value: string | number | bigint): Minor {
  if (typeof value === "bigint") return value * 100n;
  const s = typeof value === "number" ? numberToString(value) : value.trim();
  const m = DECIMAL.exec(s);
  if (!m) throw new Error(`Invalid money amount: ${s}`);
  const minor = BigInt(m[2]!) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -minor : minor;
}

function numberToString(n: number): string {
  if (!Number.isFinite(n)) throw new Error("Invalid money amount");
  // Only accept numbers that are already exact to 2 decimals (seed literals such as 2600 or 4200.5).
  const s = String(n);
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Money literal must have at most 2 decimals: ${s}`);
  return s;
}

export function fromMinor(minor: Minor): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Round half away from zero: num / den. */
export function divRound(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error("Denominator must be positive");
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return neg ? -q : q;
}

/** A DECIMAL(7,4) percent string ("12.0000") as an integer in units of 0.0001 %. */
export function percentUnits(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(rate.trim());
  if (!m) throw new Error(`Invalid percent: ${rate}`);
  return BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? "").padEnd(4, "0") || "0");
}

/** base × rate% rounded half-up to the paisa. 1% = 10_000 units, so divide by 100 × 10_000. */
export function percentOf(base: Minor, rate: string): Minor {
  return divRound(base * percentUnits(rate), 1_000_000n);
}

/** A DECIMAL(8,2) quantity string ("3.00") in hundredths. */
export function quantityHundredths(qty: string | number): bigint {
  return toMinor(qty);
}

/** unit price × quantity, rounded half-up to the paisa. */
export function lineTotal(unitPrice: Minor, qty: string | number): Minor {
  return divRound(unitPrice * quantityHundredths(qty), 100n);
}

export const min = (a: Minor, b: Minor): Minor => (a < b ? a : b);
export const sum = (xs: Minor[]): Minor => xs.reduce((a, b) => a + b, 0n);

/** Rounding rule recorded on each invoice (F4.4). Provisional until Q6c is answered. */
export const ROUNDING_RULE = "half_up_component_2dp";
