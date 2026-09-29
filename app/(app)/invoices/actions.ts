"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS, VAT_TYPES } from "@/lib/constants";
import { formatCents } from "@/lib/format";
import { diffFields, recordAudit } from "@/lib/audit/record";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { currentIp, requireUser } from "@/lib/auth/session";
import { planApprovals } from "@/lib/approvals/route-invoice";
import { findDuplicate } from "@/lib/queries/invoices";
import { checkUpload, deleteStoredFile, storeFile } from "@/lib/storage";
import { computeVatBreakdown, normaliseTin, validateVat } from "@/lib/tax/vat";

export interface InvoiceFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Set when the vendor already has an invoice with this number. */
  duplicateId?: string;
}

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Every line needs a description"),
  quantity: z.number().positive("Quantity must be greater than zero"),
  unitPriceCents: z.number().int(),
  glAccount: z.string().trim().optional().nullable(),
});

const invoiceSchema = z
  .object({
    vendorId: z.string().min(1, "Choose a vendor"),
    invoiceNumber: z.string().trim().min(1, "Enter the invoice number"),
    issueDate: z.string().min(1, "Enter the issue date"),
    dueDate: z.string().min(1, "Enter the due date"),
    poNumber: z.string().trim().optional(),
    description: z.string().trim().optional(),
    glAccount: z.string().trim().optional(),
    costCenter: z.string().trim().optional(),
    taxCents: z.number().int().min(0),
    vatType: z.enum(VAT_TYPES, { message: "Choose the VAT type" }),
    vatableSalesCents: z.number().int().nullable(),
    zeroRatedSalesCents: z.number().int().nullable(),
    exemptSalesCents: z.number().int().nullable(),
    supplierTin: z.string().trim().optional(),
    vatExemptionBasis: z.string().trim().optional(),
    lineItems: z.array(lineItemSchema).min(1, "Add at least one line item"),
  })
  .refine((data) => new Date(data.dueDate) >= new Date(data.issueDate), {
    path: ["dueDate"],
    message: "The due date cannot fall before the issue date",
  })
  .superRefine((data, ctx) => {
    const errors = validateVat({ ...vatInputOf(data, subtotalOf(data.lineItems)), supplierTin: data.supplierTin });
    for (const [path, message] of Object.entries(errors)) {
      ctx.addIssue({ code: "custom", path: [path], message });
    }
  });

type InvoiceInput = z.infer<typeof invoiceSchema>;

function lineAmount(line: { quantity: number; unitPriceCents: number }) {
  return Math.round(line.quantity * line.unitPriceCents);
}

function subtotalOf(lines: Array<{ quantity: number; unitPriceCents: number }>) {
  return lines.reduce((sum, line) => sum + lineAmount(line), 0);
}

function vatInputOf(input: Pick<InvoiceInput, "vatType" | "vatableSalesCents" | "zeroRatedSalesCents" | "exemptSalesCents" | "taxCents">, subtotalCents: number) {
  return {
    vatType: input.vatType,
    subtotalCents,
    vatableCents: input.vatableSalesCents,
    zeroRatedCents: input.zeroRatedSalesCents,
    exemptCents: input.exemptSalesCents,
    taxCents: input.taxCents,
  };
}

/** A hidden cents field: blank is "not given", which is not the same as zero. */
function optionalCents(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseForm(formData: FormData) {
  let lineItems: unknown = [];
  try {
    lineItems = JSON.parse(String(formData.get("lineItems") ?? "[]"));
  } catch {
    lineItems = [];
  }

  return invoiceSchema.safeParse({
    vendorId: formData.get("vendorId"),
    invoiceNumber: formData.get("invoiceNumber"),
    issueDate: formData.get("issueDate"),
    dueDate: formData.get("dueDate"),
    poNumber: formData.get("poNumber") || undefined,
    description: formData.get("description") || undefined,
    glAccount: formData.get("glAccount") || undefined,
    costCenter: formData.get("costCenter") || undefined,
    taxCents: Number(formData.get("taxCents") ?? 0),
    vatType: formData.get("vatType"),
    vatableSalesCents: optionalCents(formData.get("vatableSalesCents")),
    zeroRatedSalesCents: optionalCents(formData.get("zeroRatedSalesCents")),
    exemptSalesCents: optionalCents(formData.get("exemptSalesCents")),
    supplierTin: formData.get("supplierTin") || undefined,
    vatExemptionBasis: formData.get("vatExemptionBasis") || undefined,
    lineItems,
  });
}

/**
 * Totals are always recomputed here from the line items. The form shows a
 * running total for the person typing, but that figure never reaches the
 * database — a client that can set its own total can set it to anything.
 */
function computeTotals(input: InvoiceInput) {
  const lines = input.lineItems.map((line, index) => ({
    description: line.description,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    amountCents: lineAmount(line),
    glAccount: line.glAccount || null,
    sortOrder: index,
  }));

  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  // VAT is recomputed from the type, like the subtotal from the lines: a post
  // that claims VAT on an exempt sale gets zero, not what it claimed.
  const vat = computeVatBreakdown(vatInputOf(input, subtotalCents));

  return {
    lines,
    subtotalCents,
    totalCents: subtotalCents + vat.taxCents,
    vat: {
      vatType: input.vatType,
      taxCents: vat.taxCents,
      vatableSalesCents: vat.vatableSalesCents,
      zeroRatedSalesCents: vat.zeroRatedSalesCents,
      exemptSalesCents: vat.exemptSalesCents,
      supplierTin: normaliseTin(input.supplierTin) ?? null,
      vatExemptionBasis: input.vatType === "EXEMPT" ? input.vatExemptionBasis || null : null,
    },
  };
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!result[field]) result[field] = issue.message;
  }
  return result;
}

// ---------------------------------------------------------------------------

export async function createInvoice(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireUser();
  try {
    assertCan(user, "invoice:create");
  } catch (error) {
    if (error instanceof PermissionError) return { error: "Your role cannot create invoices." };
    throw error;
  }

  const parsed = parseForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const input = parsed.data;

  const duplicate = await findDuplicate(input.vendorId, input.invoiceNumber);
  if (duplicate) {
    return {
      error: `This vendor already has an invoice numbered ${duplicate.invoiceNumber}.`,
      duplicateId: duplicate.id,
      fieldErrors: { invoiceNumber: "Already used for this vendor" },
    };
  }

  const { lines, subtotalCents, totalCents, vat } = computeTotals(input);
  const ocrConfidence = Number(formData.get("ocrConfidence"));

  const invoice = await db.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        invoiceNumber: input.invoiceNumber,
        vendorId: input.vendorId,
        status: "DRAFT",
        issueDate: new Date(input.issueDate),
        dueDate: new Date(input.dueDate),
        subtotalCents,
        ...vat,
        totalCents,
        poNumber: input.poNumber || null,
        description: input.description || null,
        glAccount: input.glAccount || null,
        costCenter: input.costCenter || null,
        createdById: user.id,
        ocrConfidence: Number.isFinite(ocrConfidence) && ocrConfidence > 0 ? ocrConfidence : null,
        ocrRawText: (formData.get("ocrRawText") as string) || null,
        lineItems: { create: lines },
      },
      include: { vendor: { select: { name: true } } },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: ocrConfidence > 0 ? AUDIT_ACTIONS.INVOICE_OCR_PROCESSED : AUDIT_ACTIONS.INVOICE_CREATED,
        entityType: "Invoice",
        entityId: created.id,
        entityLabel: created.invoiceNumber,
        summary:
          ocrConfidence > 0
            ? `Created invoice ${created.invoiceNumber} for ${created.vendor.name} from a scan`
            : `Created invoice ${created.invoiceNumber} for ${created.vendor.name}`,
        metadata: {
          total: totalCents / 100,
          lines: lines.length,
          ...(ocrConfidence > 0 ? { ocrConfidence } : {}),
        },
        ipAddress: await currentIp(),
      },
      tx,
    );

    return created;
  });

  // The document that was scanned is attached to the invoice it produced, so
  // an approver can check the figures against the source without the clerk
  // uploading the same file twice.
  const scanned = formData.get("scanFile");
  if (scanned instanceof File && scanned.size > 0) {
    const check = checkUpload(scanned);
    if (check.ok) {
      const { storedName, sizeBytes } = await storeFile(scanned);
      await db.attachment.create({
        data: {
          invoiceId: invoice.id,
          filename: scanned.name.slice(0, 200),
          storedName,
          mimeType: scanned.type,
          sizeBytes,
          uploadedById: user.id,
          isPrimary: true,
        },
      });
    }
  }

  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  redirect(`/invoices/${invoice.id}?created=1`);
}

export async function updateInvoice(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");

  const existing = await db.invoice.findUnique({
    where: { id },
    include: { vendor: { select: { name: true } } },
  });
  if (!existing) return { error: "That invoice no longer exists." };

  try {
    assertCan(user, "invoice:edit", {
      kind: "invoice",
      createdById: existing.createdById,
      status: existing.status,
      archivedAt: existing.archivedAt,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return { error: "This invoice can no longer be edited." };
    }
    throw error;
  }

  const parsed = parseForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const input = parsed.data;

  const duplicate = await findDuplicate(input.vendorId, input.invoiceNumber, id);
  if (duplicate) {
    return {
      error: `This vendor already has an invoice numbered ${duplicate.invoiceNumber}.`,
      duplicateId: duplicate.id,
      fieldErrors: { invoiceNumber: "Already used for this vendor" },
    };
  }

  const { lines, subtotalCents, totalCents, vat } = computeTotals(input);

  await db.$transaction(async (tx) => {
    // Line items are replaced wholesale: reconciling an edited list row by row
    // would need stable client-side ids for something nobody references.
    await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });

    await tx.invoice.update({
      where: { id },
      data: {
        invoiceNumber: input.invoiceNumber,
        vendorId: input.vendorId,
        issueDate: new Date(input.issueDate),
        dueDate: new Date(input.dueDate),
        subtotalCents,
        ...vat,
        totalCents,
        poNumber: input.poNumber || null,
        description: input.description || null,
        glAccount: input.glAccount || null,
        costCenter: input.costCenter || null,
        lineItems: { create: lines },
      },
    });

    const changes = diffFields(
      existing as unknown as Record<string, unknown>,
      {
        invoiceNumber: input.invoiceNumber,
        vendorId: input.vendorId,
        totalCents,
        dueDate: new Date(input.dueDate),
        poNumber: input.poNumber || null,
        ...vat,
      },
      [
        "invoiceNumber",
        "vendorId",
        "totalCents",
        "dueDate",
        "poNumber",
        "vatType",
        "taxCents",
        "vatableSalesCents",
        "zeroRatedSalesCents",
        "exemptSalesCents",
        "supplierTin",
      ],
    );

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.INVOICE_UPDATED,
        entityType: "Invoice",
        entityId: id,
        entityLabel: input.invoiceNumber,
        summary: `Updated invoice ${input.invoiceNumber}`,
        metadata: changes,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  redirect(`/invoices/${id}?updated=1`);
}

export async function deleteAttachment(formData: FormData): Promise<void> {
  const user = await requireUser();
  const attachmentId = String(formData.get("attachmentId") ?? "");

  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      invoice: {
        select: { id: true, invoiceNumber: true, createdById: true, status: true, archivedAt: true },
      },
    },
  });
  if (!attachment) redirect("/invoices");

  assertCan(user, "attachment:upload", {
    kind: "invoice",
    createdById: attachment.invoice.createdById,
    status: attachment.invoice.status,
    archivedAt: attachment.invoice.archivedAt,
  });

  await db.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachmentId } });

    // If the source document was removed, promote whatever remains so the
    // invoice does not end up with attachments but no designated source.
    const remaining = await tx.attachment.findFirst({
      where: { invoiceId: attachment.invoiceId },
      orderBy: { createdAt: "asc" },
    });
    if (attachment.isPrimary && remaining) {
      await tx.attachment.update({ where: { id: remaining.id }, data: { isPrimary: true } });
    }

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.ATTACHMENT_DELETED,
        entityType: "Invoice",
        entityId: attachment.invoiceId,
        entityLabel: attachment.invoice.invoiceNumber,
        summary: `Removed ${attachment.filename} from ${attachment.invoice.invoiceNumber}`,
        ipAddress: await currentIp(),
      },
      tx,
    );
  });

  // The row is gone before the file, so a failed unlink leaves an orphaned
  // file rather than a record pointing at nothing.
  await deleteStoredFile(attachment.storedName);

  revalidatePath(`/invoices/${attachment.invoiceId}`);
  redirect(`/invoices/${attachment.invoiceId}`);
}

/**
 * Submits an invoice into the approval chain its amount calls for.
 *
 * The routing rules are read fresh here rather than cached on the invoice, so
 * a threshold an Admin changed this morning governs what is submitted this
 * afternoon.
 */
export async function submitInvoice(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { vendor: { select: { name: true } }, attachments: { select: { id: true } } },
  });
  if (!invoice) redirect("/invoices");

  assertCan(user, "invoice:submit", {
    kind: "invoice",
    createdById: invoice.createdById,
    status: invoice.status,
    archivedAt: invoice.archivedAt,
  });

  const settings = await db.orgSettings.findUnique({ where: { id: "singleton" } });
  if (settings?.requireAttachmentOnSubmit && invoice.attachments.length === 0) {
    redirect(`/invoices/${id}?error=attachment`);
  }

  const tiers = await db.approvalThreshold.findMany({ orderBy: { sortOrder: "asc" } });
  const plan = planApprovals(invoice.totalCents, tiers);
  const now = new Date();

  await db.$transaction(async (tx) => {
    // A resubmitted invoice starts a clean chain; the previous rejection stays
    // in the audit trail, which is where the history belongs.
    await tx.approvalStep.deleteMany({ where: { invoiceId: id } });

    if (plan.steps.length > 0) {
      await tx.approvalStep.createMany({
        data: plan.steps.map((step) => ({
          invoiceId: id,
          sequence: step.sequence,
          requiredRole: step.requiredRole,
          status: "PENDING",
        })),
      });
    }

    await tx.invoice.update({
      where: { id },
      data: {
        status: plan.autoApprove ? "APPROVED" : "PENDING_APPROVAL",
        submittedAt: now,
        approvedAt: plan.autoApprove ? now : null,
        rejectedAt: null,
        rejectionReason: null,
        requiredApprovals: plan.steps.length,
      },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.INVOICE_SUBMITTED,
        entityType: "Invoice",
        entityId: id,
        entityLabel: invoice.invoiceNumber,
        summary: plan.autoApprove
          ? `Submitted ${invoice.invoiceNumber} — auto-approved below the ${plan.tier?.label ?? "threshold"} tier`
          : `Submitted ${invoice.invoiceNumber} for ${plan.steps.length} approval${plan.steps.length === 1 ? "" : "s"}`,
        metadata: { tier: plan.tier?.label, approvals: plan.steps.length },
        ipAddress: await currentIp(),
      },
      tx,
    );

    if (!plan.autoApprove) {
      // Everyone who could sign this off, except whoever entered it.
      const approvers = await tx.user.findMany({
        where: { role: { in: ["APPROVER", "ADMIN"] }, isActive: true, id: { not: user.id } },
        select: { id: true },
      });

      if (approvers.length > 0) {
        await tx.notification.createMany({
          data: approvers.map((approver) => ({
            userId: approver.id,
            type: "APPROVAL_REQUESTED",
            title: `${invoice.invoiceNumber} needs your approval`,
            body: `${invoice.vendor.name} · ${formatCents(invoice.totalCents)}`,
            linkUrl: `/invoices/${id}`,
          })),
        });
      }
    }
  });

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  redirect(`/invoices/${id}?submitted=1`);
}
