import { describe, expect, it } from "vitest";

import { decideStep, type ChainStep } from "./decide-step";

const pending = (id: string, sequence: number): ChainStep => ({
  id,
  sequence,
  status: "PENDING",
  approverId: null,
});

const signed = (id: string, sequence: number, approverId: string): ChainStep => ({
  id,
  sequence,
  status: "APPROVED",
  approverId,
});

describe("decideStep", () => {
  it("claims the earliest pending step, not an arbitrary one", () => {
    const outcome = decideStep([signed("s1", 1, "ann"), pending("s2", 2), pending("s3", 3)], "bea", "approve");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stepId).toBe("s2");
    expect(outcome.sequence).toBe(2);
    expect(outcome.of).toBe(3);
  });

  it("orders the chain itself rather than trusting how the steps arrive", () => {
    // A chain decided out of sequence would let a later approver stand in for
    // an earlier one, so the ordering cannot be the caller's responsibility.
    const outcome = decideStep([pending("s3", 3), pending("s1", 1), pending("s2", 2)], "ann", "approve");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sequence).toBe(1);
  });

  it("fully approves a one-step chain — the shipped ladder's only shape", () => {
    const outcome = decideStep([pending("s1", 1)], "ann", "approve");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fullyApproved).toBe(true);
    expect(outcome.nextStatus).toBe("APPROVED");
    expect(outcome.skipRemaining).toBe(false);
  });

  it("leaves a two-step chain pending after the first signature", () => {
    const outcome = decideStep([pending("s1", 1), pending("s2", 2)], "ann", "approve");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fullyApproved).toBe(false);
    expect(outcome.nextStatus).toBe("PENDING_APPROVAL");
  });

  it("lets a different approver complete the second step", () => {
    const outcome = decideStep([signed("s1", 1, "ann"), pending("s2", 2)], "bea", "approve");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stepId).toBe("s2");
    expect(outcome.fullyApproved).toBe(true);
    expect(outcome.nextStatus).toBe("APPROVED");
  });

  it("refuses the same approver a second signature on the same invoice", () => {
    // One person, one signature — the control an auditor actually tests.
    const outcome = decideStep([signed("s1", 1, "ann"), pending("s2", 2)], "ann", "approve");

    expect(outcome).toEqual({ ok: false, reason: "already-decided" });
  });

  it("abandons the remaining steps when a chain is rejected part-way", () => {
    const outcome = decideStep([pending("s1", 1), pending("s2", 2)], "ann", "reject");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.nextStatus).toBe("REJECTED");
    expect(outcome.fullyApproved).toBe(false);
    expect(outcome.skipRemaining).toBe(true);
  });

  it("refuses cleanly when every step has already been decided", () => {
    const outcome = decideStep([signed("s1", 1, "ann"), signed("s2", 2, "bea")], "cy", "approve");

    expect(outcome).toEqual({ ok: false, reason: "no-pending-step" });
  });
});
