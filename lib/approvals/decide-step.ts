/**
 * The approval chain, decided one step at a time.
 *
 * This is the rule that a chain advances in sequence, that nobody signs the
 * same invoice twice, and that a rejection abandons whatever is left. It is
 * kept apart from the server action that persists the outcome so it can be
 * tested directly: the action's job is the transaction, this function's job is
 * the decision.
 *
 * The shipped approval ladder currently routes every invoice to a single
 * approval, so the multi-step behaviour here is not exercised by the default
 * rules. It stays correct and tested regardless, because an Admin can still
 * configure a multi-step tier and because a control is not worth much if it
 * only holds for the configuration that happens to ship.
 */

export interface ChainStep {
  id: string;
  sequence: number;
  /** PENDING | APPROVED | REJECTED | SKIPPED */
  status: string;
  approverId: string | null;
}

export type ChainOutcome =
  | { ok: false; reason: "no-pending-step" | "already-decided" }
  | {
      ok: true;
      stepId: string;
      sequence: number;
      /** How many steps the whole chain has, for "step 1 of 2" wording. */
      of: number;
      nextStatus: "APPROVED" | "REJECTED" | "PENDING_APPROVAL";
      fullyApproved: boolean;
      /** True when a rejection leaves later steps to abandon. */
      skipRemaining: boolean;
    };

/**
 * Works out what one person's verdict does to a chain.
 *
 * Sorts defensively: the caller's ordering is not part of the contract, and a
 * chain decided out of sequence would let a later approver stand in for an
 * earlier one.
 */
export function decideStep(
  steps: ChainStep[],
  actorId: string,
  verdict: "approve" | "reject",
): ChainOutcome {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence);

  const step = ordered.find((candidate) => candidate.status === "PENDING");
  if (!step) return { ok: false, reason: "no-pending-step" };

  // Nobody signs the same invoice twice, however long the chain is.
  const alreadyDecided = ordered.some(
    (candidate) => candidate.approverId === actorId && candidate.status !== "PENDING",
  );
  if (alreadyDecided) return { ok: false, reason: "already-decided" };

  const remaining = ordered.filter(
    (candidate) => candidate.id !== step.id && candidate.status === "PENDING",
  ).length;

  const fullyApproved = verdict === "approve" && remaining === 0;

  return {
    ok: true,
    stepId: step.id,
    sequence: step.sequence,
    of: ordered.length,
    nextStatus: verdict === "reject" ? "REJECTED" : fullyApproved ? "APPROVED" : "PENDING_APPROVAL",
    fullyApproved,
    skipRemaining: verdict === "reject" && remaining > 0,
  };
}
