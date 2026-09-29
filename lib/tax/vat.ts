import { VAT_RATE, VAT_TYPE_META, type VatType } from "@/lib/constants";
import { formatCents } from "@/lib/format";

/**
 * The VAT arithmetic for one invoice, shared by the form and the server action.
 *
 * The form calls it to show a running breakdown; the server calls it again on
 * what was posted and stores its own answer. Both reading from here is what
 * keeps the figure on screen and the figure in the ledger from drifting apart,
 * and the server recomputing is what keeps a crafted post from setting VAT on
 * an exempt sale.
 */

export interface VatInput {
  vatType: VatType;
  /** The line items' sum, always — never a figure the client sent. */
  subtotalCents: number;
  /** Only read for MIXED. Every other type puts the whole subtotal in one bucket. */
  vatableCents?: number | null;
  zeroRatedCents?: number | null;
  exemptCents?: number | null;
  /**
   * The VAT the person keyed, for the types that bear it. Null means "work it
   * out", which is different from a keyed zero.
   */
  taxCents?: number | null;
}

export interface VatBreakdown {
  vatableSalesCents: number;
  zeroRatedSalesCents: number;
  exemptSalesCents: number;
  taxCents: number;
}

export function computeVatBreakdown(input: VatInput): VatBreakdown {
  const { vatType, subtotalCents } = input;

  switch (vatType) {
    case "VATABLE":
      return {
        vatableSalesCents: subtotalCents,
        zeroRatedSalesCents: 0,
        exemptSalesCents: 0,
        taxCents: input.taxCents ?? Math.round(subtotalCents * VAT_RATE),
      };
    case "ZERO_RATED":
      return { vatableSalesCents: 0, zeroRatedSalesCents: subtotalCents, exemptSalesCents: 0, taxCents: 0 };
    case "EXEMPT":
      return { vatableSalesCents: 0, zeroRatedSalesCents: 0, exemptSalesCents: subtotalCents, taxCents: 0 };
    case "NON_VAT":
      // Not a VAT sale at all, so it belongs in none of the three buckets.
      return { vatableSalesCents: 0, zeroRatedSalesCents: 0, exemptSalesCents: 0, taxCents: 0 };
    case "MIXED": {
      const vatableSalesCents = input.vatableCents ?? 0;
      return {
        vatableSalesCents,
        zeroRatedSalesCents: input.zeroRatedCents ?? 0,
        exemptSalesCents: input.exemptCents ?? 0,
        taxCents: input.taxCents ?? Math.round(vatableSalesCents * VAT_RATE),
      };
    }
  }
}

/**
 * A BIR TIN is nine digits, usually followed by a three-to-five digit branch
 * code. Returns the canonical dashed form, or null if it is not one.
 */
export function normaliseTin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9 && (digits.length < 12 || digits.length > 14)) return null;
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)];
  if (digits.length > 9) groups.push(digits.slice(9));
  return groups.join("-");
}

/**
 * Field errors, keyed by the form field that should carry them. Empty when the
 * VAT side of the invoice is consistent.
 */
export function validateVat(
  input: VatInput & { supplierTin?: string | null },
): Record<string, string> {
  const errors: Record<string, string> = {};
  const meta = VAT_TYPE_META[input.vatType];

  if (input.vatType === "MIXED") {
    const parts = [input.vatableCents ?? 0, input.zeroRatedCents ?? 0, input.exemptCents ?? 0];
    if (parts.some((part) => part < 0)) {
      errors.vatBreakdown = "Sales amounts cannot be negative";
    } else {
      const sum = parts.reduce((total, part) => total + part, 0);
      if (sum !== input.subtotalCents) {
        errors.vatBreakdown = `These add up to ${formatCents(sum)}, but the lines add up to ${formatCents(input.subtotalCents)}`;
      }
    }
  }

  const tin = input.supplierTin?.trim();
  if (!tin) {
    if (meta.tinRequired) errors.supplierTin = `A ${meta.label} invoice must show the supplier's TIN`;
  } else if (!normaliseTin(tin)) {
    errors.supplierTin = "A TIN is 9 digits, usually with a branch code — 123-456-789-00000";
  }

  return errors;
}
