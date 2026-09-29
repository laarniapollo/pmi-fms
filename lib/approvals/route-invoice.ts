import { OWNER_SIGNOFF_THRESHOLD_CENTS, ROLES, type Role } from "@/lib/constants";
import { formatCentsWhole } from "@/lib/format";

/**
 * Approval routing.
 *
 * An invoice's total selects exactly one threshold tier, and that tier decides
 * how many sequential sign-offs the invoice needs. The rules are data, edited
 * by an Admin on the settings screen, so this module stays a pure function of
 * (amount, tiers) and is unit-tested at the tier boundaries.
 */

export interface ThresholdTier {
  id: string;
  label: string;
  minCents: number;
  /** Null means unbounded — the top tier. */
  maxCents: number | null;
  requiredApprovals: number;
  autoApprove: boolean;
  sortOrder: number;
}

export interface PlannedStep {
  sequence: number;
  requiredRole: Role;
}

export interface RoutingPlan {
  tier: ThresholdTier | null;
  /** True when the amount falls in an auto-approve tier; `steps` is then empty. */
  autoApprove: boolean;
  steps: PlannedStep[];
}

/**
 * Picks the tier covering `amountCents`.
 *
 * Bounds are inclusive at both ends, and tiers are expected not to overlap. A
 * gap in the ladder returns null, which callers treat as "needs one approval"
 * rather than "needs none" — failing toward more oversight, not less.
 */
export function selectTier(amountCents: number, tiers: ThresholdTier[]): ThresholdTier | null {
  const ordered = [...tiers].sort((a, b) => a.minCents - b.minCents);
  return (
    ordered.find(
      (tier) =>
        amountCents >= tier.minCents && (tier.maxCents === null || amountCents <= tier.maxCents),
    ) ?? null
  );
}

/**
 * Produces the approval chain for an invoice total.
 *
 * The default when no tier matches is a single Approver sign-off — an invoice
 * must never fall through the rules and become payable unreviewed.
 */
export function planApprovals(amountCents: number, tiers: ThresholdTier[]): RoutingPlan {
  const tier = selectTier(amountCents, tiers);

  if (!tier) {
    return {
      tier: null,
      autoApprove: false,
      steps: [{ sequence: 1, requiredRole: ROLES.APPROVER }],
    };
  }

  if (tier.autoApprove || tier.requiredApprovals <= 0) {
    return { tier, autoApprove: true, steps: [] };
  }

  const steps: PlannedStep[] = Array.from({ length: tier.requiredApprovals }, (_, index) => ({
    sequence: index + 1,
    // Every step is an Approver sign-off; Admins satisfy them too, since the
    // permission matrix grants Admin `invoice:approve`.
    requiredRole: ROLES.APPROVER,
  }));

  return { tier, autoApprove: false, steps };
}

/**
 * The tier ladder created on first run and restorable from settings.
 *
 * Two things about it are deliberate.
 *
 * There is no auto-approve band. Approval is required from ₱0 up, so a ₱480
 * courier bill is signed by a person exactly as a ₱4,000,000 one is. The engine
 * still supports `autoApprove` and an Admin can configure a band on the
 * settings screen — the shipped default simply does not have one.
 *
 * Both tiers require the same single approval. The second exists only to name
 * the ₱3,000,000 line, above which the approver must obtain the owner's
 * authorisation before signing. That is a warning, not a routing rule: the
 * owner is not a user of this system and nothing about their decision is
 * recorded, so the ladder cannot and does not express it as a second step.
 */
export const DEFAULT_TIERS: Array<Omit<ThresholdTier, "id">> = [
  {
    label: "Standard",
    minCents: 0,
    maxCents: OWNER_SIGNOFF_THRESHOLD_CENTS - 1, // through ₱2,999,999.99
    requiredApprovals: 1,
    autoApprove: false,
    sortOrder: 0,
  },
  {
    label: "Owner escalation",
    minCents: OWNER_SIGNOFF_THRESHOLD_CENTS, // ₱3,000,000.00 and above
    maxCents: null,
    requiredApprovals: 1,
    autoApprove: false,
    sortOrder: 1,
  },
];

/** One-line description of a tier, used on the settings screen and in help text. */
export function describeTier(tier: ThresholdTier): string {
  const bound =
    tier.maxCents === null
      ? `${formatCentsWhole(tier.minCents)} and above`
      : `${formatCentsWhole(tier.minCents)} to ${formatCentsWhole(tier.maxCents)}`;

  if (tier.autoApprove) return `${bound} — approved automatically`;
  const count = tier.requiredApprovals;
  const signatures = `${count} ${count === 1 ? "approval" : "sequential approvals"}`;
  const escalated = tier.minCents >= OWNER_SIGNOFF_THRESHOLD_CENTS;
  return escalated
    ? `${bound} — ${signatures}, and the owner must authorise it personally`
    : `${bound} — ${signatures}`;
}
