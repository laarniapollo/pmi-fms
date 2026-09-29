import { describe, expect, it } from "vitest";

import {
  agingBucket,
  centsToInput,
  CURRENCY_SYMBOL,
  daysOverdue,
  describeDueDate,
  formatCents,
  formatCentsCode,
  formatCentsCompact,
  formatCentsWhole,
  initials,
  parseCents,
  truncate,
} from "./format";

const AT = new Date("2026-08-05T12:00:00Z");
const daysFromRef = (days: number) => new Date(AT.getTime() + days * 24 * 60 * 60 * 1000);

describe("money", () => {
  it("formats minor units without floating-point drift", () => {
    expect(formatCents(123_456)).toBe("₱1,234.56");
    expect(formatCents(0)).toBe("₱0.00");
    expect(formatCents(1)).toBe("₱0.01");
    expect(formatCents(-50_00)).toBe("-₱50.00");
  });

  it("rounds to whole pesos for dense columns", () => {
    expect(formatCentsWhole(123_456)).toBe("₱1,235");
    expect(formatCentsWhole(49)).toBe("₱0");
  });

  it("renders the ISO code for surfaces that cannot draw the peso sign", () => {
    // A plain space, not the non-breaking one ICU emits — the PDF and these
    // assertions both need it predictable.
    expect(formatCentsCode(123_456)).toBe("PHP 1,234.56");
    expect(formatCentsCode(123_456)).not.toContain("\u00a0");
  });

  it("round-trips through the input representation", () => {
    for (const cents of [0, 1, 999, 100_000, 123_456_789]) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
  });

  it("parses what people actually type", () => {
    expect(parseCents("₱1,234.56")).toBe(123_456);
    expect(parseCents("PHP 1,234.56")).toBe(123_456);
    expect(parseCents("Php1,234.56")).toBe(123_456);
    // Pasted legacy text and OCR output still carry a dollar sign.
    expect(parseCents("$1,234.56")).toBe(123_456);
    expect(parseCents("  42 ")).toBe(4_200);
    expect(parseCents("0.07")).toBe(7);
  });

  it("distinguishes empty from zero so a blank field is not treated as ₱0", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("   ")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("₱")).toBeNull();
    expect(parseCents("0")).toBe(0);
  });

  it("refuses input that is only partly a number, rather than salvaging digits", () => {
    // A blanket non-digit strip would read this as ₱1,234.00.
    expect(parseCents("12abc34")).toBeNull();
  });

  it("abbreviates for axes without losing the symbol or the magnitude", () => {
    expect(formatCentsCompact(62_000)).toBe("₱620");
    expect(formatCentsCompact(8_400_000)).toBe("₱84k");
    expect(formatCentsCompact(150_000_000)).toBe("₱1.5M");
    expect(formatCentsCompact(-8_400_000)).toBe("-₱84k");
  });

  it("takes the compact symbol from ICU rather than a hand-written table", () => {
    expect(CURRENCY_SYMBOL).toBe("₱");
    expect(formatCentsCompact(62_000)).toContain(CURRENCY_SYMBOL);
  });
});

describe("due dates", () => {
  it("counts overdue days positively and remaining days negatively", () => {
    expect(daysOverdue(daysFromRef(-3), AT)).toBe(3);
    expect(daysOverdue(daysFromRef(3), AT)).toBe(-3);
    expect(daysOverdue(AT, AT)).toBe(0);
  });

  it("describes the state in words, with an urgency tone", () => {
    expect(describeDueDate(daysFromRef(-1), AT)).toEqual({ label: "1 day overdue", tone: "danger" });
    expect(describeDueDate(AT, AT)).toEqual({ label: "Due today", tone: "warn" });
    expect(describeDueDate(daysFromRef(3), AT).tone).toBe("warn");
    expect(describeDueDate(daysFromRef(30), AT).tone).toBe("neutral");
  });
});

describe("ageing ladder", () => {
  it.each([
    [10, "current"], // not yet due
    [0, "current"], // due today
    [-1, "1-30"],
    [-30, "1-30"],
    [-31, "31-60"],
    [-60, "31-60"],
    [-61, "61-90"],
    [-90, "61-90"],
    [-91, "90+"],
    [-400, "90+"],
  ])("puts a due date %d days away in the %s bucket", (offset, expected) => {
    expect(agingBucket(daysFromRef(offset), AT)).toBe(expected);
  });
});

describe("text", () => {
  it("takes first and last initials", () => {
    expect(initials("Marisol Okonkwo")).toBe("MO");
    expect(initials("Priya Raghunathan")).toBe("PR");
    expect(initials("Ada Byron King Lovelace")).toBe("AL");
    expect(initials("Cher")).toBe("CH");
    expect(initials("  ")).toBe("?");
  });

  it("truncates on a word boundary where one is close enough", () => {
    expect(truncate("Northwind Cloud Services", 40)).toBe("Northwind Cloud Services");
    expect(truncate("Northwind Cloud Services", 16)).toBe("Northwind Cloud…");
  });
});
