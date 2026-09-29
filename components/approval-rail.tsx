import { Check, Minus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/constants";

/**
 * The approval rail.
 *
 * An invoice's progress genuinely is an ordered sequence, so it earns a
 * sequential marker — the numbering carries information a reader needs
 * (which sign-off is outstanding), rather than decorating the layout.
 *
 * Emerald marks exactly one thing here: a step that is done, and the ring on
 * the step awaiting a decision. Everything upstream is stroke and grey.
 */

export type RailStepStatus = "complete" | "active" | "pending" | "rejected" | "skipped";

export interface RailStep {
  key: string;
  label: string;
  status: RailStepStatus;
  actorName?: string | null;
  at?: Date | string | null;
  comment?: string | null;
}

/**
 * Builds the rail from an invoice and its approval steps. Entry and payment
 * bookend the chain so the rail always shows the whole life of the invoice,
 * not just the middle of it.
 */
export function buildRail(invoice: {
  status: string;
  createdAt: Date | string;
  submittedAt?: Date | string | null;
  paidAt?: Date | string | null;
  createdBy?: { name: string } | null;
  approvalSteps: Array<{
    id: string;
    sequence: number;
    status: string;
    decidedAt: Date | string | null;
    comment: string | null;
    approver: { name: string } | null;
  }>;
}): RailStep[] {
  const status = invoice.status as InvoiceStatus;
  const submitted = Boolean(invoice.submittedAt);

  const steps: RailStep[] = [
    {
      key: "entered",
      label: "Entered",
      status: "complete",
      actorName: invoice.createdBy?.name ?? null,
      at: invoice.createdAt,
    },
    {
      key: "submitted",
      label: "Submitted",
      status: submitted ? "complete" : status === "DRAFT" ? "active" : "pending",
      at: invoice.submittedAt ?? null,
    },
  ];

  const ordered = [...invoice.approvalSteps].sort((a, b) => a.sequence - b.sequence);
  // The outstanding step is the first still pending — only one is ever active.
  const firstPending = ordered.find((step) => step.status === "PENDING");

  for (const step of ordered) {
    steps.push({
      key: step.id,
      label: ordered.length > 1 ? `Approval ${step.sequence}` : "Approval",
      status:
        step.status === "APPROVED"
          ? "complete"
          : step.status === "REJECTED"
            ? "rejected"
            : step.status === "SKIPPED"
              ? "skipped"
              : step.id === firstPending?.id && status === "PENDING_APPROVAL"
                ? "active"
                : "pending",
      actorName: step.approver?.name ?? null,
      at: step.decidedAt,
      comment: step.comment,
    });
  }

  if (ordered.length === 0 && status !== "DRAFT" && status !== "REJECTED") {
    steps.push({
      key: "auto",
      label: "Auto-approved",
      status: status === "PENDING_APPROVAL" ? "active" : "complete",
      comment: "Below the approval threshold",
    });
  }

  steps.push({
    key: "paid",
    label: "Paid",
    status:
      status === "PAID"
        ? "complete"
        : status === "SCHEDULED"
          ? "active"
          : status === "REJECTED" || status === "VOID"
            ? "skipped"
            : "pending",
    at: invoice.paidAt ?? null,
  });

  return steps;
}

const MARKER: Record<RailStepStatus, string> = {
  complete: "border-accent bg-accent text-white",
  active: "border-accent bg-accent-soft text-accent ring-2 ring-accent-ring",
  pending: "border-line-strong bg-surface text-ink-subtle",
  rejected: "border-danger bg-danger text-white",
  skipped: "border-line bg-canvas text-ink-subtle",
};

const CONNECTOR: Record<RailStepStatus, string> = {
  complete: "bg-accent",
  active: "bg-accent",
  pending: "bg-line",
  rejected: "bg-danger",
  skipped: "bg-line",
};

/** Full rail with labels, names, and timestamps. For the detail screen. */
export function ApprovalRail({ steps, className }: { steps: RailStep[]; className?: string }) {
  return (
    <ol className={cn("flex w-full items-start", className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={step.key} className={cn("flex min-w-0", !isLast && "flex-1")}>
            {/* `w-full` matters: without it this column shrinks to its label
                width and the connector stops short of the next marker. */}
            <div className={cn("flex min-w-0 flex-col items-start", !isLast && "w-full")}>
              <div className="flex w-full items-center">
                <Marker status={step.status} index={index} />
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn("mx-1.5 h-px min-w-4 flex-1", CONNECTOR[step.status])}
                  />
                ) : null}
              </div>

              <div className="mt-1.5 min-w-0 pr-3">
                <p
                  className={cn(
                    "truncate text-xs font-medium",
                    step.status === "pending" || step.status === "skipped"
                      ? "text-ink-subtle"
                      : "text-ink",
                  )}
                >
                  {step.label}
                </p>
                {step.actorName ? (
                  <p className="truncate text-2xs text-ink-muted">{step.actorName}</p>
                ) : null}
                {step.at ? (
                  <p className="truncate text-2xs text-ink-subtle tabular-nums">
                    {formatDateTime(step.at)}
                  </p>
                ) : null}
                {step.comment ? (
                  <p className="mt-0.5 max-w-40 text-2xs italic text-ink-muted">
                    “{step.comment}”
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Marker({ status, index }: { status: RailStepStatus; index: number }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold tabular-nums",
        MARKER[status],
      )}
    >
      {status === "complete" ? (
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      ) : status === "rejected" ? (
        <X className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      ) : status === "skipped" ? (
        <Minus className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
      ) : (
        index + 1
      )}
    </span>
  );
}

/**
 * Segment-only rail for table rows: the same state in ~60px, so a reader can
 * scan a list and see how far each invoice has travelled without opening it.
 */
export function ApprovalRailCompact({
  steps,
  className,
}: {
  steps: RailStep[];
  className?: string;
}) {
  const done = steps.filter((step) => step.status === "complete").length;
  const label = steps.some((step) => step.status === "rejected")
    ? "Rejected"
    : `${done} of ${steps.length} steps complete`;

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={label}>
      <span className="sr-only">{label}</span>
      {steps.map((step) => (
        <span
          key={step.key}
          aria-hidden="true"
          className={cn(
            "h-1 w-3 rounded-[1px] first:rounded-l last:rounded-r",
            step.status === "complete"
              ? "bg-accent"
              : step.status === "active"
                ? "bg-accent/40"
                : step.status === "rejected"
                  ? "bg-danger"
                  : "bg-line",
          )}
        />
      ))}
    </span>
  );
}
