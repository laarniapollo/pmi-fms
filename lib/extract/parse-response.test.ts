import { describe, expect, it } from "vitest";

import { parseGeminiInvoice } from "./parse-response";
import { REVIEW_THRESHOLD } from "./types";

const VENDORS = [
  { id: "v1", name: "Bayanihan Cloud Systems" },
  { id: "v2", name: "Northwind Logistics" },
];

const CONFIDENT = {
  vendorName: 0.99,
  invoiceNumber: 0.99,
  poNumber: 0.99,
  issueDate: 0.99,
  dueDate: 0.99,
  subtotal: 0.99,
  tax: 0.99,
  total: 0.99,
};

/** A well-behaved reply, which each test bends in exactly one direction. */
function reply(overrides: Record<string, unknown> = {}) {
  return {
    documentLooksLikeInvoice: true,
    vendorName: "Bayanihan Cloud Systems",
    matchedVendorId: "v1",
    invoiceNumber: "BCS-2026-0184",
    poNumber: "PO-48221",
    issueDate: "2026-03-14",
    dueDate: "2026-04-13",
    subtotal: "2,500,000.00",
    tax: "300,000.00",
    total: "2,800,000.00",
    lineItems: [
      { description: "Platform subscription", quantity: "1", unitPrice: "1,750,000.00", amount: "1,750,000.00" },
      { description: "Additional seats", quantity: "20", unitPrice: "26,500.00", amount: "530,000.00" },
      { description: "Data residency add-on", quantity: "1", unitPrice: "220,000.00", amount: "220,000.00" },
    ],
    confidence: CONFIDENT,
    ...overrides,
  };
}

function extract(overrides: Record<string, unknown> = {}) {
  const result = parseGeminiInvoice(reply(overrides), VENDORS);
  if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`);
  return result.extracted;
}

describe("a clean reply", () => {
  const extracted = extract();

  it("reads the identifying fields", () => {
    expect(extracted.vendorName.value).toBe("Bayanihan Cloud Systems");
    expect(extracted.invoiceNumber.value).toBe("BCS-2026-0184");
    expect(extracted.poNumber.value).toBe("PO-48221");
    expect(extracted.issueDate.value).toBe("2026-03-14");
    expect(extracted.dueDate.value).toBe("2026-04-13");
  });

  it("converts printed amounts to minor units", () => {
    expect(extracted.subtotalCents.value).toBe(250_000_000);
    expect(extracted.taxCents.value).toBe(30_000_000);
    expect(extracted.totalCents.value).toBe(280_000_000);
  });

  it("promotes the money fields because they add up", () => {
    expect(extracted.totalCents.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(extracted.lowConfidenceFields).toEqual([]);
  });

  it("keeps the line items with their own quantities", () => {
    expect(extracted.lineItems).toEqual([
      { description: "Platform subscription", quantity: 1, unitPriceCents: 175_000_000, amountCents: 175_000_000 },
      { description: "Additional seats", quantity: 20, unitPriceCents: 2_650_000, amountCents: 53_000_000 },
      { description: "Data residency add-on", quantity: 1, unitPriceCents: 22_000_000, amountCents: 22_000_000 },
    ]);
  });
});

describe("the blank rule", () => {
  it("leaves every field null when the document said nothing, inventing none of them", () => {
    // The direct test of the requirement. Not one of these may acquire a value.
    const extracted = extract({
      vendorName: null,
      matchedVendorId: null,
      invoiceNumber: null,
      poNumber: null,
      issueDate: null,
      dueDate: null,
      subtotal: null,
      tax: null,
      total: null,
      lineItems: [],
    });

    expect(extracted.vendorName.value).toBeNull();
    expect(extracted.invoiceNumber.value).toBeNull();
    expect(extracted.poNumber.value).toBeNull();
    expect(extracted.issueDate.value).toBeNull();
    expect(extracted.dueDate.value).toBeNull();
    expect(extracted.subtotalCents.value).toBeNull();
    expect(extracted.taxCents.value).toBeNull();
    expect(extracted.totalCents.value).toBeNull();
    expect(extracted.lineItems).toEqual([]);
    expect(extracted.matchedVendorId).toBeNull();
  });

  it("treats a model that writes the word 'null' as a blank", () => {
    expect(extract({ poNumber: "N/A" }).poNumber.value).toBeNull();
    expect(extract({ poNumber: "null" }).poNumber.value).toBeNull();
    expect(extract({ poNumber: "   " }).poNumber.value).toBeNull();
  });

  it("scores a blank at zero confidence however sure the model claimed to be", () => {
    // Observed live: the model returned null and reported 0.98 on the same field.
    const extracted = extract({ subtotal: null, tax: null, total: null });
    expect(extracted.subtotalCents.confidence).toBe(0);
  });

  it("keeps a printed zero, which is a reading and not a silence", () => {
    // This is what lets resolveTax tell "no VAT charged" from "no VAT line".
    expect(extract({ tax: "0.00" }).taxCents.value).toBe(0);
  });
});

describe("amounts as they are actually printed", () => {
  it.each([
    ["₱2,500,000.00", 250_000_000],
    ["PHP 2,500,000.00", 250_000_000],
    ["2 500 000.00", 250_000_000],
    ["2500000.00", 250_000_000],
    ["2,500,000", 250_000_000],
  ])("reads %s", (printed, expected) => {
    expect(extract({ subtotal: printed }).subtotalCents.value).toBe(expected);
  });

  it("accepts a bare number, which a model sends despite the schema", () => {
    expect(extract({ subtotal: 2_500_000 }).subtotalCents.value).toBe(250_000_000);
  });

  it("reads the accounting convention for a credit", () => {
    // `parseCents` alone returns null for this — the bracket is normalised here
    // rather than in `parseCents`, which is shared with hand-typed input.
    expect(extract({ subtotal: "(1,200.00)" }).subtotalCents.value).toBe(-120_000);
    expect(extract({ subtotal: "-1,200.00" }).subtotalCents.value).toBe(-120_000);
  });

  it("carries a credit line as a negative price at a positive quantity", () => {
    // The invoice schema rejects a negative quantity but allows a negative
    // price, so a discount row has to land on the price to survive saving.
    const [item] = extract({
      lineItems: [{ description: "Volume discount", quantity: "1", unitPrice: null, amount: "(50,000.00)" }],
    }).lineItems;

    expect(item).toEqual({
      description: "Volume discount",
      quantity: 1,
      unitPriceCents: -5_000_000,
      amountCents: -5_000_000,
    });
  });

  it("returns null rather than a number for text it cannot read", () => {
    expect(extract({ subtotal: "see attached" }).subtotalCents.value).toBeNull();
  });
});

describe("dates", () => {
  it("rejects anything that is not the shape it asked for", () => {
    // Deciding which half is the month here would be the exact invention the
    // whole design exists to avoid, so it becomes a blank instead.
    expect(extract({ issueDate: "14/03/2026" }).issueDate.value).toBeNull();
    expect(extract({ issueDate: "March 14, 2026" }).issueDate.value).toBeNull();
  });

  it("rejects a date that does not exist", () => {
    // 2026-02-31 parses into March and would silently move the date a week.
    expect(extract({ issueDate: "2026-02-31" }).issueDate.value).toBeNull();
  });
});

describe("line items", () => {
  it("ignores a breakdown that does not multiply out", () => {
    // The printed amount is the figure the supplier is charging; a quantity
    // that disagrees with it must never be allowed to scale it.
    const [item] = extract({
      lineItems: [{ description: "Seats", quantity: "20", unitPrice: "26,500.00", amount: "999,999.00" }],
    }).lineItems;

    expect(item).toEqual({
      description: "Seats",
      quantity: 1,
      unitPriceCents: 99_999_900,
      amountCents: 99_999_900,
    });
  });

  it("drops a row it cannot price rather than storing it at zero", () => {
    // A zero is a claim about the document. An unreadable row is not.
    expect(
      extract({
        lineItems: [
          { description: "Readable", quantity: null, unitPrice: null, amount: "1,000.00" },
          { description: "Unreadable", quantity: null, unitPrice: null, amount: "???" },
          { description: "", quantity: null, unitPrice: null, amount: "500.00" },
        ],
      }).lineItems,
    ).toHaveLength(1);
  });

  it("handles a fractional quantity", () => {
    const [item] = extract({
      lineItems: [{ description: "Consulting", quantity: "1.5", unitPrice: "2,000.00", amount: "3,000.00" }],
    }).lineItems;
    expect(item?.quantity).toBe(1.5);
  });
});

describe("the vendor", () => {
  it("accepts an id that is on the list we sent", () => {
    expect(extract().matchedVendorId).toBe("v1");
  });

  it("drops an id that is not, and falls back to matching the name", () => {
    // A model can invent an id as readily as any other string, and this one
    // decides who gets paid.
    expect(extract({ matchedVendorId: "v-does-not-exist" }).matchedVendorId).toBe("v1");
  });

  it("returns no vendor when the invented id has no name to fall back on", () => {
    expect(
      extract({ matchedVendorId: "v-does-not-exist", vendorName: "Somebody Else Entirely" })
        .matchedVendorId,
    ).toBeNull();
  });

  it("matches by name when the model declines to pick an id", () => {
    expect(extract({ matchedVendorId: null }).matchedVendorId).toBe("v1");
  });
});

describe("which fields get an amber mark", () => {
  it("flags all three money fields when they contradict each other", () => {
    // 2,625,000 + 315,000 is 2,940,000, not 2,040,000.
    const flagged = extract({
      subtotal: "2,625,000.00",
      tax: "315,000.00",
      total: "2,040,000.00",
    }).lowConfidenceFields;

    expect(flagged).toContain("subtotalCents");
    expect(flagged).toContain("taxCents");
    expect(flagged).toContain("totalCents");
  });

  it("flags a field the model said it was unsure of", () => {
    expect(
      extract({ confidence: { ...CONFIDENT, invoiceNumber: 0.4 } }).lowConfidenceFields,
    ).toContain("invoiceNumber");
  });

  it("flags a field the model named as ambiguous, whatever its confidence", () => {
    expect(extract({ ambiguous: ["issueDate"] }).lowConfidenceFields).toContain("issueDate");
  });

  it("flags a missing field that every invoice should have", () => {
    expect(extract({ invoiceNumber: null }).lowConfidenceFields).toContain("invoiceNumber");
    expect(extract({ total: null }).lowConfidenceFields).toContain("totalCents");
  });

  it("does not flag a blank that is simply normal", () => {
    // Most invoices carry no PO number, and a missing VAT line is answered by
    // a visibly computed figure. Marking those amber would put a warning on
    // nearly every scan, which costs us the warnings that mean something.
    const extracted = extract({ poNumber: null, tax: null });
    expect(extracted.lowConfidenceFields).not.toContain("poNumber");
    expect(extracted.lowConfidenceFields).not.toContain("taxCents");
  });

  it("flags a field whose confidence the model simply omitted", () => {
    const { invoiceNumber, ...withoutInvoiceNumber } = CONFIDENT;
    void invoiceNumber;
    expect(
      extract({ confidence: withoutInvoiceNumber }).lowConfidenceFields,
    ).toContain("invoiceNumber");
  });
});

describe("replies that are not what we asked for", () => {
  it("reports rather than throws, whatever arrives", () => {
    for (const input of ["not json", "{", "[]", "null", "42", {}, null, [], 42, undefined]) {
      expect(() => parseGeminiInvoice(input, VENDORS)).not.toThrow();
      expect(parseGeminiInvoice(input, VENDORS).ok).toBe(false);
    }
  });

  it("fails when the confidence block is missing entirely", () => {
    // Its absence means the reply did not follow the shape at all, which is
    // different from one entry inside it being absent.
    const { confidence, ...withoutConfidence } = reply();
    void confidence;
    expect(parseGeminiInvoice(withoutConfidence, VENDORS).ok).toBe(false);
  });

  it("accepts a JSON string as readily as an object", () => {
    expect(parseGeminiInvoice(JSON.stringify(reply()), VENDORS).ok).toBe(true);
  });

  it("survives line items that are the wrong shape", () => {
    expect(extract({ lineItems: "not an array" }).lineItems).toEqual([]);
    expect(extract({ lineItems: [{ description: "Row", amount: "100.00" }] }).lineItems).toHaveLength(1);
  });

  it("reports a document that is not an invoice without failing", () => {
    const result = parseGeminiInvoice(reply({ documentLooksLikeInvoice: false }), VENDORS);
    expect(result.ok).toBe(true);
    expect(result.ok && result.extracted.looksLikeInvoice).toBe(false);
  });

  it("clamps a confidence outside 0–1", () => {
    const extracted = extract({ confidence: { ...CONFIDENT, vendorName: 7 } });
    expect(extracted.vendorName.confidence).toBe(1);
  });
});

describe("line items that disagree with the printed subtotal", () => {
  it("flags the rows when they do not add up to the subtotal on the document", () => {
    // The only per-row signal there is, and the one that would have caught a
    // street address being read as a charge.
    const flagged = extract({
      subtotal: "2,500,000.00",
      lineItems: [
        { description: "Platform subscription", quantity: "1", unitPrice: "1,750,000.00", amount: "1,750,000.00" },
      ],
    }).lowConfidenceFields;

    expect(flagged).toContain("lineItems");
  });

  it("leaves the rows unflagged when they add up", () => {
    expect(extract().lowConfidenceFields).not.toContain("lineItems");
  });

  it("says nothing about rows when there is no subtotal to check them against", () => {
    expect(extract({ subtotal: null }).lowConfidenceFields).not.toContain("lineItems");
  });
});

describe("VAT type and breakdown", () => {
  const VAT_CONFIDENT = {
    ...CONFIDENT,
    vatType: 0.97,
    supplierTin: 0.97,
    vatableSales: 0.97,
    zeroRatedSales: 0.97,
    exemptSales: 0.97,
  };

  it("reads a printed code, TIN and breakdown", () => {
    const extracted = extract({
      vatType: "VATABLE",
      supplierTin: "008 624 193 000",
      vatableSales: "2,500,000.00",
      confidence: VAT_CONFIDENT,
    });
    expect(extracted.vatType.value).toBe("VATABLE");
    expect(extracted.vatType.confidence).toBe(0.97);
    expect(extracted.supplierTin.value).toBe("008-624-193-000");
    expect(extracted.vatableSalesCents.value).toBe(250_000_000);
    expect(extracted.lowConfidenceFields).toEqual([]);
  });

  it("accepts the printed spellings a model drifts back to", () => {
    expect(extract({ vatType: "zero-rated" }).vatType.value).toBe("ZERO_RATED");
    expect(extract({ vatType: "Non-VAT" }).vatType.value).toBe("NON_VAT");
    expect(extract({ vatType: "vat exempt" }).vatType.value).toBe("EXEMPT");
  });

  it("never maps an unknown code onto a real one, and flags it", () => {
    const extracted = extract({ vatType: "PERCENTAGE_TAX", confidence: VAT_CONFIDENT });
    expect(extracted.vatType.value).toBeNull();
    expect(extracted.lowConfidenceFields).toContain("vatType");
  });

  it("leaves a silent document undetermined without flagging it", () => {
    const extracted = extract();
    expect(extracted.vatType.value).toBeNull();
    expect(extracted.lowConfidenceFields).not.toContain("vatType");
  });

  it("keeps a TIN that is not one, so the form can ask for a fix", () => {
    expect(extract({ supplierTin: "12-3456" }).supplierTin.value).toBe("12-3456");
  });

  it("flags a breakdown that does not account for the subtotal", () => {
    const extracted = extract({
      vatType: "MIXED",
      vatableSales: "2,000,000.00",
      zeroRatedSales: "400,000.00",
      confidence: VAT_CONFIDENT,
    });
    expect(extracted.lowConfidenceFields).toContain("vatBreakdown");
  });

  it("does not flag a breakdown that adds up", () => {
    const extracted = extract({
      vatType: "MIXED",
      vatableSales: "2,000,000.00",
      zeroRatedSales: "500,000.00",
      exemptSales: "0.00",
      confidence: VAT_CONFIDENT,
    });
    expect(extracted.lowConfidenceFields).not.toContain("vatBreakdown");
  });
});
