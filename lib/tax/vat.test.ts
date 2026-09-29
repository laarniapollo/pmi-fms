import { describe, expect, it } from "vitest";

import { computeVatBreakdown, normaliseTin, validateVat } from "./vat";

describe("computeVatBreakdown", () => {
  it("puts a VATable subtotal in the VATable bucket and computes 12%", () => {
    expect(computeVatBreakdown({ vatType: "VATABLE", subtotalCents: 1_000_000 })).toEqual({
      vatableSalesCents: 1_000_000,
      zeroRatedSalesCents: 0,
      exemptSalesCents: 0,
      taxCents: 120_000,
    });
  });

  it("keeps a keyed VAT over the computed one, including a keyed zero", () => {
    expect(computeVatBreakdown({ vatType: "VATABLE", subtotalCents: 1_000_000, taxCents: 119_999 }).taxCents).toBe(119_999);
    expect(computeVatBreakdown({ vatType: "VATABLE", subtotalCents: 1_000_000, taxCents: 0 }).taxCents).toBe(0);
  });

  it("rounds computed VAT to whole minor units", () => {
    expect(computeVatBreakdown({ vatType: "VATABLE", subtotalCents: 12_345 }).taxCents).toBe(1_481);
  });

  it.each(["ZERO_RATED", "EXEMPT", "NON_VAT"] as const)(
    "locks VAT at zero for %s whatever was keyed",
    (vatType) => {
      expect(computeVatBreakdown({ vatType, subtotalCents: 1_000_000, taxCents: 120_000 }).taxCents).toBe(0);
    },
  );

  it("routes single-bucket types to their own bucket, and non-VAT to none", () => {
    expect(computeVatBreakdown({ vatType: "ZERO_RATED", subtotalCents: 500 }).zeroRatedSalesCents).toBe(500);
    expect(computeVatBreakdown({ vatType: "EXEMPT", subtotalCents: 500 }).exemptSalesCents).toBe(500);
    expect(computeVatBreakdown({ vatType: "NON_VAT", subtotalCents: 500 })).toEqual({
      vatableSalesCents: 0,
      zeroRatedSalesCents: 0,
      exemptSalesCents: 0,
      taxCents: 0,
    });
  });

  it("computes MIXED VAT on the VATable bucket only", () => {
    expect(
      computeVatBreakdown({
        vatType: "MIXED",
        subtotalCents: 1_000_000,
        vatableCents: 600_000,
        zeroRatedCents: 300_000,
        exemptCents: 100_000,
      }),
    ).toEqual({
      vatableSalesCents: 600_000,
      zeroRatedSalesCents: 300_000,
      exemptSalesCents: 100_000,
      taxCents: 72_000,
    });
  });

  it("ignores stray buckets on a single-bucket type", () => {
    expect(
      computeVatBreakdown({ vatType: "VATABLE", subtotalCents: 1_000, zeroRatedCents: 999 }).zeroRatedSalesCents,
    ).toBe(0);
  });
});

describe("normaliseTin", () => {
  it.each([
    ["123456789", "123-456-789"],
    ["123-456-789-000", "123-456-789-000"],
    ["123 456 789 00000", "123-456-789-00000"],
    ["TIN: 123-456-789-0000", "123-456-789-0000"],
  ])("normalises %s", (raw, expected) => {
    expect(normaliseTin(raw)).toBe(expected);
  });

  it.each(["", "12345678", "1234567890", "123-456-789-000000", null])("rejects %s", (raw) => {
    expect(normaliseTin(raw)).toBeNull();
  });
});

describe("validateVat", () => {
  const tin = "123-456-789-000";

  it("accepts a consistent MIXED breakdown", () => {
    expect(
      validateVat({
        vatType: "MIXED",
        subtotalCents: 1_000,
        vatableCents: 600,
        zeroRatedCents: 400,
        exemptCents: 0,
        supplierTin: tin,
      }),
    ).toEqual({});
  });

  it("flags a MIXED breakdown that does not add up to the lines", () => {
    const errors = validateVat({
      vatType: "MIXED",
      subtotalCents: 1_000,
      vatableCents: 600,
      zeroRatedCents: 300,
      supplierTin: tin,
    });
    expect(errors.vatBreakdown).toMatch(/add up to/);
  });

  it("flags negative MIXED amounts", () => {
    expect(
      validateVat({ vatType: "MIXED", subtotalCents: 0, vatableCents: 100, exemptCents: -100, supplierTin: tin })
        .vatBreakdown,
    ).toMatch(/negative/);
  });

  it.each(["VATABLE", "ZERO_RATED", "MIXED"] as const)("requires a TIN for %s", (vatType) => {
    expect(validateVat({ vatType, subtotalCents: 0, supplierTin: " " }).supplierTin).toBeDefined();
  });

  it.each(["EXEMPT", "NON_VAT"] as const)("does not require a TIN for %s", (vatType) => {
    expect(validateVat({ vatType, subtotalCents: 0 })).toEqual({});
  });

  it("rejects a malformed TIN even where it is optional", () => {
    expect(validateVat({ vatType: "NON_VAT", subtotalCents: 0, supplierTin: "12-34" }).supplierTin).toMatch(
      /9 digits/,
    );
  });
});
