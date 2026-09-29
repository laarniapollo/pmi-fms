"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit/record";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { currentIp, requireUser } from "@/lib/auth/session";
import { publish } from "@/lib/realtime/bus";

import { decideStep } from "@/lib/approvals/decide-step";

export interface DecisionState {
  error?: string;
}

const decisionSchema = z.object({
  invoiceId: z.string().min(1),
  comment: z.string().trim().max(500, "Keep the comment under 500 characters").optional(),
  /** Where to land afterwards — the queue, or the invoice it was decided from. */
  returnTo: z.string().optional(),
});

/**
 * Records one approver's decision on an invoice.
 *
 * Approving advances the chain: the earliest pending step is claimed, and the
 * invoice only becomes APPROVED once no pending step remains. Rejecting stops
 * the chain outright — a rejected invoice goes back to the clerk to correct
 * and resubmit, rather than continuing to the next approver.
 *
 * The permission check is done against the loaded invoice, not against the
 * role alone, so the separation-of-duties rule applies even if someone posts
 * this endpoint directly.
 */
export async function approveInvoice(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide(formData, "approve");
}

export async function rejectInvoice(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide(formData, "reject");
}

async function decide(formData: FormData, verdict: "approve" | "reject"): Promise<DecisionState> {
  const user = await requireUser();

  const parsed = decisionSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    comment: formData.get("comment") || undefined,
    returnTo: formData.get("returnTo") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Could not record that decision." };
  }

  const { invoiceId, comment, returnTo } = parsed.data;

  if (verdict === "reject" && !comment) {
    // Approving silently is fine; rejecting without saying why sends the clerk
    // back with nothing to act on.
    return { error: "Say why you are rejecting it so the clerk can correct it." };
  }

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      vendor: { select: { name: true } },
      approvalSteps: { orderBy: { sequence: "asc" } },
    },
  });
  if (!invoice) return { error: "That invoice no longer exists." };

  try {
    assertCan(user, "invoice:approve", {
      kind: "invoice",
      createdById: invoice.createdById,
      status: invoice.status,
      archivedAt: invoice.archivedAt,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return {
        error:
          invoice.createdById === user.id
            ? "You entered this invoice, so somebody else has to approve it."
            : "This invoice is not awaiting your decision.",
      };
    }
    throw error;
  }

  // What the verdict does to the chain is decided in lib/approvals/decide-step,
  // which is unit-tested; everything below is persistence.
  const outcome = decideStep(invoice.approvalSteps, user.id, verdict);
  if (!outcome.ok) {
    return {
      error:
        outcome.reason === "no-pending-step"
          ? "Every approval on this invoice has already been decided."
          : "You have already recorded a decision on this invoice.",
    };
  }
  const { fullyApproved, nextStatus } = outcome;

  const now = new Date();
  const ipAddress = await currentIp();

  const result = await db.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: outcome.stepId },
      data: {
        status: verdict === "approve" ? "APPROVED" : "REJECTED",
        approverId: user.id,
        decidedAt: now,
        comment: comment ?? null,
      },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: nextStatus,
        approvedAt: fullyApproved ? now : null,
        rejectedAt: verdict === "reject" ? now : null,
        rejectionReason: verdict === "reject" ? (comment ?? null) : null,
        // A rejected chain is abandoned; resubmission builds a fresh one.
        ...(outcome.skipRemaining
          ? { approvalSteps: { updateMany: { where: { status: "PENDING" }, data: { status: "SKIPPED" } } } }
          : {}),
      },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: verdict === "approve" ? AUDIT_ACTIONS.INVOICE_APPROVED : AUDIT_ACTIONS.INVOICE_REJECTED,
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoice.invoiceNumber,
        summary:
          verdict === "approve"
            ? fullyApproved
              ? `Approved invoice ${invoice.invoiceNumber} — fully approved`
              : `Approved invoice ${invoice.invoiceNumber} — step ${outcome.sequence} of ${outcome.of}`
            : `Rejected invoice ${invoice.invoiceNumber}`,
        metadata: {
          step: outcome.sequence,
          of: outcome.of,
          ...(comment ? { comment } : {}),
        },
        ipAddress,
      },
      tx,
    );

    await tx.notification.create({
      data: {
        userId: invoice.createdById,
        type: verdict === "approve" ? "INVOICE_APPROVED" : "INVOICE_REJECTED",
        title:
          verdict === "approve"
            ? fullyApproved
              ? `${invoice.invoiceNumber} is fully approved`
              : `${invoice.invoiceNumber} cleared approval ${outcome.sequence}`
            : `${invoice.invoiceNumber} was rejected`,
        body: comment ?? `${user.name} · ${invoice.vendor.name}`,
        linkUrl: `/invoices/${invoiceId}`,
      },
    });

    return { nextStatus, fullyApproved };
  });

  publish({
    type: "invoice.changed",
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    status: result.nextStatus,
    actorId: user.id,
    summary:
      verdict === "approve"
        ? `${user.name} approved ${invoice.invoiceNumber}`
        : `${user.name} rejected ${invoice.invoiceNumber}`,
  });
  publish({
    type: "notification.created",
    userId: invoice.createdById,
    title: `${invoice.invoiceNumber} was ${verdict === "approve" ? "approved" : "rejected"}`,
  });

  revalidatePath("/approvals");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/dashboard");

  // Same-origin paths only — an open redirect on a form anyone can post to
  // would be a phishing gift.
  const destination =
    returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/approvals";
  const separator = destination.includes("?") ? "&" : "?";

  redirect(
    `${destination}${separator}decided=${verdict}&invoice=${encodeURIComponent(invoice.invoiceNumber)}`,
  );
}

/**
 * Voids an invoice outright. Used when an invoice should never be paid —
 * a duplicate, or one raised in error — rather than rejected back for
 * correction.
 */
export async function voidInvoice(formData: FormData): Promise<void> {
  const user = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) redirect("/invoices");

  assertCan(user, "invoice:void", {
    kind: "invoice",
    createdById: invoice.createdById,
    status: invoice.status,
    archivedAt: invoice.archivedAt,
  });

  await db.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "VOID",
        rejectionReason: reason || null,
        approvalSteps: { updateMany: { where: { status: "PENDING" }, data: { status: "SKIPPED" } } },
      },
    });

    // Cancel anything queued — voiding an invoice with a payment still
    // scheduled against it would let the money leave anyway.
    await tx.payment.updateMany({
      where: { invoiceId, status: { in: ["SCHEDULED", "PROCESSING"] } },
      data: { status: "CANCELLED", failureReason: "Invoice voided" },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.INVOICE_VOIDED,
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoice.invoiceNumber,
        summary: `Voided invoice ${invoice.invoiceNumber}`,
        metadata: reason ? { reason } : undefined,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  publish({
    type: "invoice.changed",
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    status: "VOID",
    actorId: user.id,
    summary: `${user.name} voided ${invoice.invoiceNumber}`,
  });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  redirect(`/invoices/${invoiceId}?voided=1`);
}

/** Moves settled work off the active ledger. */
export async function archiveInvoice(formData: FormData): Promise<void> {
  const user = await requireUser();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const restore = formData.get("restore") === "1";

  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) redirect("/invoices");

  assertCan(user, "invoice:archive", {
    kind: "invoice",
    createdById: invoice.createdById,
    status: invoice.status,
    // Restoring necessarily acts on an archived invoice, so the archived
    // guard would refuse it; the status check above is the real control.
    archivedAt: null,
  });

  await db.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { archivedAt: restore ? null : new Date() },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: restore ? AUDIT_ACTIONS.INVOICE_RESTORED : AUDIT_ACTIONS.INVOICE_ARCHIVED,
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoice.invoiceNumber,
        summary: `${restore ? "Restored" : "Archived"} invoice ${invoice.invoiceNumber}`,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  revalidatePath("/invoices");
  revalidatePath("/archive");
  redirect(restore ? `/invoices/${invoiceId}?restored=1` : "/archive?archived=1");
}
