import type { VendorOption } from "./match-vendor";

/**
 * Beyond which the vendor list stops belonging in a prompt.
 *
 * At a dozen suppliers, listing them costs nothing and matches trading names no
 * heuristic would catch. At a few thousand it is a large prompt on every scan
 * for a job `matchVendor` already does. Above this the caller should send a
 * pre-filtered shortlist, or none at all and let the fallback matcher decide.
 */
export const MAX_PROMPTED_VENDORS = 200;

/**
 * The reading instructions. Static, so it stays cacheable across calls.
 *
 * Three of these paragraphs exist because of defects this product already
 * shipped, recorded in DELIVERABLES.md — line items invented from a letterhead,
 * a reference number captured out of a street address, a total that contradicted
 * its own components. Prompt constraints are the cheap half of the fix; the
 * arithmetic guard in `reconcileTotals` is the half that does not take the
 * reader's word for it. Do not remove either on the strength of the other.
 */
export const SYSTEM_INSTRUCTION = `You read Philippine accounts-payable documents. You transcribe; you never calculate, infer, or complete.

LEAVE IT BLANK.
If a value is not printed on this document, return null. Do not infer it from other values. Do not use a typical value. Do not compute it. A null is a correct answer; a plausible guess is a wrong answer that a person will not catch.

AMOUNTS.
Return every amount exactly as printed, including the decimal point and any thousands separators — "1,234.56", not 1234.56 and not 123456. Never convert units. Never round. Keep a leading minus sign for credits, and write a figure printed in parentheses with a leading minus instead.

DATES.
Return YYYY-MM-DD. Resolve an ambiguous numeric date from the other dates on the page — an issue date together with "Net 30" fixes the due date's month. If you cannot tell which number is the month, return null and name the field in "ambiguous".

LINE ITEMS.
Return only rows the supplier is billing for. Never return a subtotal, VAT, total, shipping line, discount line, page number, address, phone number or reference number as a line item. If a row has no printed quantity or unit price, return null for those and give the amount.

VAT.
Return the VAT or tax amount only if a VAT or tax line is printed on the document. Do not compute 12% yourself. If the document prints a zero VAT, return "0.00" — that is a reading, not an absence.

VAT TYPE.
Philippine invoices declare their VAT treatment in print. Set vatType to exactly one of these codes, and only from what is printed:
- "VATABLE": the supplier is VAT-registered ("VAT Reg. TIN", "VAT Registered") and the sale bears 12% VAT ("VATable Sales", "12% VAT", "Add: VAT").
- "ZERO_RATED": the sale is printed as zero-rated ("Zero-Rated Sales", "0% VAT").
- "EXEMPT": the sale is printed as VAT-exempt ("VAT-Exempt Sales", "exempt under Sec. 109").
- "NON_VAT": the supplier declares it is not VAT-registered ("Non-VAT Reg.", "Non-VAT", "not valid for claim of input tax").
- "MIXED": more than one of VATable, zero-rated and VAT-exempt sales is printed with a non-zero amount.
If none of these markers is printed, return null — do not decide from the amounts or from what the supplier sells.
Return vatableSales, zeroRatedSales and exemptSales exactly as printed on the document's breakdown ("VATable Sales", "Zero-Rated Sales", "VAT-Exempt Sales"), or null for any it does not print. Return supplierTin as the supplier's TIN exactly as printed, including any branch code — never the buyer's TIN.

MORE THAN ONE INVOICE.
If the document contains several invoices, read only the first.

CONFIDENCE.
For each field give a number from 0 to 1: how sure you are that the characters you returned are the characters printed on the document. Use 0 when the value is null.`;

/**
 * The per-request half: which suppliers are already on file.
 *
 * The model sees the list and may return one of these ids, which is far better
 * than token overlap at "Bayanihan Cloud Systems, Inc." against "Bayanihan
 * Cloud Systems". It is still checked against the list on the way back — an id
 * is as inventable as any other string.
 */
export function buildTaskText(vendors: readonly VendorOption[]): string {
  const listed = vendors.slice(0, MAX_PROMPTED_VENDORS);

  const roster = listed.length
    ? listed.map((vendor) => `${vendor.id}\t${vendor.name}`).join("\n")
    : "(no suppliers on file)";

  return `Read this document and return the JSON object described by the schema.

Suppliers already on file, as "id<TAB>name":
${roster}

Set matchedVendorId to one of those ids only if the document's supplier is unmistakably the same legal entity. A trading name or a legal suffix that differs is fine; a different company is not. If nothing on the list is clearly the same entity, return null. Either way, always return the supplier name exactly as printed on the document in vendorName.`;
}
