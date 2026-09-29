/**
 * The contract between whatever reads a document and everything downstream.
 *
 * This shape predates Gemini — it was the output of the regex parser that read
 * Tesseract's text — and it is kept deliberately. The review surfaces, the form
 * prefill, the amber "check this" marks and the audit trail all speak it, so
 * changing the engine underneath cost none of them anything.
 *
 * Confidence is the point of this module, not a decoration. But read the note
 * on `ExtractedField.confidence` before trusting it: with a language model
 * doing the reading, self-reported confidence is the *weakest* of the signals
 * that flag a field, not the strongest.
 */

import type { VatType } from "@/lib/constants";

export interface ExtractedField<T> {
  value: T | null;
  /**
   * 0–1. Above `REVIEW_THRESHOLD` the field is presented as probably right.
   *
   * A model reports how fluent its answer felt, not whether it read a 9 as a 0.
   * `reconcileTotals` overrides this from arithmetic, which is the only signal
   * here that is independent of the reader.
   */
  confidence: number;
  /**
   * The model's account of where it read this — *not* a quotation. It is
   * generated text like any other field and can be wrong or invented, so it is
   * only ever shown as a hint. The document itself is the evidence.
   */
  source: string | null;
}

export interface ExtractedLineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface ExtractedInvoice {
  vendorName: ExtractedField<string>;
  /** A vendor id from the list we sent, validated against it. Never invented. */
  matchedVendorId: string | null;
  invoiceNumber: ExtractedField<string>;
  poNumber: ExtractedField<string>;
  issueDate: ExtractedField<string>;
  dueDate: ExtractedField<string>;
  subtotalCents: ExtractedField<number>;
  taxCents: ExtractedField<number>;
  totalCents: ExtractedField<number>;
  /**
   * The VAT treatment the document declares — a printed marker such as
   * "VAT Reg. TIN" or "VAT-Exempt Sales", never a guess from the amounts.
   * What we do when it is silent is `resolveVatType`'s decision, not this one.
   */
  vatType: ExtractedField<VatType>;
  supplierTin: ExtractedField<string>;
  /** The BIR sales breakdown, where the document prints one. */
  vatableSalesCents: ExtractedField<number>;
  zeroRatedSalesCents: ExtractedField<number>;
  exemptSalesCents: ExtractedField<number>;
  lineItems: ExtractedLineItem[];
  /** False when the upload does not appear to be an invoice at all. */
  looksLikeInvoice: boolean;
  /** Mean confidence across the fields that matter, weighted by importance. */
  overallConfidence: number;
  /** Field names the form marks for checking. See the ordering note below. */
  lowConfidenceFields: string[];
}

/**
 * Below this, a field is flagged for a human to confirm.
 *
 * Raised from 0.75 when the reader changed. 0.75 was tuned against Tesseract's
 * mean *character* confidence, which spread across the whole range. A language
 * model's self-reported confidence piles up at 0.9–1.0 almost regardless of
 * whether it read correctly, so 0.75 would have flagged nothing and the amber
 * marks would have quietly stopped working while still looking functional.
 *
 * A field is flagged, in descending order of how much the signal is worth:
 *
 *   1. `reconcileTotals` doubted it — the figures on the page disagree
 *   2. the value is null — nothing was read
 *   3. the model declared the reading ambiguous
 *   4. self-reported confidence fell below this threshold
 *
 * (4) is the weakest of the four and must not be treated as the primary one.
 * Do not "simplify" this by deleting the arithmetic check in (1); it is the
 * only check that does not take the reader's word for it.
 */
export const REVIEW_THRESHOLD = 0.9;

/** The scalar fields, in the order the form presents them. */
export const SCALAR_FIELDS = [
  "vendorName",
  "invoiceNumber",
  "poNumber",
  "issueDate",
  "dueDate",
  "subtotalCents",
  "taxCents",
  "totalCents",
  "vatType",
  "supplierTin",
] as const;

/**
 * Read like the scalars, but kept out of the "read N of M fields" count: most
 * invoices print one of these buckets, or none, and counting the other two as
 * missing would make every scan look partial.
 */
export const VAT_BUCKET_FIELDS = ["vatableSalesCents", "zeroRatedSalesCents", "exemptSalesCents"] as const;

/** Everything read off the page as a single value. */
export const EXTRACTED_FIELDS = [...SCALAR_FIELDS, ...VAT_BUCKET_FIELDS] as const;

export type ScalarField = (typeof EXTRACTED_FIELDS)[number];

// ---------------------------------------------------------------------------
// What /api/scan returns
// ---------------------------------------------------------------------------

/**
 * Why a scan produced nothing usable, in terms the interface can act on.
 *
 * Deliberately not the provider's vocabulary. Upstream status codes, quota
 * messages and safety verdicts stay in the server log; what crosses the wire is
 * one of these, plus the sentence below it. Anything else risks leaking the
 * shape of our account, our key, or the URL we called.
 */
export type ScanFailureReason =
  | "not-configured"
  | "unauthorized"
  | "forbidden"
  | "invalid-file"
  | "unreachable"
  | "rate-limited"
  | "timeout"
  | "unreadable"
  | "not-an-invoice";

export type ScanResponse =
  | { ok: true; extracted: ExtractedInvoice; model: string }
  | { ok: false; reason: ScanFailureReason; message: string; retryAfterSeconds?: number };

/**
 * The copy, in one place, so the route and the band cannot disagree.
 *
 * Every sentence points at the form below, because on a single page the form is
 * always right there and usable — a failed scan costs the typing it would have
 * saved, nothing more. None of these is a dead end.
 */
export const SCAN_FAILURE_MESSAGE: Record<ScanFailureReason, string> = {
  "not-configured": "Scanning is not set up on this server yet. Fill the form in below.",
  unauthorized: "Your session has expired. Sign in again to scan.",
  forbidden: "Your role cannot scan documents. Fill the form in below.",
  "invalid-file": "That file could not be used. Upload a PDF, PNG, JPEG or WebP under 10 MB.",
  unreachable: "Could not reach the scanning service. Fill the form in below.",
  "rate-limited": "Too many scans right now — wait a minute and try again.",
  timeout: "Reading took too long. Try a smaller or clearer file.",
  unreadable: "That document could not be read reliably. Fill the form in below.",
  "not-an-invoice": "This does not look like an invoice, so nothing was filled in.",
};
