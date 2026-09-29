import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckSquare,
  FileText,
  Info,
  Wallet,
} from "lucide-react";

import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatCents, formatCentsCompact, formatDate, formatRelative, describeDueDate } from "@/lib/format";
import { AUDIT_ACTION_LABEL, type AuditAction } from "@/lib/constants";
import {
  getApprovalQueue,
  getDashboardData,
  getRecentActivity,
  getUpcoming,
} from "@/lib/queries/dashboard";
import { AgingBars } from "@/components/charts/aging-bars";
import { SpendColumns } from "@/components/charts/spend-columns";
import { ApprovalRailCompact, buildRail } from "@/components/approval-rail";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/tabs";
import { StatTile } from "@/components/ui/stat-tile";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser();
  const { denied } = await searchParams;

  const [data, queue, activity, upcoming] = await Promise.all([
    getDashboardData(),
    can(user, "invoice:approve") ? getApprovalQueue(user.id) : Promise.resolve([]),
    can(user, "audit:view") ? getRecentActivity() : Promise.resolve([]),
    getUpcoming(),
  ]);

  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Good ${partOfDay()}, ${firstName}`}
        description={`${data.outstandingCount} open invoices across ${data.vendorCount} active vendors.`}
        actions={
          can(user, "invoice:create") ? (
            <ButtonLink href="/invoices/new" variant="primary" size="md">
              New invoice
            </ButtonLink>
          ) : can(user, "invoice:approve") ? (
            <ButtonLink href="/approvals" variant="primary" size="md">
              Review approvals
            </ButtonLink>
          ) : null
        }
      />

      {denied ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-flat"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <p className="text-sm text-ink-muted">
            That page is not available to your role. Ask an administrator if you need access.
          </p>
        </div>
      ) : null}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Outstanding"
          value={formatCentsCompact(data.outstandingCents)}
          detail={`${data.outstandingCount} invoices awaiting payment`}
          href="/invoices?status=PENDING_APPROVAL"
          icon={<Wallet className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatTile
          label="Overdue"
          value={formatCentsCompact(data.overdueCents)}
          tone={data.overdueCount > 0 ? "danger" : "default"}
          detail={
            data.overdueCount > 0
              ? `${data.overdueCount} past their due date`
              : "Nothing past due"
          }
          href="/invoices?due=overdue"
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatTile
          label="Awaiting approval"
          value={formatCentsCompact(data.awaitingCents)}
          tone={data.awaitingCount > 0 ? "warn" : "default"}
          detail={`${data.awaitingCount} in the queue`}
          href={can(user, "invoice:approve") ? "/approvals" : "/invoices?status=PENDING_APPROVAL"}
          icon={<CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <StatTile
          label="Paid this month"
          value={formatCentsCompact(data.paidThisMonthCents)}
          tone="accent"
          detail={`${data.paidThisMonthCount} invoices settled`}
          href="/payments"
          icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader
            title="Ageing"
            description="Open invoices by how far past due they are"
          />
          <AgingBars data={data.aging} />
        </Card>

        <Card className="xl:col-span-7">
          <CardHeader
            title="Settled by month"
            description="Invoices marked paid, last six months"
            action={
              <span className="text-2xs text-ink-subtle">
                {formatCentsCompact(data.spend.reduce((sum, month) => sum + month.cents, 0))} total
              </span>
            }
          />
          <SpendColumns data={data.spend} />
        </Card>
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-12">
        {can(user, "invoice:approve") ? (
          <Card className="xl:col-span-7">
            <CardHeader
              title="Your approval queue"
              description="Invoices you can decide on, soonest due first"
              action={
                <Link href="/approvals" className="text-xs font-medium text-accent hover:underline">
                  View all
                </Link>
              }
            />
            {queue.length === 0 ? (
              <EmptyState
                compact
                icon={CheckSquare}
                title="Nothing waiting on you"
                description="Invoices you entered yourself never appear here — someone else approves those."
              />
            ) : (
              <ul>
                {queue.map((invoice) => {
                  const due = describeDueDate(invoice.dueDate);
                  return (
                    <li key={invoice.id} className="border-t border-line first:border-t-0">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="ident text-ink">{invoice.invoiceNumber}</span>
                            <ApprovalRailCompact steps={buildRail(invoice)} />
                          </div>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {invoice.vendor.name}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium tabular-nums text-ink">
                            {formatCents(invoice.totalCents)}
                          </p>
                          <p
                            className={
                              due.tone === "danger"
                                ? "text-2xs text-danger"
                                : due.tone === "warn"
                                  ? "text-2xs text-warn"
                                  : "text-2xs text-ink-subtle"
                            }
                          >
                            {due.label}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : (
          <Card className="xl:col-span-7">
            <CardHeader title="Falling due soon" description="Approved invoices due in the next two weeks" />
            {upcoming.length === 0 ? (
              <EmptyState
                compact
                icon={CalendarClock}
                title="Nothing due in the next two weeks"
                description="Approved invoices appear here as their due dates approach."
              />
            ) : (
              <ul>
                {upcoming.map((invoice) => (
                  <li key={invoice.id} className="border-t border-line first:border-t-0">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <div className="min-w-0">
                        <span className="ident text-ink">{invoice.invoiceNumber}</span>
                        <p className="truncate text-xs text-ink-muted">{invoice.vendor.name}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular-nums text-ink">
                          {formatCents(invoice.totalCents)}
                        </p>
                        <p className="text-2xs text-ink-subtle">{formatDate(invoice.dueDate)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card className="xl:col-span-5">
          <CardHeader
            title="Recent activity"
            description={can(user, "audit:view") ? "Across the whole workspace" : undefined}
            action={
              can(user, "audit:view") ? (
                <Link href="/audit" className="text-xs font-medium text-accent hover:underline">
                  Audit log
                </Link>
              ) : null
            }
          />

          {activity.length === 0 ? (
            <EmptyState
              compact
              icon={FileText}
              title="No activity to show"
              description="Changes to invoices, payments, and settings appear here as they happen."
            />
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2.5 px-4 py-2">
                  <Avatar name={entry.actorName} size="xs" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-4 text-ink">
                      <span className="font-medium">{entry.actorName}</span>{" "}
                      <span className="text-ink-muted">
                        {(AUDIT_ACTION_LABEL[entry.action as AuditAction] ?? entry.action).toLowerCase()}
                      </span>{" "}
                      {entry.entityType === "Invoice" ? (
                        <Link
                          href={`/invoices/${entry.entityId}`}
                          className="ident text-ink hover:text-accent hover:underline"
                        >
                          {entry.entityLabel}
                        </Link>
                      ) : (
                        <span className="ident text-ink">{entry.entityLabel}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-2xs text-ink-subtle">{formatRelative(entry.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {can(user, "invoice:create") ? (
        <section className="mt-3">
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Have a stack of paper invoices?</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Upload one and the vendor, dates and totals fill in the form for you to check.
                </p>
              </div>
              <ButtonLink href="/invoices/new" variant="secondary" size="md">
                Scan an invoice
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </ButtonLink>
            </CardBody>
          </Card>
        </section>
      ) : null}
    </>
  );
}

function partOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
