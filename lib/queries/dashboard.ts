import { db } from "@/lib/db";
import { AGING_BUCKETS, LOCALE, OPEN_INVOICE_STATUSES } from "@/lib/constants";
import { agingBucket } from "@/lib/format";
import type { AgingDatum } from "@/components/charts/aging-bars";
import type { SpendDatum } from "@/components/charts/spend-columns";

/**
 * Everything the dashboard needs, in one place.
 *
 * "Outstanding" deliberately excludes drafts: a draft is a piece of paper on
 * someone's desk, not yet a commitment the company has made. Including them
 * would overstate what is owed, which is the one number a controller cannot
 * have wrong.
 */

const MONTHS_SHOWN = 6;

export interface DashboardData {
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  awaitingCents: number;
  awaitingCount: number;
  paidThisMonthCents: number;
  paidThisMonthCount: number;
  vendorCount: number;
  aging: AgingDatum[];
  spend: SpendDatum[];
}

export async function getDashboardData(now = new Date()): Promise<DashboardData> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1), 1);

  const [open, paidThisMonth, paidInWindow, vendorCount] = await Promise.all([
    db.invoice.findMany({
      where: { status: { in: OPEN_INVOICE_STATUSES }, archivedAt: null },
      select: { id: true, totalCents: true, dueDate: true, status: true },
    }),
    db.invoice.aggregate({
      where: { status: "PAID", paidAt: { gte: monthStart } },
      _sum: { totalCents: true },
      _count: true,
    }),
    db.invoice.findMany({
      where: { status: "PAID", paidAt: { gte: windowStart } },
      select: { totalCents: true, paidAt: true },
    }),
    db.vendor.count({ where: { status: "ACTIVE" } }),
  ]);

  const outstandingCents = open.reduce((sum, invoice) => sum + invoice.totalCents, 0);

  const overdue = open.filter((invoice) => invoice.dueDate < now);
  const awaiting = open.filter((invoice) => invoice.status === "PENDING_APPROVAL");

  // Ageing is bucketed in JS: the ladder is defined once in constants.ts, and
  // reimplementing it as SQL date arithmetic would give it a second definition.
  const aging: AgingDatum[] = AGING_BUCKETS.map((bucket) => {
    const matching = open.filter((invoice) => agingBucket(invoice.dueDate, now) === bucket.key);
    return {
      key: bucket.key,
      label: bucket.label,
      cents: matching.reduce((sum, invoice) => sum + invoice.totalCents, 0),
      count: matching.length,
    };
  });

  const spend: SpendDatum[] = Array.from({ length: MONTHS_SHOWN }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1 - index), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const matching = paidInWindow.filter(
      (invoice) => invoice.paidAt && invoice.paidAt >= start && invoice.paidAt < end,
    );

    return {
      key: `${start.getFullYear()}-${start.getMonth()}`,
      label: start.toLocaleString(LOCALE, { month: "long", year: "numeric" }),
      axisLabel: start.toLocaleString(LOCALE, { month: "short" }),
      cents: matching.reduce((sum, invoice) => sum + invoice.totalCents, 0),
      count: matching.length,
      partial: index === MONTHS_SHOWN - 1,
    };
  });

  return {
    outstandingCents,
    outstandingCount: open.length,
    overdueCents: overdue.reduce((sum, invoice) => sum + invoice.totalCents, 0),
    overdueCount: overdue.length,
    awaitingCents: awaiting.reduce((sum, invoice) => sum + invoice.totalCents, 0),
    awaitingCount: awaiting.length,
    paidThisMonthCents: paidThisMonth._sum.totalCents ?? 0,
    paidThisMonthCount: paidThisMonth._count,
    vendorCount,
    aging,
    spend,
  };
}

/**
 * Invoices this person can actually act on. Excludes their own entries, which
 * is the separation-of-duties rule showing up as an empty row rather than a
 * denied click.
 */
export function getApprovalQueue(userId: string, take = 6) {
  return db.invoice.findMany({
    where: {
      status: "PENDING_APPROVAL",
      archivedAt: null,
      createdById: { not: userId },
      approvalSteps: { some: { status: "PENDING" } },
    },
    include: {
      vendor: { select: { name: true } },
      createdBy: { select: { name: true } },
      approvalSteps: {
        orderBy: { sequence: "asc" },
        include: { approver: { select: { name: true } } },
      },
    },
    orderBy: [{ dueDate: "asc" }],
    take,
  });
}

export function getRecentActivity(take = 8) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      actorName: true,
      actorRole: true,
      action: true,
      entityType: true,
      entityId: true,
      entityLabel: true,
      summary: true,
      createdAt: true,
    },
  });
}

/** Invoices falling due inside the next `days`, soonest first. */
export function getUpcoming(days = 14, take = 6) {
  const now = new Date();
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return db.invoice.findMany({
    where: {
      status: { in: ["APPROVED", "SCHEDULED"] },
      archivedAt: null,
      dueDate: { gte: now, lte: horizon },
    },
    include: { vendor: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
    take,
  });
}
