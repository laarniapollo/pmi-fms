import type { Metadata } from "next";
import Link from "next/link";
import { FileDown, ScrollText } from "lucide-react";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { buildQuery } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/lib/format";
import { AUDIT_ACTION_LABEL, type AuditAction } from "@/lib/constants";
import { parseAuditMetadata } from "@/lib/audit/record";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, readListParams } from "@/components/ui/pagination";
import { PageHeader } from "@/components/ui/tabs";
import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("audit:view");
  const params = await searchParams;

  const { page, pageSize, skip, take } = readListParams(params, {
    defaultSort: "createdAt",
    allowedSorts: ["createdAt"],
  });

  const where: Prisma.AuditLogWhereInput = {};
  if (params.actor) where.actorId = params.actor;
  if (params.action) where.action = params.action;
  if (params.entity) where.entityType = params.entity;
  if (params.q?.trim()) {
    where.OR = [
      { summary: { contains: params.q.trim() } },
      { entityLabel: { contains: params.q.trim() } },
      { actorName: { contains: params.q.trim() } },
    ];
  }
  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      // Through the end of the chosen day, not its first instant.
      ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999Z`) } : {}),
    };
  }

  const [entries, total, actors, actions] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    db.auditLog.count({ where }),
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.auditLog.groupBy({ by: ["action"], _count: true, orderBy: { action: "asc" } }),
  ]);

  const filtered = Boolean(
    params.q || params.actor || params.action || params.entity || params.from || params.to,
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`${total.toLocaleString()} recorded ${total === 1 ? "event" : "events"}. Append-only — nothing here can be edited or deleted.`}
        actions={
          can(user, "export:run") ? (
            <ButtonLink
              href={`/api/export/audit${buildQuery(params, { page: undefined, size: undefined })}`}
              variant="secondary"
              size="md"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </ButtonLink>
          ) : null
        }
      />

      <Card>
        <AuditFilters
          searchParams={params}
          actors={actors}
          actions={actions.map((row) => ({ value: row.action, count: row._count }))}
        />

        {entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtered ? "No events match these filters" : "Nothing recorded yet"}
            description={
              filtered
                ? "Try a wider date range, or clear the filters."
                : "Every change to an invoice, payment, or setting is recorded here as it happens."
            }
            action={
              filtered ? (
                <ButtonLink href="/audit" variant="secondary" size="md">
                  Clear filters
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <ol className="divide-y divide-line">
            {entries.map((entry) => {
              const diff = parseAuditMetadata(entry.metadata);
              const label = AUDIT_ACTION_LABEL[entry.action as AuditAction] ?? entry.action;

              return (
                <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Avatar name={entry.actorName} size="sm" className="mt-0.5" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm text-ink">{entry.summary}</span>
                      <Badge tone="neutral">{label}</Badge>
                    </div>

                    <p className="mt-0.5 text-2xs text-ink-subtle">
                      {entry.actorName}
                      <span className="mx-1">·</span>
                      {entry.actorRole.toLowerCase()}
                      <span className="mx-1">·</span>
                      <time dateTime={entry.createdAt.toISOString()} title={formatDateTime(entry.createdAt)}>
                        {formatRelative(entry.createdAt)}
                      </time>
                      {entry.ipAddress ? (
                        <>
                          <span className="mx-1">·</span>
                          <span className="ident">{entry.ipAddress}</span>
                        </>
                      ) : null}
                    </p>

                    {diff ? <DiffList diff={diff} /> : null}
                  </div>

                  <div className="shrink-0 text-right">
                    {entry.entityType === "Invoice" ? (
                      <Link
                        href={`/invoices/${entry.entityId}`}
                        className="ident text-ink-muted hover:text-accent hover:underline"
                      >
                        {entry.entityLabel}
                      </Link>
                    ) : entry.entityType === "Payment" ? (
                      <Link
                        href={`/payments/${entry.entityId}`}
                        className="ident text-ink-muted hover:text-accent hover:underline"
                      >
                        {entry.entityLabel}
                      </Link>
                    ) : (
                      <span className="ident text-ink-subtle">{entry.entityLabel}</span>
                    )}
                    <p className="text-2xs text-ink-subtle">{entry.entityType}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {entries.length > 0 ? (
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={params} />
        ) : null}
      </Card>
    </>
  );
}

/** Renders a `{field: {from, to}}` diff, or a plain metadata blob. */
function DiffList({ diff }: { diff: Record<string, unknown> }) {
  const entries = Object.entries(diff);
  if (entries.length === 0) return null;

  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
      {entries.map(([field, value]) => {
        const change =
          value && typeof value === "object" && "from" in value && "to" in value
            ? (value as { from: unknown; to: unknown })
            : null;

        return (
          <div key={field} className="flex items-baseline gap-1 text-2xs">
            <dt className="text-ink-subtle">{humanise(field)}</dt>
            <dd className="text-ink-muted">
              {change ? (
                <>
                  <span className="line-through opacity-60">{render(change.from)}</span>
                  <span className="mx-1">→</span>
                  <span className="text-ink">{render(change.to)}</span>
                </>
              ) : (
                <span className="text-ink">{render(value)}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }
  return String(value);
}

function humanise(field: string): string {
  const spaced = field.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
  return spaced.replace(/\bCents\b/, "").trim();
}
