import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CheckSquare, Clock, Info } from "lucide-react";

import { db } from "@/lib/db";
import { OWNER_SIGNOFF_THRESHOLD_CENTS } from "@/lib/constants";
import { requireAction } from "@/lib/auth/session";
import { formatCents, formatCentsCompact, formatDate, formatRelative, describeDueDate } from "@/lib/format";
import { ApprovalRailCompact, buildRail } from "@/components/approval-rail";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/tabs";
import { StatTile } from "@/components/ui/stat-tile";
import { DecisionPanel } from "./decision-panel";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("invoice:approve");
  const flags = await searchParams;

  // Only what this person can actually decide. Excluding their own entries
  // here means the separation-of-duties rule shows up as an absent row rather
  // than a button that errors when pressed.
  const queue = await db.invoice.findMany({
    where: {
      status: "PENDING_APPROVAL",
      archivedAt: null,
      createdById: { not: user.id },
      approvalSteps: { some: { status: "PENDING" } },
      // Nobody signs the same invoice twice across a two-step chain.
      NOT: { approvalSteps: { some: { approverId: user.id, status: { not: "PENDING" } } } },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      createdBy: { select: { name: true, avatarColor: true } },
      approvalSteps: {
        orderBy: { sequence: "asc" },
        include: { approver: { select: { name: true } } },
      },
    },
    orderBy: [{ dueDate: "asc" }],
  });

  // What is waiting on somebody else, so the page explains its own gaps.
  const [blockedByOwnEntry, awaitingOthers, totalPending] = await Promise.all([
    db.invoice.count({
      where: { status: "PENDING_APPROVAL", archivedAt: null, createdById: user.id },
    }),
    db.invoice.count({
      where: {
        status: "PENDING_APPROVAL",
        archivedAt: null,
        createdById: { not: user.id },
        approvalSteps: { some: { approverId: user.id, status: { not: "PENDING" } } },
      },
    }),
    db.invoice.count({ where: { status: "PENDING_APPROVAL", archivedAt: null } }),
  ]);

  const queueValue = queue.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const overdueCount = queue.filter((invoice) => invoice.dueDate < new Date()).length;

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          queue.length === 0
            ? "Nothing is waiting on your decision."
            : `${queue.length} ${queue.length === 1 ? "invoice needs" : "invoices need"} your decision.`
        }
      />

      {flags.decided ? (
        <div
          role="status"
          className="mb-3 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-sm text-accent">
            {flags.decided === "approve" ? "Approved" : "Rejected"} {flags.invoice}. Whoever entered
            it has been notified.
          </p>
        </div>
      ) : null}

      <section aria-label="Queue summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Awaiting you" value={queue.length} detail="Invoices you can decide" />
        <StatTile label="Value in queue" value={formatCentsCompact(queueValue)} detail="Across your queue" />
        <StatTile
          label="Past due"
          value={overdueCount}
          tone={overdueCount > 0 ? "danger" : "default"}
          detail={overdueCount > 0 ? "Decide these first" : "None overdue"}
        />
        <StatTile
          label="Pending workspace-wide"
          value={totalPending}
          detail="Including other approvers' queues"
          href="/invoices?status=PENDING_APPROVAL"
        />
      </section>

      <Card className="mt-3">
        <CardHeader
          title="Your queue"
          description="Soonest due first"
          action={
            <Link
              href="/invoices?status=PENDING_APPROVAL"
              className="text-xs font-medium text-accent hover:underline"
            >
              See all pending
            </Link>
          }
        />

        {queue.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="Your queue is clear"
            description={
              blockedByOwnEntry > 0 || awaitingOthers > 0
                ? "Everything else pending is either yours to enter, not yours to approve, or already signed by you."
                : "New invoices appear here as soon as they are submitted for approval."
            }
            action={
              <ButtonLink href="/invoices" variant="secondary" size="md">
                Browse all invoices
              </ButtonLink>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {queue.map((invoice) => {
              const steps = invoice.approvalSteps;
              const pending = steps.find((step) => step.status === "PENDING");
              const due = describeDueDate(invoice.dueDate);

              return (
                <li key={invoice.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="ident text-ink hover:text-accent hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                        <ApprovalRailCompact steps={buildRail(invoice)} />
                        {invoice.ocrConfidence !== null ? (
                          <Badge tone="neutral">Scanned</Badge>
                        ) : null}
                        {invoice.poNumber ? (
                          <span className="text-2xs text-ink-subtle">PO {invoice.poNumber}</span>
                        ) : null}
                      </div>

                      <p className="mt-1 truncate text-sm text-ink">{invoice.vendor.name}</p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-subtle">
                        <span className="flex items-center gap-1">
                          <Avatar
                            name={invoice.createdBy.name}
                            color={invoice.createdBy.avatarColor}
                            size="xs"
                          />
                          Entered by {invoice.createdBy.name}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          Submitted {invoice.submittedAt ? formatRelative(invoice.submittedAt) : "—"}
                        </span>
                        <span className={due.tone === "danger" ? "text-danger" : due.tone === "warn" ? "text-warn" : ""}>
                          Due {formatDate(invoice.dueDate)} · {due.label}
                        </span>
                      </div>

                      {steps.length > 1 ? (
                        <p className="mt-1.5 text-2xs text-ink-muted">
                          {steps
                            .filter((step) => step.status === "APPROVED")
                            .map((step) => `Approved by ${step.approver?.name ?? "—"}`)
                            .join(" · ") || "No approvals recorded yet"}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="text-lg font-semibold tabular-nums text-ink">
                        {formatCents(invoice.totalCents)}
                      </p>
                      {invoice.totalCents >= OWNER_SIGNOFF_THRESHOLD_CENTS ? (
                        <Badge tone="warn">Owner authorisation</Badge>
                      ) : null}
                      <DecisionPanel
                        invoiceId={invoice.id}
                        invoiceNumber={invoice.invoiceNumber}
                        vendorName={invoice.vendor.name}
                        amount={formatCents(invoice.totalCents)}
                        totalCents={invoice.totalCents}
                        stepLabel={
                          steps.length > 1
                            ? `Approval ${pending?.sequence ?? 1} of ${steps.length}`
                            : "Single approval"
                        }
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {blockedByOwnEntry > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-flat">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <p className="text-sm text-ink-muted">
            {blockedByOwnEntry} pending {blockedByOwnEntry === 1 ? "invoice was" : "invoices were"}{" "}
            entered by you, so {blockedByOwnEntry === 1 ? "it is" : "they are"} not in your queue —
            somebody else has to approve {blockedByOwnEntry === 1 ? "it" : "them"}.
          </p>
        </div>
      ) : null}
    </>
  );
}
