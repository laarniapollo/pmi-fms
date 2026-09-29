import type { Metadata } from "next";
import { Archive as ArchiveIcon, FileDown } from "lucide-react";

import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { buildQuery } from "@/lib/utils";
import { formatCents, formatDate } from "@/lib/format";
import {
  INVOICE_SORTS,
  listInvoices,
  listVendorOptions,
  type InvoiceListRow,
  type InvoiceSort,
} from "@/lib/queries/invoices";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Amount, DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, readListParams } from "@/components/ui/pagination";
import { PageHeader } from "@/components/ui/tabs";
import { InvoiceFilters } from "../invoices/invoice-filters";

export const metadata: Metadata = { title: "Archive" };

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("invoice:view");
  const params = await searchParams;

  const { page, pageSize, skip, take, sort, order } = readListParams(params, {
    defaultSort: "dueDate",
    defaultOrder: "desc",
    allowedSorts: [...INVOICE_SORTS],
  });

  const [{ rows, total, sumCents }, vendors] = await Promise.all([
    listInvoices({
      filters: {
        q: params.q,
        status: params.status,
        vendorId: params.vendor,
        // The one thing that makes this page the archive rather than the list.
        archived: true,
      },
      sort: sort as InvoiceSort,
      order,
      skip,
      take,
    }),
    listVendorOptions(),
  ]);

  const filtered = Boolean(params.q || params.status || params.vendor);

  return (
    <>
      <PageHeader
        title="Archive"
        description={`${total.toLocaleString()} settled ${total === 1 ? "invoice" : "invoices"} · ${formatCents(sumCents)}. Archived work stays readable and stays in the audit trail.`}
        actions={
          can(user, "export:run") ? (
            <ButtonLink
              href={`/api/export/invoices${buildQuery({ ...params, archived: "1" }, { page: undefined, size: undefined })}`}
              variant="secondary"
              size="md"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              Export CSV
            </ButtonLink>
          ) : null
        }
      />

      {params.archived ? (
        <div
          role="status"
          className="mb-3 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5 text-sm text-accent"
        >
          Archived. It is off the active ledger but still here, and still in the audit trail.
        </div>
      ) : null}

      <Card>
        <InvoiceFilters searchParams={params} vendors={vendors} showSource={false} />

        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/invoices/${row.id}`}
          searchParams={params}
          sort={sort}
          order={order}
          emptyState={
            <EmptyState
              icon={ArchiveIcon}
              title={filtered ? "Nothing archived matches these filters" : "The archive is empty"}
              description={
                filtered
                  ? "Try clearing the filters."
                  : "Paid, voided, and rejected invoices can be archived from the invoice page to keep the active list clean."
              }
              action={
                filtered ? (
                  <ButtonLink href="/archive" variant="secondary" size="md">
                    Clear filters
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/invoices" variant="secondary" size="md">
                    Go to invoices
                  </ButtonLink>
                )
              }
            />
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
    render: (row) => <span className="ident text-ink">{row.invoiceNumber}</span>,
  },
  {
    key: "vendor",
    header: "Vendor",
    sortKey: "vendor",
    render: (row) => <span className="block max-w-56 truncate text-ink">{row.vendor.name}</span>,
  },
  {
    key: "status",
    header: "Status",
    sortKey: "status",
    width: "w-32",
    render: (row) => <StatusPill kind="invoice" status={row.status} />,
  },
  {
    key: "issued",
    header: "Issued",
    sortKey: "issueDate",
    width: "w-28",
    hideBelow: "md",
    render: (row) => <span className="tabular-nums text-ink-muted">{formatDate(row.issueDate)}</span>,
  },
  {
    key: "archived",
    header: "Archived",
    width: "w-28",
    render: (row) => (
      <span className="tabular-nums text-ink-muted">
        {row.archivedAt ? formatDate(row.archivedAt) : "—"}
      </span>
    ),
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
