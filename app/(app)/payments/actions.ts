"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS, PAYMENT_METHOD_META, type PaymentMethod } from "@/lib/constants";
import { formatCents } from "@/lib/format";
import { recordAudit } from "@/lib/audit/record";
import { assertCan } from "@/lib/auth/permissions";
import { currentIp, requireUser } from "@/lib/auth/session";
import { publish } from "@/lib/realtime/bus";

/**
 * Payment execution is simulated — no payment rail is contacted. What is real
 * is the state machine and the record it leaves: SCHEDULED → COMPLETED, with
 * the invoice marked paid inside the same transaction that completes the
 * payment. Making this real means replacing the execute step with a rail call;
 * nothing else here would change.
 */

/** `PAY-2026-00042`, sequential within the year. */
async function nextPaymentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.payment.count();
  return `PAY-${year}-${String(count + 1).padStart(5, "0")}`;
}

async function nextBatchNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.paymentBatch.count();
  return `RUN-${year}-${String(count + 1).padStart(3, "0")}`;
}

export async function schedulePayment(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCan(user, "payment:manage");

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const method = String(formData.get("method") ?? "PESONET") as PaymentMethod;
  const scheduledFor = String(formData.get("scheduledDate") ?? "");

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { vendor: { select: { name: true } }, payments: true },
  });
  if (!invoice) redirect("/invoices");

  // Only an approved invoice is payable, and only once.
  if (invoice.status !== "APPROVED") redirect(`/invoices/${invoiceId}?error=notpayable`);
  if (
    invoice.payments.some((payment) =>
      ["SCHEDULED", "PROCESSING", "COMPLETED"].includes(payment.status),
    )
  ) {
    redirect(`/invoices/${invoiceId}?error=alreadyscheduled`);
  }

  const scheduledDate = scheduledFor ? new Date(scheduledFor) : new Date();
  const paymentNumber = await nextPaymentNumber();

  const payment = await db.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        paymentNumber,
        invoiceId,
        method,
        amountCents: invoice.totalCents,
        status: "SCHEDULED",
        scheduledDate,
        memo: `${invoice.invoiceNumber} · ${invoice.vendor.name}`,
        initiatedById: user.id,
      },
    });

    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "SCHEDULED" } });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.PAYMENT_SCHEDULED,
        entityType: "Payment",
        entityId: created.id,
        entityLabel: paymentNumber,
        summary: `Scheduled ${formatCents(invoice.totalCents)} to ${invoice.vendor.name} by ${PAYMENT_METHOD_META[method]?.label ?? method}`,
        metadata: { invoice: invoice.invoiceNumber, method, amount: invoice.totalCents / 100 },
        ipAddress: await currentIp(),
      },
      tx,
    );

    return created;
  });

  publish({
    type: "invoice.changed",
    invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    status: "SCHEDULED",
    actorId: user.id,
    summary: `${user.name} scheduled payment for ${invoice.invoiceNumber}`,
  });

  revalidatePath("/payments");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/dashboard");
  redirect(`/payments/${payment.id}?scheduled=1`);
}

/**
 * Runs a scheduled payment.
 *
 * The invoice is marked paid inside the same transaction that completes the
 * payment, so the two can never disagree — a payment recorded as sent against
 * an invoice still showing as owing is the kind of discrepancy that takes a
 * week to unpick.
 */
export async function executePayment(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCan(user, "payment:manage");

  const paymentId = String(formData.get("paymentId") ?? "");
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { select: { id: true, invoiceNumber: true, createdById: true } } },
  });
  if (!payment) redirect("/payments");
  if (payment.status !== "SCHEDULED") redirect(`/payments/${paymentId}?error=notscheduled`);

  const now = new Date();
  const reference = makeReference(payment.method);

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "COMPLETED", executedDate: now, reference },
    });

    await tx.invoice.update({
      where: { id: payment.invoiceId },
      data: { status: "PAID", paidAt: now, amountPaidCents: payment.amountCents },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.PAYMENT_EXECUTED,
        entityType: "Payment",
        entityId: paymentId,
        entityLabel: payment.paymentNumber,
        summary: `Paid ${formatCents(payment.amountCents)} against ${payment.invoice.invoiceNumber}`,
        metadata: { reference, method: payment.method },
        ipAddress: await currentIp(),
      },
      tx,
    );

    await tx.notification.create({
      data: {
        userId: payment.invoice.createdById,
        type: "PAYMENT_EXECUTED",
        title: `${payment.invoice.invoiceNumber} was paid`,
        body: `${formatCents(payment.amountCents)} sent · reference ${reference}`,
        linkUrl: `/invoices/${payment.invoiceId}`,
      },
    });
  });

  publish({
    type: "payment.changed",
    paymentId,
    paymentNumber: payment.paymentNumber,
    status: "COMPLETED",
    actorId: user.id,
    summary: `${user.name} paid ${payment.invoice.invoiceNumber}`,
  });
  publish({
    type: "invoice.changed",
    invoiceId: payment.invoiceId,
    invoiceNumber: payment.invoice.invoiceNumber,
    status: "PAID",
    actorId: user.id,
    summary: `${payment.invoice.invoiceNumber} was paid`,
  });

  revalidatePath("/payments");
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath(`/invoices/${payment.invoiceId}`);
  revalidatePath("/dashboard");
  redirect(`/payments/${paymentId}?executed=1`);
}

export async function cancelPayment(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCan(user, "payment:manage");

  const paymentId = String(formData.get("paymentId") ?? "");
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  });
  if (!payment) redirect("/payments");
  if (payment.status !== "SCHEDULED") redirect(`/payments/${paymentId}`);

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "CANCELLED", failureReason: "Cancelled before execution" },
    });

    // The invoice goes back to approved — still owed, just no longer queued.
    await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: "APPROVED" } });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.PAYMENT_CANCELLED,
        entityType: "Payment",
        entityId: paymentId,
        entityLabel: payment.paymentNumber,
        summary: `Cancelled ${formatCents(payment.amountCents)} scheduled against ${payment.invoice.invoiceNumber}`,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  revalidatePath("/payments");
  revalidatePath(`/invoices/${payment.invoiceId}`);
  redirect(`/payments/${paymentId}?cancelled=1`);
}

/**
 * Groups every unbatched scheduled payment due on or before a date into one
 * run. This is how AP teams actually pay: not one invoice at a time, but a
 * weekly batch that one person releases.
 */
export async function createBatch(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCan(user, "payment:manage");

  const through = String(formData.get("through") ?? "");
  const cutoff = through ? new Date(through) : new Date();

  const eligible = await db.payment.findMany({
    where: { status: "SCHEDULED", batchId: null, scheduledDate: { lte: cutoff } },
    select: { id: true, amountCents: true },
  });

  if (eligible.length === 0) redirect("/payments?tab=batches&error=empty");

  const batchNumber = await nextBatchNumber();
  const totalCents = eligible.reduce((sum, payment) => sum + payment.amountCents, 0);

  await db.$transaction(async (tx) => {
    const created = await tx.paymentBatch.create({
      data: {
        batchNumber,
        status: "SCHEDULED",
        totalCents,
        itemCount: eligible.length,
        scheduledDate: cutoff,
        createdById: user.id,
      },
    });

    await tx.payment.updateMany({
      where: { id: { in: eligible.map((payment) => payment.id) } },
      data: { batchId: created.id },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.BATCH_CREATED,
        entityType: "PaymentBatch",
        entityId: created.id,
        entityLabel: batchNumber,
        summary: `Created payment run ${batchNumber} — ${eligible.length} payments, ${formatCents(totalCents)}`,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  revalidatePath("/payments");
  redirect(`/payments?tab=batches&created=${encodeURIComponent(batchNumber)}`);
}

/** Releases every payment in a run, marking each invoice paid. */
export async function executeBatch(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCan(user, "payment:manage");

  const batchId = String(formData.get("batchId") ?? "");
  const batch = await db.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      payments: {
        include: { invoice: { select: { id: true, createdById: true, invoiceNumber: true } } },
      },
    },
  });
  if (!batch) redirect("/payments?tab=batches");
  if (batch.status === "COMPLETED") redirect("/payments?tab=batches");

  const now = new Date();
  const pending = batch.payments.filter((payment) => payment.status === "SCHEDULED");

  await db.$transaction(async (tx) => {
    for (const payment of pending) {
      const reference = makeReference(payment.method);

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "COMPLETED", executedDate: now, reference },
      });
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: "PAID", paidAt: now, amountPaidCents: payment.amountCents },
      });
      await tx.notification.create({
        data: {
          userId: payment.invoice.createdById,
          type: "PAYMENT_EXECUTED",
          title: `${payment.invoice.invoiceNumber} was paid`,
          body: `${formatCents(payment.amountCents)} sent in run ${batch.batchNumber}`,
          linkUrl: `/invoices/${payment.invoiceId}`,
        },
      });
    }

    await tx.paymentBatch.update({
      where: { id: batchId },
      data: { status: "COMPLETED", executedDate: now },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.BATCH_EXECUTED,
        entityType: "PaymentBatch",
        entityId: batchId,
        entityLabel: batch.batchNumber,
        summary: `Released payment run ${batch.batchNumber} — ${pending.length} payments, ${formatCents(batch.totalCents)}`,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  for (const payment of pending) {
    publish({
      type: "invoice.changed",
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoice.invoiceNumber,
      status: "PAID",
      actorId: user.id,
      summary: `${payment.invoice.invoiceNumber} was paid in run ${batch.batchNumber}`,
    });
  }

  revalidatePath("/payments");
  revalidatePath("/dashboard");
  redirect(`/payments?tab=batches&executed=${encodeURIComponent(batch.batchNumber)}`);
}

/** Simulated rail reference. A real integration returns this from the bank. */
function makeReference(method: string): string {
  return `${method}${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
}

