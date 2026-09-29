import { describe, expect, it } from "vitest";

import { GEMINI_RESPONSE_SCHEMA, WIRE_SCALARS, WIRE_TO_FIELD } from "./gemini-schema";
import { buildTaskText, MAX_PROMPTED_VENDORS, SYSTEM_INSTRUCTION } from "./prompt";
import { EXTRACTED_FIELDS } from "./types";

const VENDORS = Array.from({ length: 12 }, (_, index) => ({
  id: `v${index}`,
  name: `Supplier ${index}`,
}));

describe("the task text", () => {
  it("lists every supplier with its id, so the model can return one", () => {
    const text = buildTaskText(VENDORS);
    for (const vendor of VENDORS) {
      expect(text).toContain(`${vendor.id}\t${vendor.name}`);
    }
  });

  it("stops listing suppliers past the cap", () => {
    // Beyond this the roster is a large prompt on every scan for a job the
    // fallback matcher already does.
    const many = Array.from({ length: MAX_PROMPTED_VENDORS + 50 }, (_, i) => ({
      id: `v${i}`,
      name: `Supplier ${i}`,
    }));
    const text = buildTaskText(many);

    expect(text).toContain("v0\tSupplier 0");
    expect(text).not.toContain(`v${MAX_PROMPTED_VENDORS}\t`);
  });

  it("says so plainly when there are no suppliers on file", () => {
    expect(buildTaskText([])).toContain("(no suppliers on file)");
  });
});

describe("the system instruction", () => {
  it("states the blank rule, which is the requirement most likely to be lost", () => {
    expect(SYSTEM_INSTRUCTION).toContain("return null");
    expect(SYSTEM_INSTRUCTION).toContain("Do not compute it");
  });

  it("forbids computing VAT, which is what keeps read separable from computed", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Do not compute 12% yourself");
  });

  it("names every VAT type code and forbids deciding it from the amounts", () => {
    for (const code of ["VATABLE", "ZERO_RATED", "EXEMPT", "NON_VAT", "MIXED"]) {
      expect(SYSTEM_INSTRUCTION).toContain(`"${code}"`);
    }
    expect(SYSTEM_INSTRUCTION).toMatch(/do not decide from the amounts/i);
  });

  it("forbids returning totals and addresses as line items", () => {
    expect(SYSTEM_INSTRUCTION).toContain("Never return a subtotal");
  });
});

describe("the response schema", () => {
  it("survives being serialised, since it is sent as JSON", () => {
    expect(() => JSON.stringify(GEMINI_RESPONSE_SCHEMA)).not.toThrow();
  });

  it("uses `nullable` rather than a type union", () => {
    // A `["string", "null"]` union is rejected by the API with HTTP 400 before
    // the model is ever reached — `responseSchema` is an OpenAPI-subset proto,
    // not JSON Schema. Verified live; do not "modernise" it back.
    const serialised = JSON.stringify(GEMINI_RESPONSE_SCHEMA);
    expect(serialised).not.toContain('["string","null"]');
    expect(GEMINI_RESPONSE_SCHEMA.properties.vendorName).toEqual({
      type: "string",
      nullable: true,
    });
  });

  it("requires every scalar, so a forgotten key is a hard error", () => {
    for (const scalar of WIRE_SCALARS) {
      expect(GEMINI_RESPONSE_SCHEMA.required).toContain(scalar);
    }
  });

  it("asks for a confidence entry for every scalar it asks for", () => {
    expect(Object.keys(GEMINI_RESPONSE_SCHEMA.properties.confidence.properties)).toEqual([
      ...WIRE_SCALARS,
    ]);
  });

  it("maps every wire name onto a field the form knows about", () => {
    // The two vocabularies are tied together in exactly one place, and this is
    // what stops them drifting: the model is asked for "subtotal", the form
    // works in "subtotalCents".
    const mapped = WIRE_SCALARS.map((wire) => WIRE_TO_FIELD[wire]);
    expect([...mapped].sort()).toEqual([...EXTRACTED_FIELDS].sort());
  });
});
