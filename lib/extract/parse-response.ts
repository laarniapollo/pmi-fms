import { isVatType, type VatType } from "@/lib/constants";
import { parseCents } from "@/lib/format";
import { normaliseTin } from "@/lib/tax/vat";

import { geminiInvoiceSchema, WIRE_SCALARS, WIRE_TO_FIELD, type WireScalar } from "./gemini-schema";
import { matchVendor, type VendorOption } from "./match-vendor";
import { reconcileTotals } from "./reconcile";
import {
  REVIEW_THRESHOLD,
  type ExtractedField,
  type ExtractedInvoice,
  type ExtractedLineItem,
  type ScalarField,
} from "./types";

/**
 * Turns whatever the model actually sent into the shape the form speaks.
 *
 * Pure by design — no fetch, no env, no `server-only`. Everything that can go
 * wrong with a model reply can therefore be pinned by an offline test, which is
 * the whole reason the provider call lives in a separate file.
 *
 * The governing assumption is that the reply is untrusted input that merely
 * happens to be well-formed most of the time. It is never trusted to honour the
 * response schema, to send the right types, to keep its arithmetic straight, or
 * to invent only ids that exist. This function must not throw on any input.
 */

export type ParseFailureReason = "not-json" | "wrong-shape";

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  /** For the server log only. Never sent to a browser. */
  detail: string;
}

export type ParseResult = { ok: true; extracted: ExtractedInvoice } | ParseFailure;

export function parseGeminiInvoice(raw: unknown, vendors: readonly VendorOption[]): ParseResult {
  let json: unknown = raw;

  if (typeof raw === "string") {
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "not-json", detail: "reply was not JSON" };
    }
  }

  const parsed = geminiInvoiceSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "wrong-shape", detail: parsed.error.issues[0]?.message ?? "shape" };
  }

  const reply = parsed.data;
  const ambiguous = new Set(reply.ambiguous ?? []);

  const field = <T,>(wire: WireScalar, value: T | null): ExtractedField<T> => ({
    value,
    // A missing entry is not "unknown, assume fine" — it lands at zero, which
    // puts the field below the threshold and asks a person to look.
    confidence: value === null ? 0 : clamp(reply.confidence[wire] ?? 0),
    source: reply.evidence?.[wire] ?? null,
  });

  const vendorName = field("vendorName", text(reply.vendorName));
  const invoiceNumber = field("invoiceNumber", text(reply.invoiceNumber));
  const poNumber = field("poNumber", text(reply.poNumber));
  const issueDate = field("issueDate", isoDate(reply.issueDate));
  const dueDate = field("dueDate", isoDate(reply.dueDate));
  const subtotalCents = field("subtotal", toCents(reply.subtotal));
  const taxCents = field("tax", toCents(reply.tax));
  const totalCents = field("total", toCents(reply.total));
  const vatType = field("vatType", toVatType(reply.vatType));
  const supplierTin = field("supplierTin", toTin(reply.supplierTin));
  const vatableSalesCents = field("vatableSales", toCents(reply.vatableSales));
  const zeroRatedSalesCents = field("zeroRatedSales", toCents(reply.zeroRatedSales));
  const exemptSalesCents = field("exemptSales", toCents(reply.exemptSales));

  // A code the model made up is not a reading, but it is also not a silence:
  // something VAT-shaped was on the page and could not be named. Blank it and
  // ask a person, rather than map it onto whichever code it most resembles.
  if (vatType.value === null && text(reply.vatType) !== null) ambiguous.add("vatType");

  const lineItems = toLineItems(reply.lineItems);

  // Before the flags are computed, not after: arithmetic is allowed to overrule
  // whatever the model claimed about itself, and the flags read the result.
  reconcileTotals(subtotalCents, taxCents, totalCents, lineItems);

  const fields: Record<ScalarField, ExtractedField<unknown>> = {
    vendorName,
    invoiceNumber,
    poNumber,
    issueDate,
    dueDate,
    subtotalCents,
    taxCents,
    totalCents,
    vatType,
    supplierTin,
    vatableSalesCents,
    zeroRatedSalesCents,
    exemptSalesCents,
  };

  return {
    ok: true,
    extracted: {
      vendorName,
      matchedVendorId: resolveVendorId(reply.matchedVendorId, vendorName.value, vendors),
      invoiceNumber,
      poNumber,
      issueDate,
      dueDate,
      subtotalCents,
      taxCents,
      totalCents,
      vatType,
      supplierTin,
      vatableSalesCents,
      zeroRatedSalesCents,
      exemptSalesCents,
      lineItems,
      looksLikeInvoice: reply.documentLooksLikeInvoice !== false,
      overallConfidence: overall({ vendorName, invoiceNumber, issueDate, dueDate, totalCents }),
      lowConfidenceFields: flagFields(fields, ambiguous, lineItems),
    },
  };
}

// ---------------------------------------------------------------------------
// Which fields get an amber mark
// ---------------------------------------------------------------------------

/**
 * Fields whose *absence* is itself suspicious.
 *
 * Not every blank deserves a warning. A purchase-order number is missing from
 * most invoices, a due date is often only implied by payment terms, and a
 * missing VAT line is answered by `resolveTax` with a visibly computed figure.
 * Marking those amber would put a warning on almost every scan, and a warning
 * that is always on is one nobody reads — which would cost us the marks that
 * do mean something. An invoice with no supplier, no number, no date or no
 * total is a different matter: something was missed.
 */
const EXPECTED_FIELDS: readonly ScalarField[] = [
  "vendorName",
  "invoiceNumber",
  "issueDate",
  "totalCents",
];

/**
 * The four signals, in descending order of how much they are worth. The order
 * is not cosmetic: (1) is the only one that does not take the reader's word for
 * itself, and it has already been applied to `confidence` by `reconcileTotals`
 * before this runs. Deleting the arithmetic check would leave three signals
 * that are all just the model talking about itself.
 */
function flagFields(
  fields: Record<ScalarField, ExtractedField<unknown>>,
  ambiguous: ReadonlySet<string>,
  lineItems: readonly ExtractedLineItem[],
): string[] {
  const flagged = new Set<string>();

  for (const [name, value] of Object.entries(fields) as Array<[ScalarField, ExtractedField<unknown>]>) {
    // 1. Arithmetic disagreed — reconcileTotals pushed it below the threshold.
    // 4. Or the model reported low confidence in what it read. Both surface as
    //    a confidence below the line, and only apply to something we did read.
    if (value.value !== null && value.confidence < REVIEW_THRESHOLD) flagged.add(name);

    // 2. Nothing was read, in a field that should have been there.
    if (value.value === null && EXPECTED_FIELDS.includes(name)) flagged.add(name);

    // 3. The model said outright it could not resolve this one.
    if (ambiguous.has(name) || ambiguous.has(wireNameOf(name))) flagged.add(name);
  }

  /*
   * The rows get the same treatment as the totals, from the same kind of
   * evidence: if what the supplier is billing for does not add up to the
   * subtotal they printed, a row was misread, invented or missed. This is the
   * only per-row signal available — the model has no useful opinion about
   * individual lines — and it is the one that would have caught a street
   * address being read as a charge.
   */
  const subtotal = fields.subtotalCents.value;
  if (lineItems.length > 0 && typeof subtotal === "number") {
    const sum = lineItems.reduce((total, item) => total + item.amountCents, 0);
    if (Math.abs(sum - subtotal) > 2) flagged.add("lineItems");
  }

  /*
   * The same test for the BIR breakdown: whatever buckets the document prints
   * must account for the subtotal it prints. One that does not was misread,
   * and the VAT type inferred from it is suspect too.
   */
  const buckets = [fields.vatableSalesCents, fields.zeroRatedSalesCents, fields.exemptSalesCents]
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === "number");
  if (buckets.length > 0 && typeof subtotal === "number") {
    const sum = buckets.reduce((total, value) => total + value, 0);
    if (Math.abs(sum - subtotal) > 2) flagged.add("vatBreakdown");
  }

  return [...flagged];
}

function wireNameOf(field: ScalarField): string {
  return WIRE_SCALARS.find((wire) => WIRE_TO_FIELD[wire] === field) ?? field;
}

/**
 * A single number for the audit trail. Weighted towards the fields an approver
 * acts on: the total above all, then the invoice number that de-duplicates it.
 */
function overall(fields: {
  vendorName: ExtractedField<unknown>;
  invoiceNumber: ExtractedField<unknown>;
  issueDate: ExtractedField<unknown>;
  dueDate: ExtractedField<unknown>;
  totalCents: ExtractedField<unknown>;
}): number {
  const weighted: Array<[ExtractedField<unknown>, number]> = [
    [fields.vendorName, 1],
    [fields.invoiceNumber, 1.5],
    [fields.issueDate, 1],
    [fields.dueDate, 1],
    [fields.totalCents, 2],
  ];

  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  const sum = weighted.reduce((acc, [entry, weight]) => acc + entry.confidence * weight, 0);
  return Math.round((sum / totalWeight) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * An id from the model is a string it generated, exactly like the vendor name.
 * It is only ever accepted if it is on the list we sent; otherwise we fall back
 * to matching the name ourselves. Nothing here can name a supplier we did not
 * offer, which is the property that matters — this decides who gets paid.
 */
function resolveVendorId(
  claimed: string | null,
  readName: string | null,
  vendors: readonly VendorOption[],
): string | null {
  if (claimed && vendors.some((vendor) => vendor.id === claimed)) return claimed;
  return matchVendor(readName, vendors)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  // A model asked for null will sometimes write the word instead.
  if (trimmed === "" || /^(null|n\/a|none|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Accepts only what the prompt asked for. A date in any other shape was not
 * resolved, and guessing which half is the month here would be exactly the
 * invention the whole design is trying to avoid — so it becomes a blank.
 */
function isoDate(value: string | null | undefined): string | null {
  const trimmed = text(value);
  if (trimmed === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects 2026-02-31, which parses into March and would silently move a date.
  if (date.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

/**
 * `parseCents` handles the peso sign, an ISO prefix, separators and whitespace,
 * and is pinned by its own tests — so it is used as-is rather than patched.
 *
 * The one convention it does not know is accounting's parenthesised negative,
 * `(1,200.00)`, which it reads as unparseable. Rewriting it to a minus sign
 * here keeps that knowledge in the module that needs it: `parseCents` is also
 * what hand-typed input goes through, where a person typing brackets means
 * something far less certain.
 */
function toCents(printed: string | null | undefined): number | null {
  const trimmed = text(printed);
  if (trimmed === null) return null;

  const negated = /^\(.*\)$/.test(trimmed) ? `-${trimmed.slice(1, -1)}` : trimmed;
  return parseCents(negated);
}

/**
 * Only the five codes the prompt offers, plus the spellings a model reaches
 * for when it drifts back to the printed wording. Anything else is null.
 */
const VAT_TYPE_ALIASES: Record<string, VatType> = {
  VAT: "VATABLE",
  "VAT-ABLE": "VATABLE",
  "ZERO-RATED": "ZERO_RATED",
  "ZERO RATED": "ZERO_RATED",
  "VAT-EXEMPT": "EXEMPT",
  "VAT EXEMPT": "EXEMPT",
  "NON-VAT": "NON_VAT",
  "NON VAT": "NON_VAT",
};

function toVatType(printed: string | null | undefined): VatType | null {
  const trimmed = text(printed);
  if (trimmed === null) return null;
  const upper = trimmed.toUpperCase();
  if (isVatType(upper)) return upper;
  return VAT_TYPE_ALIASES[upper] ?? null;
}

/**
 * The canonical dashed form where the digits make a TIN; otherwise the text as
 * read, so the clerk sees what was on the page and the form's own validation
 * asks them to fix it — blanking it would hide that a TIN was printed at all.
 */
function toTin(printed: string | null | undefined): string | null {
  const trimmed = text(printed);
  if (trimmed === null) return null;
  return normaliseTin(trimmed) ?? trimmed;
}

function toQuantity(printed: string | null | undefined): number | null {
  const trimmed = text(printed);
  if (trimmed === null) return null;

  const value = Number(trimmed.replace(/[,\s ]/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Rows are kept only if they carry a description and an amount that parses. A
 * row we cannot price is dropped rather than stored at zero — a zero is a
 * claim about the document, and an unreadable row is not.
 */
function toLineItems(
  rows: Array<{
    description: string;
    quantity?: string | null;
    unitPrice?: string | null;
    amount?: string | null;
  }>,
): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];

  for (const row of rows) {
    const description = row.description.trim();
    const amountCents = toCents(row.amount);
    if (description === "" || amountCents === null) continue;

    const quantity = toQuantity(row.quantity);
    const unitPriceCents = toCents(row.unitPrice);

    // Only believe the breakdown if it multiplies out. Otherwise the amount is
    // the figure actually printed against the row, so it is carried whole at a
    // quantity of one — never scaled by a number that did not agree with it.
    const consistent =
      quantity !== null &&
      unitPriceCents !== null &&
      Math.abs(Math.round(quantity * unitPriceCents) - amountCents) <= 2;

    items.push(
      consistent
        ? { description, quantity, unitPriceCents, amountCents }
        : // A credit keeps its sign on the price, not the quantity: the invoice
          // schema rejects a negative quantity but allows a negative price.
          { description, quantity: 1, unitPriceCents: amountCents, amountCents },
    );
  }

  return items;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
