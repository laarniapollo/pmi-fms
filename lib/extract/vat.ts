import { VAT_RATE, VAT_TYPE_META, type VatType } from "@/lib/constants";

import { REVIEW_THRESHOLD, type ExtractedField } from "./types";

/** How the VAT figure on a prefilled form was arrived at. */
export type TaxSource = "read" | "computed";

export interface ResolvedTax {
  /** Undefined leaves the box blank, which is different from a zero. */
  taxCents: number | undefined;
  source: TaxSource | undefined;
}

/**
 * Decides what goes in the VAT box after a scan.
 *
 * This is product policy, deliberately kept out of the extraction module. The
 * extractor's job is to report what the document says; inventing a figure when
 * the document is silent is a different decision, and putting it in the
 * extractor would have it do the exact thing the prompt forbids the model from
 * doing.
 *
 * A printed zero is a reading, not a silence. Suppliers who are not
 * VAT-registered bill no VAT and say so, and overwriting their explicit 0.00
 * with a computed 12% would invent a tax liability that nobody charged.
 *
 * With a VAT type known, the computed figure follows it: nothing for the types
 * that bear no VAT, and 12% of the VATable bucket — not the subtotal — for a
 * mixed sale.
 */
export function resolveTax({
  taxCents,
  subtotalCents,
  vatType = null,
  vatableSalesCents = null,
}: {
  taxCents: number | null;
  subtotalCents: number | null;
  vatType?: VatType | null;
  vatableSalesCents?: number | null;
}): ResolvedTax {
  if (taxCents !== null) return { taxCents, source: "read" };

  if (vatType !== null && !VAT_TYPE_META[vatType].taxable) return { taxCents: 0, source: "computed" };

  const base = vatType === "MIXED" ? vatableSalesCents : subtotalCents;

  // Never compute from a figure we do not have.
  if (base === null) return { taxCents: undefined, source: undefined };

  return { taxCents: Math.round(base * VAT_RATE), source: "computed" };
}

/**
 * How the VAT type on a prefilled form was arrived at. "read" means the
 * document declared it in print; "inferred" means we worked it out from what
 * it printed instead, and the form says so.
 */
export type VatTypeSource = "read" | "inferred";

export interface ResolvedVatType {
  /** Undefined leaves the dropdown empty and asks a person to choose. */
  vatType: VatType | undefined;
  source: VatTypeSource | undefined;
}

/**
 * Decides which VAT type the dropdown opens on after a scan, strongest
 * evidence first:
 *
 *   1. a printed marker the reader was sure of
 *   2. the printed breakdown — one non-zero bucket names its type, several
 *      make it mixed
 *   3. a printed marker the reader was unsure of
 *   4. a printed VAT above zero, which only a VATable sale carries
 *
 * Past that it is left undetermined. A printed zero VAT is deliberately not
 * evidence: zero-rated, exempt and non-VAT sales all print one, and picking
 * between them is exactly the call a person has to make.
 */
export function resolveVatType(extracted: {
  vatType: ExtractedField<VatType>;
  taxCents: ExtractedField<number>;
  vatableSalesCents: ExtractedField<number>;
  zeroRatedSalesCents: ExtractedField<number>;
  exemptSalesCents: ExtractedField<number>;
}): ResolvedVatType {
  const printed = extracted.vatType.value;
  if (printed !== null && extracted.vatType.confidence >= REVIEW_THRESHOLD) {
    return { vatType: printed, source: "read" };
  }

  const buckets: Array<[VatType, number | null]> = [
    ["VATABLE", extracted.vatableSalesCents.value],
    ["ZERO_RATED", extracted.zeroRatedSalesCents.value],
    ["EXEMPT", extracted.exemptSalesCents.value],
  ];
  const nonZero = buckets.filter(([, value]) => value !== null && value !== 0);
  if (nonZero.length === 1) return { vatType: nonZero[0]![0], source: "inferred" };
  if (nonZero.length > 1) return { vatType: "MIXED", source: "inferred" };

  if (printed !== null) return { vatType: printed, source: "inferred" };

  const tax = extracted.taxCents.value;
  if (tax !== null && tax > 0) return { vatType: "VATABLE", source: "inferred" };

  return { vatType: undefined, source: undefined };
}
