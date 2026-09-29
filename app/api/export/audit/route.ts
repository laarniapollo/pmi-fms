import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, type AuditAction } from "@/lib/constants";
import { recordAudit } from "@/lib/audit/record";
import { PermissionError } from "@/lib/auth/permissions";
import { currentIp, requireActionOrThrow, UnauthenticatedError } from "@/lib/auth/session";
import { csvResponse, timestampedName, toCsv } from "@/lib/export/csv";

/**
 * Exports the filtered audit trail.
 *
 * The export is itself an audited event — "who took the audit log out of the
 * system" is precisely the sort of question the log exists to answer.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireActionOrThrow("audit:view");
    const params = request.nextUrl.searchParams;

    const where: Prisma.AuditLogWhereInput = {};
    if (params.get("actor")) where.actorId = params.get("actor")!;
    if (params.get("action")) where.action = params.get("action")!;
    if (params.get("entity")) where.entityType = params.get("entity")!;

    const query = params.get("q")?.trim();
    if (query) {
      where.OR = [
        { summary: { contains: query } },
        { entityLabel: { contains: query } },
        { actorName: { contains: query } },
      ];
    }

    const from = params.get("from");
    const to = params.get("to");
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }

    const rows = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" } });

    const csv = toCsv(rows, [
      { header: "Timestamp (UTC)", value: (row) => row.createdAt.toISOString() },
      { header: "Person", value: (row) => row.actorName },
      { header: "Role", value: (row) => row.actorRole },
      {
        header: "Action",
        value: (row) => AUDIT_ACTION_LABEL[row.action as AuditAction] ?? row.action,
      },
      { header: "Action code", value: (row) => row.action },
      { header: "Record type", value: (row) => row.entityType },
      { header: "Record", value: (row) => row.entityLabel },
      { header: "Record ID", value: (row) => row.entityId },
      { header: "Summary", value: (row) => row.summary },
      { header: "Changes", value: (row) => row.metadata ?? "" },
      { header: "IP address", value: (row) => row.ipAddress ?? "" },
    ]);

    await recordAudit({
      actor: { id: user.id, name: user.name, role: user.role },
      action: AUDIT_ACTIONS.DATA_EXPORTED,
      entityType: "Settings",
      entityId: "audit-export",
      entityLabel: `${rows.length} audit entries`,
      summary: `Exported ${rows.length} audit entries to CSV`,
      metadata: { filters: Object.fromEntries(params.entries()) },
      ipAddress: await currentIp(),
    });

    return csvResponse(csv, timestampedName("poultrymax-audit-log"));
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return new Response("Sign in to export data.", { status: 401 });
    }
    if (error instanceof PermissionError) {
      return new Response("Your role cannot view the audit log.", { status: 403 });
    }
    throw error;
  }
}
