import { z } from "zod";

import type { ScalarField } from "./types";

/**
 * What we ask the model for, and what we are willing to believe, side by side.
 *
 * They are deliberately in one file. The wire schema is a request — the API may
 * ignore keywords it does not support, and a model can return valid JSON that
 * does not honour it — so the zod schema below is the actual contract. If these
 * two ever drift apart, that is visible here rather than at a call site.
 *
 * Everything downstream must stay correct even if the wire schema is ignored
 * entirely.
 */

/**
 * The scalar names *on the wire*, which are not the field names used inside the
 * app: the model is asked for "subtotal", the form works in `subtotalCents`.
 *
 * Naming the wire side after the document rather than after our storage keeps
 * the prompt readable to the model — "subtotal" is a word printed on invoices,
 * "subtotalCents" is an implementation detail it would have to decode.
 */
export const WIRE_SCALARS = [
  "vendorName",
  "invoiceNumber",
  "poNumber",
  "issueDate",
  "dueDate",
  "subtotal",
  "tax",
  "total",
  "vatType",
  "supplierTin",
  "vatableSales",
  "zeroRatedSales",
  "exemptSales",
] as const;

export type WireScalar = (typeof WIRE_SCALARS)[number];

/** The one place the two vocabularies are tied together. */
export const WIRE_TO_FIELD: Record<WireScalar, ScalarField> = {
  vendorName: "vendorName",
  invoiceNumber: "invoiceNumber",
  poNumber: "poNumber",
  issueDate: "issueDate",
  dueDate: "dueDate",
  subtotal: "subtotalCents",
  tax: "taxCents",
  total: "totalCents",
  vatType: "vatType",
  supplierTin: "supplierTin",
  vatableSales: "vatableSalesCents",
  zeroRatedSales: "zeroRatedSalesCents",
  exemptSales: "exemptSalesCents",
};

/**
 * `nullable`, not a `["string", "null"]` type union.
 *
 * `responseSchema` is an OpenAPI-subset proto, not JSON Schema, and a type
 * union is rejected outright before the model is ever reached:
 *
 *   HTTP 400 — Unknown name "type" at 'generation_config.response_schema
 *   .properties[1].value': Proto field is not repeating, cannot start list.
 *
 * Verified against the live API. Do not "modernise" this back to a union.
 */
const nullableString = { type: "string", nullable: true } as const;

const confidenceProps = Object.fromEntries(
  WIRE_SCALARS.map((field) => [field, { type: "number" }]),
);
const evidenceProps = Object.fromEntries(
  WIRE_SCALARS.map((field) => [field, nullableString]),
);

/**
 * Kept flat and plain on purpose: the supported keyword set is narrow, and
 * large or deeply nested schemas get rejected outright. No `enum`, no `format`,
 * no `pattern`, one level of nesting.
 *
 * Every scalar is both `required` and `nullable`. `required` turns "the model
 * forgot the key" into a hard error; `nullable` is how it says "this is not
 * printed on the document". Making them optional instead would collapse those
 * two cases into one — and telling them apart is the whole "leave it blank"
 * requirement.
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    documentLooksLikeInvoice: { type: "boolean" },
    vendorName: nullableString,
    matchedVendorId: nullableString,
    invoiceNumber: nullableString,
    poNumber: nullableString,
    issueDate: nullableString,
    dueDate: nullableString,
    subtotal: nullableString,
    tax: nullableString,
    total: nullableString,
    // A code, not free text — but `enum` is rejected by this schema dialect,
    // so the allowed values live in the prompt and are enforced on the way in.
    vatType: nullableString,
    supplierTin: nullableString,
    vatableSales: nullableString,
    zeroRatedSales: nullableString,
    exemptSales: nullableString,
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: nullableString,
          unitPrice: nullableString,
          // Nullable rather than forced: a row we cannot price is dropped on
          // the way in, which is better than a number the model made up to
          // satisfy the schema.
          amount: nullableString,
        },
        required: ["description", "amount"],
        propertyOrdering: ["description", "quantity", "unitPrice", "amount"],
      },
    },
    confidence: {
      type: "object",
      properties: confidenceProps,
      required: [...WIRE_SCALARS],
    },
    evidence: { type: "object", properties: evidenceProps },
    ambiguous: { type: "array", items: { type: "string" } },
  },
  required: [
    "documentLooksLikeInvoice",
    "vendorName",
    "matchedVendorId",
    "invoiceNumber",
    "poNumber",
    "issueDate",
    "dueDate",
    "subtotal",
    "tax",
    "total",
    "vatType",
    "supplierTin",
    "vatableSales",
    "zeroRatedSales",
    "exemptSales",
    "lineItems",
    "confidence",
  ],
  // Supported, and it makes the reply order deterministic across calls.
  propertyOrdering: [
    "documentLooksLikeInvoice",
    "vendorName",
    "matchedVendorId",
    "invoiceNumber",
    "poNumber",
    "issueDate",
    "dueDate",
    "subtotal",
    "tax",
    "total",
    "vatType",
    "supplierTin",
    "vatableSales",
    "zeroRatedSales",
    "exemptSales",
    "lineItems",
    "confidence",
    "evidence",
    "ambiguous",
  ],
} as const;

// ---------------------------------------------------------------------------
// What we are willing to believe
// ---------------------------------------------------------------------------

/**
 * Amounts are requested as printed strings, but a model will occasionally send
 * a bare number however the schema is worded. Accepting both and stringifying
 * costs one line and removes a whole class of spurious failures — `parseCents`
 * is what turns either into minor units.
 */
const loose = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => (value === null ? null : String(value)));

/** Same tolerance, but a missing or malformed key lands as null, not a failure. */
const optionalLoose = loose.optional().catch(null);

const lineItemSchema = z.object({
  description: z.union([z.string(), z.number()]).transform(String),
  quantity: optionalLoose,
  unitPrice: optionalLoose,
  amount: optionalLoose,
});

export const geminiInvoiceSchema = z.object({
  documentLooksLikeInvoice: z.boolean().optional().catch(undefined),
  vendorName: loose,
  matchedVendorId: loose,
  invoiceNumber: loose,
  poNumber: loose,
  issueDate: loose,
  dueDate: loose,
  subtotal: loose,
  tax: loose,
  total: loose,
  // Optional on the way in, unlike the original eight: a reply from a prompt
  // cached before these existed, or a model that drops them, still yields the
  // rest of the invoice — the VAT type then simply reads as undetermined.
  vatType: optionalLoose,
  supplierTin: optionalLoose,
  vatableSales: optionalLoose,
  zeroRatedSales: optionalLoose,
  exemptSales: optionalLoose,
  lineItems: z.array(lineItemSchema).catch([]),
  // The key must be present — its absence means the reply did not follow the
  // shape at all — but a missing entry inside it is tolerated and lands at a
  // confidence low enough to flag the field.
  confidence: z.record(z.string(), z.number()),
  evidence: z.record(z.string(), z.string().nullable()).optional().catch(undefined),
  ambiguous: z.array(z.string()).optional().catch(undefined),
});

export type GeminiInvoice = z.infer<typeof geminiInvoiceSchema>;
