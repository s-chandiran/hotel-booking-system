import { describe, expect, it } from "vitest";
import { divRound, fromMinor, lineTotal, percentOf, toMinor } from "./money.js";

describe("money", () => {
  it("parses DECIMAL strings exactly", () => {
    expect(toMinor("1234.50")).toBe(123450n);
    expect(toMinor("0.05")).toBe(5n);
    expect(toMinor("7")).toBe(700n);
    expect(toMinor(2600)).toBe(260000n);
  });

  it("rejects more than 2 decimals and junk", () => {
    expect(() => toMinor("1.005")).toThrow();
    expect(() => toMinor("abc")).toThrow();
    expect(() => toMinor(0.1 + 0.2)).toThrow();
  });

  it("formats back to DECIMAL strings", () => {
    expect(fromMinor(123450n)).toBe("1234.50");
    expect(fromMinor(5n)).toBe("0.05");
    expect(fromMinor(-5n)).toBe("-0.05");
  });

  it("rounds half away from zero", () => {
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(divRound(-5n, 10n)).toBe(-1n);
  });

  it("computes percent tax to the paisa", () => {
    expect(percentOf(toMinor("7800.00"), "12.0000")).toBe(toMinor("936.00"));
    expect(percentOf(toMinor("0.04"), "12.5000")).toBe(1n); // 0.005 rounds up
    expect(percentOf(toMinor("100.00"), "2.5000")).toBe(toMinor("2.50"));
  });

  it("multiplies quantity × unit price", () => {
    expect(lineTotal(toMinor("4200.00"), "3.00")).toBe(toMinor("12600.00"));
    expect(lineTotal(toMinor("10.00"), "0.50")).toBe(toMinor("5.00"));
  });
});
