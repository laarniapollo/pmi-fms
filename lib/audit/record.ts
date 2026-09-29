import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { AuditAction } from "@/lib/constants";

/**
 * The audit trail is append-only and is written inside the same transaction as
 * the change it describes. If the mutation rolls back, so does its audit row —
 * a trail that can disagree with the ledger is worse than none.
 *
 * Pass the transaction client as `client` whenever one is open.
 */

type Client = Prisma.TransactionClient | typeof db;

export interface AuditActor {
  id: string;
  name: string;
  role: string;
}

export interface AuditEntry {
  actor: AuditActor | null;
  action: AuditAction;
  entityType: "Invoice" | "Vendor" | "Payment" | "PaymentBatch" | "User" | "Settings" | "Session";
  entityId: string;
  /** Human-readable handle, e.g. `"INV-2026-0184"`. Shown in the log. */
  entityLabel: string;
  /** One sentence, past tense, plain: "Approved invoice INV-2026-0184". */
  summary: string;
  /** Field-level diff, `{ field: { from, to } }`. Stored as JSON text. */
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function recordAudit(entry: AuditEntry, client: Client = db): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.name ?? "System",
      actorRole: entry.actor?.role ?? "SYSTEM",
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel,
      summary: entry.summary,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/**
 * Builds a `{ field: { from, to } }` diff, keeping only fields that actually
 * changed. Returns null when nothing did, so callers can skip the audit write
 * rather than record a no-op edit.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: Array<keyof T>,
): Record<string, { from: unknown; to: unknown }> | null {
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field];
    const to = after[field];
    if (normalise(from) === normalise(to)) continue;
    diff[String(field)] = { from: from ?? null, to: to ?? null };
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function normalise(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Parses the stored metadata column back into a diff for display. */
export function parseAuditMetadata(
  metadata: string | null,
): Record<string, { from: unknown; to: unknown }> | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, { from: unknown; to: unknown }>;
    }
    return null;
  } catch {
    return null;
  }
}
