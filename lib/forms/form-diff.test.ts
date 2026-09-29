import { describe, expect, it } from "vitest";

import { hasEdits, snapshotForm } from "./form-diff";

/**
 * A stand-in for the invoice form as it renders on arrival: an issue date
 * already filled with today, one empty line item, everything else blank.
 */
function pristine(): FormData {
  const data = new FormData();
  data.append("vendorId", "");
  data.append("invoiceNumber", "");
  data.append("poNumber", "");
  data.append("issueDate", "2026-09-07");
  data.append("dueDate", "");
  data.append("description", "");
  data.append("glAccount", "");
  data.append("costCenter", "");
  data.append("taxCents", "0");
  data.append(
    "lineItems",
    JSON.stringify([{ description: "", quantity: 1, unitPriceCents: 0, glAccount: null }]),
  );
  return data;
}

describe("hasEdits", () => {
  it("reports an untouched form as clean, pre-filled issue date and all", () => {
    // The case that matters most: the common path must not raise a dialog.
    expect(hasEdits(snapshotForm(pristine()), pristine())).toBe(false);
  });

  it("notices a single typed field", () => {
    const edited = pristine();
    edited.set("invoiceNumber", "INV-2026-0184");
    expect(hasEdits(snapshotForm(pristine()), edited)).toBe(true);
  });

  it("notices a changed vendor, which is a select rather than a text input", () => {
    const edited = pristine();
    edited.set("vendorId", "v1");
    expect(hasEdits(snapshotForm(pristine()), edited)).toBe(true);
  });

  it("notices a line item edit, which arrives as one JSON field", () => {
    const edited = pristine();
    edited.set(
      "lineItems",
      JSON.stringify([
        { description: "Consulting", quantity: 2, unitPriceCents: 50_000, glAccount: null },
      ]),
    );
    expect(hasEdits(snapshotForm(pristine()), edited)).toBe(true);
  });

  it("notices a field appearing or disappearing", () => {
    const added = pristine();
    added.append("ocrConfidence", "0.98");
    expect(hasEdits(snapshotForm(pristine()), added)).toBe(true);

    const removed = pristine();
    removed.delete("poNumber");
    expect(hasEdits(snapshotForm(pristine()), removed)).toBe(true);
  });

  it("ignores the attached file, which nobody typed", () => {
    const withFile = pristine();
    withFile.append("scanFile", new File(["x"], "invoice.png", { type: "image/png" }));
    expect(hasEdits(snapshotForm(pristine()), withFile)).toBe(false);
  });

  it("distinguishes repeated fields that differ from each other", () => {
    const before = new FormData();
    before.append("tag", "a");
    before.append("tag", "b");

    const after = new FormData();
    after.append("tag", "a");
    after.append("tag", "c");

    expect(hasEdits(snapshotForm(before), after)).toBe(true);
  });
});
