import type { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit/record";
import { can, PermissionError } from "@/lib/auth/permissions";
import { currentIp, getCurrentUser, UnauthenticatedError } from "@/lib/auth/session";
import { checkUpload, storeFile } from "@/lib/storage";

/**
 * Attaches a document to an invoice.
 *
 * Permission is checked against the invoice's own state, not just the role:
 * an approved invoice accepts no further attachments, because the approvals
 * recorded against it were given on the documents that existed at the time.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();

    const formData = await request.formData();
    const invoiceId = String(formData.get("invoiceId") ?? "");
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "No file was included." }, { status: 400 });
    }

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        createdById: true,
        status: true,
        archivedAt: true,
        attachments: { select: { id: true } },
      },
    });
    if (!invoice) return Response.json({ error: "That invoice no longer exists." }, { status: 404 });

    if (
      !can(user, "attachment:upload", {
        kind: "invoice",
        createdById: invoice.createdById,
        status: invoice.status,
        archivedAt: invoice.archivedAt,
      })
    ) {
      throw new PermissionError("attachment:upload");
    }

    const check = checkUpload(file);
    if (!check.ok) return Response.json({ error: check.problem }, { status: 400 });

    const { storedName, sizeBytes } = await storeFile(file);

    const attachment = await db.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          invoiceId,
          filename: file.name.slice(0, 200),
          storedName,
          mimeType: file.type,
          sizeBytes,
          uploadedById: user.id,
          // The first document attached is the source invoice.
          isPrimary: invoice.attachments.length === 0,
        },
      });

      await recordAudit(
        {
          actor: { id: user.id, name: user.name, role: user.role },
          action: AUDIT_ACTIONS.ATTACHMENT_UPLOADED,
          entityType: "Invoice",
          entityId: invoiceId,
          entityLabel: invoice.invoiceNumber,
          summary: `Attached ${file.name} to ${invoice.invoiceNumber}`,
          metadata: { filename: file.name, sizeBytes },
          ipAddress: await currentIp(),
        },
        tx,
      );

      return created;
    });

    return Response.json({
      id: attachment.id,
      filename: attachment.filename,
      storedName: attachment.storedName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      url: `/api/files/${attachment.storedName}`,
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json({ error: "Sign in to upload." }, { status: 401 });
    }
    if (error instanceof PermissionError) {
      return Response.json(
        { error: "This invoice can no longer accept attachments." },
        { status: 403 },
      );
    }
    throw error;
  }
}
