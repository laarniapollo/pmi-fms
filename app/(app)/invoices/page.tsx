import type { Metadata } from "next";
import { FileText, FileDown } from "lucide-react";

import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatCents, formatDate, describeDueDate } from "@/lib/format";
import { buildQuery } from "@/lib/utils";
import { OPEN_INVOICE_STATUSES, type InvoiceStatus } from "@/lib/constants";
import {
  INVOICE_SORTS,
  listInvoices,
  listVendorOptions,
  type InvoiceListRow,
  type InvoiceSort,
} from "@/lib/queries/invoices";
import { ApprovalRailCompact, buildRail } from "@/components/approval-rail";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/badge";
import { Amount, DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, readListParams } from "@/components/ui/pagination";
import { PageHeader } from "@/components/ui/tabs";
import { InvoiceFilters } from "./invoice-filters";

export const metadata: Metadata = { title: "Invoices" };

type Params = Record<string, string | undefined>;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const user = await requireAction("invoice:view");
  const params = await searchParams;

  const { page, pageSize, skip, take, sort, order } = readListParams(params, {
    defaultSort: "dueDate",
    defaultOrder: "asc",
    allowedSorts: [...INVOICE_SORTS],
  });

  const [{ rows, total, sumCents }, vendors] = await Promise.all([
    listInvoices({
      filters: {
        q: params.q,
        status: params.status,
        vendorId: params.vendor,
        due: params.due,
        source: params.source,
        archived: false,
      },
      sort: sort as InvoiceSort,
      order,
      skip,
      take,
    }),
    listVendorOptions(),
  ]);

  const filtered = Boolean(params.q || params.status || params.vendor || params.due || params.source);

  return (
    <>
      <PageHeader
        title="Invoices"
        description={`${total.toLocaleString()} ${total === 1 ? "invoice" : "invoices"} · ${formatCents(sumCents)} in view`}
        actions={
          <>
            {can(user, "export:run") ? (
              <ButtonLink
                href={`/api/export/invoices${buildQuery(params, { page: undefined, size: undefined })}`}
                variant="secondary"
                size="md"
              >
                <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                Export CSV
              </ButtonLink>
            ) : null}
            {can(user, "invoice:create") ? (
              <ButtonLink href="/invoices/new" variant="primary" size="md">
                New invoice
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Card>
        <InvoiceFilters searchParams={params} vendors={vendors} />

        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/invoices/${row.id}`}
          searchParams={params}
          sort={sort}
          order={order}
          emptyState={
            filtered ? (
              <EmptyState
                icon={FileText}
                title="No invoices match these filters"
                description="Try a different status or date range, or clear the filters to see everything."
                action={
                  <ButtonLink href="/invoices" variant="secondary" size="md">
                    Clear filters
                  </ButtonLink>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No invoices yet"
                description="Enter one by hand, or upload a scan and let PoultryMax FMS read the details off it."
                action={
                  can(user, "invoice:create") ? (
                    <ButtonLink href="/invoices/new" variant="primary" size="md">
                      New invoice
                    </ButtonLink>
                  ) : undefined
                }
              />
            )
          }
        />

        {rows.length > 0 ? (
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={params} />
        ) : null}
      </Card>
    </>
  );
}

const columns: Array<Column<InvoiceListRow>> = [
  {
    key: "number",
    header: "Invoice",
    sortKey: "invoiceNumber",
    width: "w-40",
    render: (row) => (
      <span className="block">
        <span className="ident block text-ink">{row.invoiceNumber}</span>
        {row.poNumber ? (
          <span className="block text-2xs text-ink-subtle">PO {row.poNumber}</span>
        ) : null}
      </span>
    ),
  },
  {
    key: "vendor",
    header: "Vendor",
    sortKey: "vendor",
    render: (row) => (
      <span className="block max-w-56 truncate text-ink" title={row.vendor.name}>
        {row.vendor.name}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    sortKey: "status",
    width: "w-36",
    render: (row) => <StatusPill kind="invoice" status={row.status} />,
  },
  {
    key: "progress",
    header: "Progress",
    width: "w-24",
    hideBelow: "lg",
    render: (row) => <ApprovalRailCompact steps={buildRail(row)} />,
  },
  {
    key: "issued",
    header: "Issued",
    sortKey: "issueDate",
    width: "w-28",
    hideBelow: "xl",
    render: (row) => <span className="text-ink-muted tabular-nums">{formatDate(row.issueDate)}</span>,
  },
  {
    key: "due",
    header: "Due",
    sortKey: "dueDate",
    width: "w-32",
    render: (row) => {
      const due = describeDueDate(row.dueDate);
      // Only money still owed can be overdue. A draft is not a commitment, and
      // a rejected or voided invoice will never be paid — labelling either
      // "146 days overdue" invents a liability that does not exist.
      const owes = OPEN_INVOICE_STATUSES.includes(row.status as InvoiceStatus);
      return (
        <span className="block">
          <span className="block tabular-nums text-ink">{formatDate(row.dueDate)}</span>
          {owes ? (
            <span
              className={
                due.tone === "danger"
                  ? "block text-2xs text-danger"
                  : due.tone === "warn"
                    ? "block text-2xs text-warn"
                    : "block text-2xs text-ink-subtle"
              }
            >
              {due.label}
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    key: "total",
    header: "Amount",
    sortKey: "totalCents",
    align: "right",
    width: "w-32",
    render: (row) => <Amount>{formatCents(row.totalCents)}</Amount>,
  },
];
