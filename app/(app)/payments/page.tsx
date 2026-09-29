import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, CheckCircle2, Info, Layers } from "lucide-react";

import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatCents, formatCentsCompact, formatDate, toDateInput } from "@/lib/format";
import {
  PAYMENT_METHOD_META,
  PAYMENT_STATUS_META,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { Amount, DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, readListParams } from "@/components/ui/pagination";
import { PageHeader, Tabs } from "@/components/ui/tabs";
import { StatTile } from "@/components/ui/stat-tile";
import { createBatch, executeBatch } from "./actions";

export const metadata: Metadata = { title: "Payments" };

const SORTS = ["paymentNumber", "amountCents", "scheduledDate", "executedDate", "status"];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("payment:view");
  const params = await searchParams;
  const tab = params.tab === "batches" ? "batches" : "payments";
  const mayManage = can(user, "payment:manage");

  const { page, pageSize, skip, take, sort, order } = readListParams(params, {
    defaultSort: "scheduledDate",
    defaultOrder: "desc",
    allowedSorts: SORTS,
  });

  const statusFilter = params.status && params.status in PAYMENT_STATUS_META ? params.status : undefined;
  const where = statusFilter ? { status: statusFilter } : {};

  const [rows, total, sums, scheduledCount, scheduledValue, unbatched, batches] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: [{ [sort]: order }, { id: "asc" }],
      skip,
      take,
      include: {
        invoice: { select: { id: true, invoiceNumber: true, vendor: { select: { name: true } } } },
        initiatedBy: { select: { name: true } },
        batch: { select: { batchNumber: true } },
      },
    }),
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amountCents: true } }),
    db.payment.count({ where: { status: "SCHEDULED" } }),
    db.payment.aggregate({ where: { status: "SCHEDULED" }, _sum: { amountCents: true } }),
    db.payment.count({ where: { status: "SCHEDULED", batchId: null } }),
    db.paymentBatch.findMany({
      orderBy: { scheduledDate: "desc" },
      take: 25,
      include: { createdBy: { select: { name: true } } },
    }),
  ]);

  const paidThisMonth = await db.payment.aggregate({
    where: {
      status: "COMPLETED",
      executedDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    },
    _sum: { amountCents: true },
    _count: true,
  });

  return (
    <>
      <PageHeader
        title="Payments"
        description="What is queued to leave, and what already has"
        actions={
          mayManage && unbatched > 0 ? (
            <form action={createBatch}>
              <input type="hidden" name="through" value={toDateInput(new Date())} />
              <Button type="submit" variant="primary" size="md">
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Create run ({unbatched})
              </Button>
            </form>
          ) : null
        }
      />

      <Notices params={params} />

      <section aria-label="Payment summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Scheduled"
          value={formatCentsCompact(scheduledValue._sum.amountCents ?? 0)}
          detail={`${scheduledCount} queued to send`}
          href="/payments?status=SCHEDULED"
        />
        <StatTile
          label="Not yet in a run"
          value={unbatched}
          tone={unbatched > 0 ? "warn" : "default"}
          detail={unbatched > 0 ? "Ready to batch" : "Everything batched"}
        />
        <StatTile
          label="Paid this month"
          value={formatCentsCompact(paidThisMonth._sum.amountCents ?? 0)}
          tone="accent"
          detail={`${paidThisMonth._count} payments sent`}
        />
        <StatTile label="Payment runs" value={batches.length} detail="Most recent first" href="/payments?tab=batches" />
      </section>

      <Card className="mt-3">
        <Tabs
          items={[
            { href: "/payments", label: "Payments", active: tab === "payments", count: total },
            { href: "/payments?tab=batches", label: "Runs", active: tab === "batches", count: batches.length },
          ]}
        />

        {tab === "payments" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <FilterLink href="/payments" label="All" active={!statusFilter} />
              {(Object.keys(PAYMENT_STATUS_META) as PaymentStatus[]).map((status) => (
                <FilterLink
                  key={status}
                  href={`/payments?status=${status}`}
                  label={PAYMENT_STATUS_META[status].label}
                  active={statusFilter === status}
                />
              ))}
              <span className="ml-auto text-2xs text-ink-subtle">
                {formatCents(sums._sum.amountCents ?? 0)} in view
              </span>
            </div>

            <DataTable
              columns={paymentColumns}
              rows={rows}
              getRowKey={(row) => row.id}
              rowHref={(row) => `/payments/${row.id}`}
              searchParams={params}
              sort={sort}
              order={order}
              emptyState={
                <EmptyState
                  icon={Banknote}
                  title={statusFilter ? "No payments with that status" : "No payments yet"}
                  description={
                    statusFilter
                      ? "Try another status, or clear the filter."
                      : "Approved invoices can be scheduled for payment from the invoice page."
                  }
                />
              }
            />

            {rows.length > 0 ? (
              <Pagination page={page} pageSize={pageSize} total={total} searchParams={params} />
            ) : null}
          </>
        ) : (
          <BatchList batches={batches} mayManage={mayManage} />
        )}
      </Card>
    </>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded bg-neutral-soft px-2 py-1 text-xs font-medium text-ink"
          : "rounded px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
      }
    >
      {label}
    </Link>
  );
}

type BatchRow = {
  id: string;
  batchNumber: string;
  status: string;
  totalCents: number;
  itemCount: number;
  scheduledDate: Date;
  executedDate: Date | null;
  createdBy: { name: string };
};

function BatchList({ batches, mayManage }: { batches: BatchRow[]; mayManage: boolean }) {
  if (batches.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No payment runs yet"
        description="A run groups everything scheduled up to a date, so one person releases them together."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {batches.map((batch) => (
        <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="ident text-ink">{batch.batchNumber}</span>
              <StatusPill kind="batch" status={batch.status} />
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {batch.itemCount} {batch.itemCount === 1 ? "payment" : "payments"} · created by{" "}
              {batch.createdBy.name} ·{" "}
              {batch.executedDate
                ? `released ${formatDate(batch.executedDate)}`
                : `scheduled ${formatDate(batch.scheduledDate)}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium tabular-nums text-ink">
              {formatCents(batch.totalCents)}
            </span>
            {mayManage && batch.status !== "COMPLETED" ? (
              <form action={executeBatch}>
                <input type="hidden" name="batchId" value={batch.id} />
                <Button type="submit" variant="primary" size="sm">
                  Release run
                </Button>
              </form>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Notices({ params }: { params: Record<string, string | undefined> }) {
  const messages: string[] = [];
  if (params.created) messages.push(`Created payment run ${params.created}.`);
  if (params.executed) messages.push(`Released ${params.executed}. Every invoice in it is now paid.`);
  if (params.error === "empty") {
    return (
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-flat">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        <p className="text-sm text-ink-muted">
          There is nothing scheduled to put in a run yet. Schedule a payment from an approved
          invoice first.
        </p>
      </div>
    );
  }
  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <p className="text-sm text-accent">{messages.join(" ")}</p>
    </div>
  );
}

type PaymentRow = {
  id: string;
  paymentNumber: string;
  method: string;
  amountCents: number;
  status: string;
  scheduledDate: Date;
  executedDate: Date | null;
  reference: string | null;
  invoice: { id: string; invoiceNumber: string; vendor: { name: string } };
  initiatedBy: { name: string };
  batch: { batchNumber: string } | null;
};

const paymentColumns: Array<Column<PaymentRow>> = [
  {
    key: "number",
    header: "Payment",
    sortKey: "paymentNumber",
    width: "w-40",
    render: (row) => (
      <span className="block">
        <span className="ident block text-ink">{row.paymentNumber}</span>
        {row.batch ? (
          <span className="ident block text-2xs text-ink-subtle">{row.batch.batchNumber}</span>
        ) : null}
      </span>
    ),
  },
  {
    key: "vendor",
    header: "Vendor",
    render: (row) => (
      <span className="block">
        <span className="block max-w-56 truncate text-ink">{row.invoice.vendor.name}</span>
        <span className="ident block text-2xs text-ink-subtle">{row.invoice.invoiceNumber}</span>
      </span>
    ),
  },
  {
    key: "method",
    header: "Method",
    width: "w-32",
    hideBelow: "md",
    render: (row) => (
      <span className="text-ink-muted">
        {PAYMENT_METHOD_META[row.method as PaymentMethod]?.label ?? row.method}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    sortKey: "status",
    width: "w-32",
    render: (row) => <StatusPill kind="payment" status={row.status} />,
  },
  {
    key: "date",
    header: "Date",
    sortKey: "scheduledDate",
    width: "w-32",
    render: (row) => (
      <span className="block">
        <span className="block tabular-nums text-ink">
          {formatDate(row.executedDate ?? row.scheduledDate)}
        </span>
        <span className="block text-2xs text-ink-subtle">
          {row.executedDate ? "Executed" : "Scheduled"}
        </span>
      </span>
    ),
  },
  {
    key: "amount",
    header: "Amount",
    sortKey: "amountCents",
    align: "right",
    width: "w-32",
    render: (row) => <Amount>{formatCents(row.amountCents)}</Amount>,
  },
];
