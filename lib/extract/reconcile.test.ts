import { describe, expect, it } from "vitest";

import { reconcileTotals } from "./reconcile";
import { REVIEW_THRESHOLD, type ExtractedField, type ExtractedLineItem } from "./types";

const field = (value: number | null, confidence = 0.95): ExtractedField<number> => ({
  value,
  confidence,
  source: null,
});

const line = (amountCents: number): ExtractedLineItem => ({
  description: "row",
  quantity: 1,
  unitPriceCents: amountCents,
  amountCents,
});

/**
 * Ported from the Tesseract-era parser's test suite, where it could only be
 * reached through `parseInvoiceText`. The behaviour is unchanged and the reason
 * for it is stronger, not weaker, now that a language model does the reading: a
 * model reports how fluent its answer felt, which is no help at all when it read
 * the wrong glyph fluently. This is the only check in the pipeline that does not
 * take the reader's word for anything.
 */
describe("totals that contradict each other", () => {
  // 2,625,000 + 315,000 is 2,940,000, not 2,040,000 — a bold 9 read as a 0.
  // The engine reported 0.95 on every one of them.
  const misread = () => {
    const subtotal = field(262_500_000);
    const tax = field(31_500_000);
    const total = field(204_000_000);
    reconcileTotals(subtotal, tax, total, []);
    return { subtotal, tax, total };
  };

  it("doubts the total even though the engine was sure of it", () => {
    expect(misread().total.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("doubts the components too, since any of the three could be the wrong one", () => {
    const { subtotal, tax } = misread();
    expect(subtotal.confidence).toBeLessThan(REVIEW_THRESHOLD);
    expect(tax.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("never alters the value it read, only the confidence in it", () => {
    // Correcting the total from the other two would hide a misread subtotal.
    expect(misread().total.value).toBe(204_000_000);
  });

  it("leaves consistent totals confident", () => {
    const subtotal = field(262_500_000);
    const tax = field(31_500_000);
    const total = field(294_000_000);
    reconcileTotals(subtotal, tax, total, []);

    expect(subtotal.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(tax.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(total.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });

  it("never raises a doubted figure, whatever it started at", () => {
    const subtotal = field(100, 0.2);
    const tax = field(10, 0.2);
    const total = field(999, 0.2);
    reconcileTotals(subtotal, tax, total, []);
    expect(subtotal.confidence).toBe(0.2);
  });
});

describe("corroboration short of all three figures", () => {
  it("promotes a subtotal that equals the total when no tax is printed", () => {
    const subtotal = field(50_000, 0.8);
    const total = field(50_000, 0.8);
    reconcileTotals(subtotal, field(null), total, []);

    expect(subtotal.confidence).toBeGreaterThan(0.8);
    expect(total.confidence).toBeGreaterThan(0.8);
  });

  it("promotes a subtotal the line items add up to", () => {
    const subtotal = field(30_000, 0.8);
    reconcileTotals(subtotal, field(null), field(null), [line(10_000), line(20_000)]);
    expect(subtotal.confidence).toBeGreaterThan(0.8);
  });

  it("leaves a subtotal alone when the lines do not add up to it", () => {
    const subtotal = field(30_000, 0.8);
    reconcileTotals(subtotal, field(null), field(null), [line(10_000), line(5_000)]);
    // Not lowered either — see the follow-up noted in the plan.
    expect(subtotal.confidence).toBe(0.8);
  });

  it("tolerates a one-centavo rounding difference", () => {
    const subtotal = field(100_000);
    const tax = field(12_000);
    const total = field(112_001);
    reconcileTotals(subtotal, tax, total, []);
    expect(total.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });

  it("does nothing at all when nothing was read", () => {
    const subtotal = field(null, 0.5);
    expect(() => reconcileTotals(subtotal, field(null), field(null), [])).not.toThrow();
    expect(subtotal.confidence).toBe(0.5);
  });
});
