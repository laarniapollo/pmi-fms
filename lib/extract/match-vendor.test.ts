import { describe, expect, it } from "vitest";

import { matchVendor } from "./match-vendor";

/**
 * This function decides which supplier gets paid, and until now had no tests at
 * all. The boundary cases below are the ones that matter: too loose and an
 * invoice is filed against a stranger, too tight and every scan makes the clerk
 * pick the vendor by hand.
 */
const VENDORS = [
  { id: "v1", name: "Bayanihan Cloud Systems" },
  { id: "v2", name: "Northwind Logistics" },
  { id: "v3", name: "Manila Office Depot" },
];

describe("matchVendor", () => {
  it("matches an exact name", () => {
    expect(matchVendor("Bayanihan Cloud Systems", VENDORS)?.id).toBe("v1");
  });

  it("ignores case and punctuation", () => {
    expect(matchVendor("BAYANIHAN CLOUD SYSTEMS.", VENDORS)?.id).toBe("v1");
  });

  it("sees through a legal suffix the letterhead adds", () => {
    // "inc" is a stopword, so the extra token neither helps nor penalises.
    expect(matchVendor("Bayanihan Cloud Systems, Inc.", VENDORS)?.id).toBe("v1");
  });

  it("survives a misread word when most of the name still lines up", () => {
    // 2 of 3 tokens intact — above the bar.
    expect(matchVendor("Bayanihan Cloud Systerns", VENDORS)?.id).toBe("v1");
  });

  it("refuses a two-word name with one word misread, and that is deliberate", () => {
    // Exactly 0.5, so it is rejected. Accepting it would mean accepting the
    // case below too, which is a different company altogether.
    expect(matchVendor("Northwmd Logistics", VENDORS)).toBeNull();
    expect(matchVendor("Manila Logistics", VENDORS)).toBeNull();
  });

  it("requires more than half the tokens, not merely one in common", () => {
    // "Systems" alone against "Bayanihan Cloud Systems" is 1/3 — under the bar.
    expect(matchVendor("Systems", VENDORS)).toBeNull();
  });

  it("refuses a company that is simply not on the list", () => {
    expect(matchVendor("Pilipinas Shell Petroleum", VENDORS)).toBeNull();
  });

  it("returns null for an empty name or an empty list", () => {
    expect(matchVendor(null, VENDORS)).toBeNull();
    expect(matchVendor("", VENDORS)).toBeNull();
    expect(matchVendor("Bayanihan Cloud Systems", [])).toBeNull();
  });

  it("returns null when a name is nothing but stopwords and short tokens", () => {
    expect(matchVendor("The and Inc", VENDORS)).toBeNull();
  });
});
