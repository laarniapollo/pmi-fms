import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatCents } from "@/lib/format";
import { PAYMENT_TERMS_META, VENDOR_CATEGORIES, VENDOR_STATUS_META, type PaymentTerms } from "@/lib/constants";
import { StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Amount, DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, readListParams } from "@/components/ui/pagination";
import { PageHeader } from "@/components/ui/tabs";
import { AddVendor } from "./add-vendor";
import { VendorFilters } from "./vendor-filters";

export const metadata: Metadata = { title: "Vendors" };

const SORTS = ["name", "category", "status", "paymentTerms", "createdAt"];

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("vendor:view");
  const params = await searchParams;

  const { page, pageSize, skip, take, sort, order } = readListParams(params, {
    defaultSort: "name",
    defaultOrder: "asc",
    allowedSorts: SORTS,
  });

  const where: Prisma.VendorWhereInput = {};
  if (params.q?.trim()) {
    where.OR = [
      { name: { contains: params.q.trim() } },
      { legalName: { contains: params.q.trim() } },
      { email: { contains: params.q.trim() } },
    ];
  }
  if (params.status && params.status in VENDOR_STATUS_META) where.status = params.status;
  if (params.category) where.category = params.category;

  const [vendors, total] = await Promise.all([
    db.vendor.findMany({
      where,
      orderBy: [{ [sort]: order }, { id: "asc" }],
      skip,
      take,
      include: {
        _count: { select: { invoices: true } },
        invoices: {
          where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"] }, archivedAt: null },
          select: { totalCents: true },
        },
      },
    }),
    db.vendor.count({ where }),
  ]);

  const rows = vendors.map((vendor) => ({
    ...vendor,
    outstandingCents: vendor.invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0),
  }));

  const filtered = Boolean(params.q || params.status || params.category);

  return (
    <>
      <PageHeader
        title="Vendors"
        description={`${total.toLocaleString()} ${total === 1 ? "supplier" : "suppliers"} on file`}
        actions={can(user, "vendor:manage") ? <AddVendor /> : null}
      />

      <Card>
        <VendorFilters searchParams={params} categories={[...VENDOR_CATEGORIES]} />

        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/vendors/${row.id}`}
          searchParams={params}
          sort={sort}
          order={order}
          emptyState={
            <EmptyState
              icon={Building2}
              title={filtered ? "No vendors match these filters" : "No vendors yet"}
              description={
                filtered
                  ? "Try a different category or status."
                  : "Add your first supplier to start entering invoices against it."
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

type VendorRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  paymentTerms: string;
  city: string | null;
  province: string | null;
  defaultPaymentMethod: string;
  outstandingCents: number;
  _count: { invoices: number };
};

const columns: Array<Column<VendorRow>> = [
  {
    key: "name",
    header: "Vendor",
    sortKey: "name",
    render: (row) => (
      <span className="block">
        <span className="block max-w-64 truncate font-medium text-ink">{row.name}</span>
        {row.city ? (
          <span className="block text-2xs text-ink-subtle">
            {row.city}
            {row.province ? `, ${row.province}` : ""}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "category",
    header: "Category",
    sortKey: "category",
    width: "w-44",
    hideBelow: "md",
    render: (row) => <span className="text-ink-muted">{row.category}</span>,
  },
  {
    key: "terms",
    header: "Terms",
    sortKey: "paymentTerms",
    width: "w-28",
    hideBelow: "lg",
    render: (row) => (
      <span className="text-ink-muted">
        {PAYMENT_TERMS_META[row.paymentTerms as PaymentTerms]?.label ?? row.paymentTerms}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    sortKey: "status",
    width: "w-32",
    render: (row) => <StatusPill kind="vendor" status={row.status} />,
  },
  {
    key: "invoices",
    header: "Invoices",
    align: "right",
    width: "w-24",
    hideBelow: "sm",
    render: (row) => <span className="tabular-nums text-ink-muted">{row._count.invoices}</span>,
  },
  {
    key: "outstanding",
    header: "Outstanding",
    align: "right",
    width: "w-32",
    render: (row) => (
      <Amount muted={row.outstandingCents === 0}>
        {row.outstandingCents === 0 ? "—" : formatCents(row.outstandingCents)}
      </Amount>
    ),
  },
];
