"use client";

import { useActionState, useId, useState } from "react";
import { AlertCircle, Check, ShieldAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { OWNER_SIGNOFF_THRESHOLD_CENTS } from "@/lib/constants";
import { formatCentsWhole } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { approveInvoice, rejectInvoice, type DecisionState } from "./actions";

/**
 * Approve is one click; reject opens a dialog because it demands a reason.
 *
 * The asymmetry is deliberate. Approving is the common path, and a confirm
 * step there only trains people to click through it. A rejection with no
 * explanation sends the clerk back with nothing to act on, so the dialog
 * makes the reason mandatory.
 *
 * The one exception is the owner-authorisation line. Above
 * `OWNER_SIGNOFF_THRESHOLD_CENTS` the approver is expected to have obtained the
 * owner's authorisation outside this system before signing, so approving there
 * does open a dialog. That does not contradict the reasoning above: it fires on
 * roughly one invoice in ten, only where an offline step is genuinely required,
 * which is precisely the case a confirm cannot train anyone to click through.
 * Nothing about the owner's decision is recorded — the dialog is a reminder,
 * not a form.
 */
export function DecisionPanel({
  invoiceId,
  invoiceNumber,
  vendorName,
  amount,
  totalCents,
  stepLabel,
  compact = false,
  returnTo,
}: {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amount: string;
  /** Drives the owner-authorisation warning. Formatted separately as `amount`. */
  totalCents: number;
  /** e.g. "Approval 1 of 2" — says what this click actually completes. */
  stepLabel: string;
  compact?: boolean;
  /** Where to land after deciding. Defaults to the approvals queue. */
  returnTo?: string;
}) {
  const [approveState, approveAction, approving] = useActionState<DecisionState, FormData>(
    approveInvoice,
    {},
  );
  const [rejectState, rejectAction, rejecting] = useActionState<DecisionState, FormData>(
    rejectInvoice,
    {},
  );

  const [rejectOpen, setRejectOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The queue renders one panel per row and a Modal keeps its children mounted,
  // so these ids have to be per-instance — a shared literal would make every
  // row's footer button submit the first row's form.
  const uid = useId();
  const rejectFormId = `reject-invoice-${uid}`;
  const approveFormId = `approve-invoice-${uid}`;

  const needsOwnerAuthorisation = totalCents >= OWNER_SIGNOFF_THRESHOLD_CENTS;
  const hiddenFields = (
    <>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    </>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", compact ? "items-stretch" : "items-end")}>
      {approveState.error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded border border-danger/25 bg-danger-soft px-2 py-1.5 text-xs text-danger"
        >
          <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          {approveState.error}
        </p>
      ) : null}

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size={compact ? "sm" : "md"}
          variant="danger"
          onClick={() => setRejectOpen(true)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Reject
        </Button>

        <form action={approveAction} id={approveFormId}>
          {hiddenFields}
          {needsOwnerAuthorisation ? null : (
            <Button type="submit" size={compact ? "sm" : "md"} variant="primary" loading={approving}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {approving ? "Approving" : "Approve"}
            </Button>
          )}
        </form>

        {needsOwnerAuthorisation ? (
          <Button
            type="button"
            size={compact ? "sm" : "md"}
            variant="primary"
            loading={approving}
            onClick={() => setConfirmOpen(true)}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {approving ? "Approving" : "Approve"}
          </Button>
        ) : null}
      </div>

      {!compact ? <p className="text-2xs text-ink-subtle">{stepLabel}</p> : null}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Has the owner authorised ${invoiceNumber}?`}
        description={`${vendorName} · ${amount}`}
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={approveFormId}
              variant="primary"
              size="md"
              loading={approving}
              onClick={() => setConfirmOpen(false)}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Approve
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2 rounded border border-warn/30 bg-warn-soft px-3 py-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <div className="text-sm text-ink-muted">
            <p className="font-medium text-ink">
              {amount} is above the {formatCentsWhole(OWNER_SIGNOFF_THRESHOLD_CENTS)}{" "}
              owner-authorisation line.
            </p>
            <p className="mt-1.5 leading-relaxed">
              Confirm the owner has authorised this before you approve it.
            </p>
            <p className="mt-1.5 leading-relaxed">
              Nothing about the owner&rsquo;s decision is recorded here — your approval is the only
              signature on file.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject ${invoiceNumber}?`}
        description={`${vendorName} · ${amount}`}
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={rejectFormId}
              variant="danger"
              size="md"
              loading={rejecting}
            >
              {rejecting ? "Rejecting" : "Reject invoice"}
            </Button>
          </>
        }
      >
        <form action={rejectAction} id={rejectFormId}>
          {hiddenFields}

          <label htmlFor={`reject-comment-${uid}`} className="mb-1 block text-xs font-medium text-ink-muted">
            Why are you rejecting it?{" "}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          </label>
          <Textarea
            id={`reject-comment-${uid}`}
            name="comment"
            rows={3}
            required
            placeholder="Amount exceeds the quoted statement of work."
          />
          <p className="mt-1.5 text-xs text-ink-subtle">
            This goes to whoever entered the invoice, and into the audit trail. Rejecting sends it
            back to be corrected and resubmitted — it does not void it.
          </p>

          {rejectState.error ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {rejectState.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
