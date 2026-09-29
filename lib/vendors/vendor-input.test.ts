import { describe, expect, it } from "vitest";

import { findNameMatch, vendorInputSchema } from "./vendor-input";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Northwind Logistics",
    category: "Logistics",
    status: "ACTIVE",
    paymentTerms: "NET_30",
    defaultPaymentMethod: "PESONET",
    ...overrides,
  };
}

describe("vendorInputSchema", () => {
  it("accepts a minimal valid vendor", () => {
    expect(vendorInputSchema.safeParse(input()).success).toBe(true);
  });

  it("rejects a blank or whitespace-only name", () => {
    expect(vendorInputSchema.safeParse(input({ name: "" })).success).toBe(false);
    expect(vendorInputSchema.safeParse(input({ name: "   " })).success).toBe(false);
  });

  it("rejects a name longer than 120 characters", () => {
    expect(vendorInputSchema.safeParse(input({ name: "a".repeat(121) })).success).toBe(false);
  });

  it("rejects a category outside the pick list", () => {
    expect(vendorInputSchema.safeParse(input({ category: "Fictional" })).success).toBe(false);
  });

  it("rejects a malformed email but allows none at all", () => {
    expect(vendorInputSchema.safeParse(input({ email: "not-an-email" })).success).toBe(false);
    expect(vendorInputSchema.safeParse(input({ email: undefined })).success).toBe(true);
  });

  it("defaults status, terms, and method when they are absent", () => {
    const parsed = vendorInputSchema.safeParse({
      name: "Northwind Logistics",
      category: "Logistics",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.status).toBe("ACTIVE");
    expect(parsed.data.paymentTerms).toBe("NET_30");
    expect(parsed.data.defaultPaymentMethod).toBe("PESONET");
  });

  it("trims the name it stores", () => {
    const parsed = vendorInputSchema.safeParse(input({ name: "  Northwind Logistics  " }));
    expect(parsed.success && parsed.data.name).toBe("Northwind Logistics");
  });
});

describe("findNameMatch", () => {
  const candidates = [
    { id: "ven_1", name: "ACME Corp" },
    { id: "ven_2", name: "Acme Corporation" },
  ];

  it("matches ignoring case and surrounding space", () => {
    expect(findNameMatch(candidates, "  acme corp ")?.id).toBe("ven_1");
  });

  it("does not match a mere prefix", () => {
    expect(findNameMatch(candidates, "Acme")).toBeNull();
  });

  it("returns null for an empty name", () => {
    expect(findNameMatch(candidates, "   ")).toBeNull();
  });
});
