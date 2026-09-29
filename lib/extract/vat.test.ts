import { describe, expect, it } from "vitest";

import type { ExtractedField } from "./types";
import { resolveTax, resolveVatType } from "./vat";

describe("resolveTax", () => {
  it("uses the figure printed on the document over anything derived", () => {
    // Not 12% of the subtotal — the supplier billed what they billed.
    expect(resolveTax({ taxCents: 25_000, subtotalCents: 1_000_000 })).toEqual({
      taxCents: 25_000,
      source: "read",
    });
  });

  it("treats a printed zero as a reading, not an absence", () => {
    // The row that gets missed. A supplier who is not VAT-registered prints
    // "VAT 0.00", and computing 12% over the top of it invents a tax liability
    // that nobody charged. `parseCents("0.00")` is 0, not null, so the
    // distinction survives all the way here — this test is what pins it.
    expect(resolveTax({ taxCents: 0, subtotalCents: 1_000_000 })).toEqual({
      taxCents: 0,
      source: "read",
    });
  });

  it("computes 12% when the document prints no VAT line at all", () => {
    expect(resolveTax({ taxCents: null, subtotalCents: 1_000_000 })).toEqual({
      taxCents: 120_000,
      source: "computed",
    });
  });

  it("leaves the box blank rather than compute from a subtotal it does not have", () => {
    expect(resolveTax({ taxCents: null, subtotalCents: null })).toEqual({
      taxCents: undefined,
      source: undefined,
    });
  });

  it("rounds to whole minor units", () => {
    expect(resolveTax({ taxCents: null, subtotalCents: 12_345 }).taxCents).toBe(1_481);
  });
});

describe("resolveTax with a VAT type", () => {
  it.each(["ZERO_RATED", "EXEMPT", "NON_VAT"] as const)("computes nothing for %s", (vatType) => {
    expect(resolveTax({ taxCents: null, subtotalCents: 1_000_000, vatType })).toEqual({
      taxCents: 0,
      source: "computed",
    });
  });

  it("computes 12% of the VATable bucket, not the subtotal, for a mixed sale", () => {
    expect(
      resolveTax({ taxCents: null, subtotalCents: 1_000_000, vatType: "MIXED", vatableSalesCents: 600_000 }),
    ).toEqual({ taxCents: 72_000, source: "computed" });
  });

  it("leaves a mixed sale blank when the VATable bucket was not printed", () => {
    expect(resolveTax({ taxCents: null, subtotalCents: 1_000_000, vatType: "MIXED" }).taxCents).toBeUndefined();
  });

  it("still prefers the printed figure", () => {
    expect(resolveTax({ taxCents: 5, subtotalCents: 1_000_000, vatType: "EXEMPT" })).toEqual({
      taxCents: 5,
      source: "read",
    });
  });
});

describe("resolveVatType", () => {
  const f = <T,>(value: T | null, confidence = 0.99): ExtractedField<T> => ({ value, confidence, source: null });
  const silent = {
    vatType: f<never>(null, 0),
    taxCents: f<number>(null, 0),
    vatableSalesCents: f<number>(null, 0),
    zeroRatedSalesCents: f<number>(null, 0),
    exemptSalesCents: f<number>(null, 0),
  };

  it("takes a confidently printed marker as read", () => {
    expect(resolveVatType({ ...silent, vatType: f("ZERO_RATED" as const) })).toEqual({
      vatType: "ZERO_RATED",
      source: "read",
    });
  });

  it("prefers the printed breakdown over an unsure marker", () => {
    expect(
      resolveVatType({ ...silent, vatType: f("VATABLE" as const, 0.5), exemptSalesCents: f(100_000) }),
    ).toEqual({ vatType: "EXEMPT", source: "inferred" });
  });

  it("calls several non-zero buckets mixed", () => {
    expect(
      resolveVatType({ ...silent, vatableSalesCents: f(600), zeroRatedSalesCents: f(400), exemptSalesCents: f(0) }),
    ).toEqual({ vatType: "MIXED", source: "inferred" });
  });

  it("falls back to an unsure marker before the VAT amount", () => {
    expect(resolveVatType({ ...silent, vatType: f("NON_VAT" as const, 0.5), taxCents: f(0) })).toEqual({
      vatType: "NON_VAT",
      source: "inferred",
    });
  });

  it("infers VATable from a printed VAT above zero", () => {
    expect(resolveVatType({ ...silent, taxCents: f(120_000) })).toEqual({ vatType: "VATABLE", source: "inferred" });
  });

  it("does not treat a printed zero VAT as evidence of any one type", () => {
    // Zero-rated, exempt and non-VAT sales all print a zero; choosing between
    // them is the person's call, not ours.
    expect(resolveVatType({ ...silent, taxCents: f(0) })).toEqual({ vatType: undefined, source: undefined });
  });

  it("leaves a silent document undetermined", () => {
    expect(resolveVatType(silent)).toEqual({ vatType: undefined, source: undefined });
  });
});
