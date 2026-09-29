import { describe, expect, it } from "vitest";

import { OWNER_SIGNOFF_THRESHOLD_CENTS } from "@/lib/constants";

import { DEFAULT_TIERS, planApprovals, selectTier, type ThresholdTier } from "./route-invoice";

const tiers: ThresholdTier[] = DEFAULT_TIERS.map((tier, index) => ({ id: `t${index}`, ...tier }));

describe("tier selection at the boundaries", () => {
  // Off-by-one here decides whether a ₱3,000,000 invoice carries the owner
  // warning, so the exact boundary values are the cases worth pinning down.
  it.each([
    [0, "Standard"],
    [48_000, "Standard"], // ₱480.00 — nothing clears itself any more
    [299_999_999, "Standard"], // ₱2,999,999.99
    [300_000_000, "Owner escalation"], // ₱3,000,000.00 exactly
    [800_000_000, "Owner escalation"],
  ])("routes %d minor units to the %s tier", (cents, expected) => {
    expect(selectTier(cents, tiers)?.label).toBe(expected);
  });

  it("pins the escalation boundary to the constant the UI keys off", () => {
    // The warning is driven by OWNER_SIGNOFF_THRESHOLD_CENTS, not by the tier,
    // because the surfaces that show it never load the ladder. If an Admin ever
    // moves this boundary on a settings screen, the two must move together.
    expect(DEFAULT_TIERS[1]!.minCents).toBe(OWNER_SIGNOFF_THRESHOLD_CENTS);
    expect(DEFAULT_TIERS[0]!.maxCents).toBe(OWNER_SIGNOFF_THRESHOLD_CENTS - 1);
  });

  it("leaves no amount unapproved — the shipped ladder has no auto-approve band", () => {
    for (const tier of tiers) {
      expect(tier.autoApprove).toBe(false);
      expect(tier.requiredApprovals).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("planApprovals", () => {
  it("requires one sign-off on the smallest invoice there is", () => {
    const plan = planApprovals(48_000, tiers); // ₱480.00
    expect(plan.autoApprove).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toEqual({ sequence: 1, requiredRole: "APPROVER" });
  });

  it("requires the same single sign-off above the escalation line", () => {
    // The owner authorises outside the system, so the chain does not grow —
    // the approver's signature stays the only one on file.
    const plan = planApprovals(392_000_000, tiers); // ₱3,920,000.00
    expect(plan.tier?.label).toBe("Owner escalation");
    expect(plan.steps).toHaveLength(1);
  });

  it("still auto-approves for a tier configured that way", () => {
    // The shipped ladder has no auto-approve band, but the engine keeps the
    // capability for an Admin who configures one. Built explicitly here so this
    // coverage does not vanish with a change to the default ladder.
    const configured: ThresholdTier[] = [
      { id: "a", label: "Petty cash", minCents: 0, maxCents: null, requiredApprovals: 0, autoApprove: true, sortOrder: 0 },
    ];
    const plan = planApprovals(45_000, configured);
    expect(plan.autoApprove).toBe(true);
    expect(plan.steps).toHaveLength(0);
  });

  it("still builds a two-step chain for a tier configured that way", () => {
    const configured: ThresholdTier[] = [
      { id: "b", label: "Dual control", minCents: 0, maxCents: null, requiredApprovals: 2, autoApprove: false, sortOrder: 0 },
    ];
    const plan = planApprovals(2_500_000, configured);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.map((step) => step.sequence)).toEqual([1, 2]);
  });

  it("numbers steps from one, contiguously", () => {
    const custom: ThresholdTier[] = [
      { id: "x", label: "Everything", minCents: 0, maxCents: null, requiredApprovals: 4, autoApprove: false, sortOrder: 0 },
    ];
    expect(planApprovals(100, custom).steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("falls back to one approval when no tier covers the amount", () => {
    // A gap in the ladder must fail toward more oversight, never less: an
    // invoice that matches no rule is the last thing that should pay itself.
    const gapped: ThresholdTier[] = [
      { id: "a", label: "Small", minCents: 0, maxCents: 1_000, requiredApprovals: 1, autoApprove: false, sortOrder: 0 },
      { id: "b", label: "Large", minCents: 100_000, maxCents: null, requiredApprovals: 2, autoApprove: false, sortOrder: 1 },
    ];

    const plan = planApprovals(50_000, gapped);
    expect(plan.tier).toBeNull();
    expect(plan.autoApprove).toBe(false);
    expect(plan.steps).toHaveLength(1);
  });

  it("treats a tier requiring zero approvals as auto-approval", () => {
    const zeroed: ThresholdTier[] = [
      { id: "z", label: "Free pass", minCents: 0, maxCents: null, requiredApprovals: 0, autoApprove: false, sortOrder: 0 },
    ];
    expect(planApprovals(999_999, zeroed).autoApprove).toBe(true);
  });

  it("selects the same tier regardless of the order tiers arrive in", () => {
    const shuffled = [...tiers].reverse();
    expect(planApprovals(300_000_000, shuffled).tier?.label).toBe("Owner escalation");
    expect(planApprovals(0, shuffled).tier?.label).toBe("Standard");
  });
});
