import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { INVOICE_STATUS, type InvoiceStatus } from "@/lib/constants";

/**
 * The invoice list query, shared by the listing, the archive, and search.
 *
 * Filtering, sorting, and pagination all happen in the database. Reading the
 * whole table and slicing it in JavaScript would work at 284 rows and fall
 * over at 284,000 — and the CSV export depends on this same builder to know
 * what "the filtered set" means.
 *
 * SQLite's LIKE is case-insensitive for ASCII, so `contains` needs no `mode`
 * (which SQLite would reject anyway).
 */

export const INVOICE_SORTS = [
  "invoiceNumber",
  "vendor",
  "issueDate",
  "dueDate",
  "totalCents",
  "status",
  "createdAt",
] as const;

export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export interface InvoiceFilters {
  q?: string;
  status?: string;
  vendorId?: string;
  /** `overdue` | `week` | `month` — relative to today. */
  due?: string;
  /** `scanned` shows only invoices that came in through OCR. */
  source?: string;
  /** Archive screen passes true; every other screen passes false. */
  archived?: boolean;
  /** Restricts to invoices this user entered. Used by the clerk's own view. */
  createdById?: string;
}

export function buildInvoiceWhere(filters: InvoiceFilters, now = new Date()): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {
    archivedAt: filters.archived ? { not: null } : null,
  };

  const query = filters.q?.trim();
  if (query) {
    where.OR = [
      { invoiceNumber: { contains: query } },
      { poNumber: { contains: query } },
      { description: { contains: query } },
      { vendor: { name: { contains: query } } },
    ];
  }

  if (filters.status && filters.status in INVOICE_STATUS) {
    where.status = filters.status as InvoiceStatus;
  }

  if (filters.vendorId) where.vendorId = filters.vendorId;
  if (filters.createdById) where.createdById = filters.createdById;
  if (filters.source === "scanned") where.ocrConfidence = { not: null };

  if (filters.due === "overdue") {
    where.dueDate = { lt: now };
    // Settled invoices are not overdue, however old they are.
    where.status = { in: ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"] };
  } else if (filters.due === "week" || filters.due === "month") {
    const days = filters.due === "week" ? 7 : 30;
    where.dueDate = { gte: now, lte: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) };
  }

  return where;
}

function orderFor(sort: InvoiceSort, order: "asc" | "desc"): Prisma.InvoiceOrderByWithRelationInput[] {
  if (sort === "vendor") return [{ vendor: { name: order } }, { dueDate: "desc" }];
  // A stable secondary key keeps pagination from reshuffling rows that tie.
  return [{ [sort]: order } as Prisma.InvoiceOrderByWithRelationInput, { id: "asc" }];
}

export async function listInvoices({
  filters,
  sort,
  order,
  skip,
  take,
}: {
  filters: InvoiceFilters;
  sort: InvoiceSort;
  order: "asc" | "desc";
  skip: number;
  take: number;
}) {
  const where = buildInvoiceWhere(filters);

  const [rows, total, totals] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: orderFor(sort, order),
      skip,
      take,
      include: {
        vendor: { select: { id: true, name: true } },
        createdBy: { select: { name: true, avatarColor: true } },
        approvalSteps: {
          orderBy: { sequence: "asc" },
          include: { approver: { select: { name: true } } },
        },
      },
    }),
    db.invoice.count({ where }),
    // The sum covers the whole filtered set, not the visible page — a footer
    // that totalled only 25 of 300 rows would be actively misleading.
    db.invoice.aggregate({ where, _sum: { totalCents: true } }),
  ]);

  return { rows, total, sumCents: totals._sum.totalCents ?? 0 };
}

export type InvoiceListRow = Awaited<ReturnType<typeof listInvoices>>["rows"][number];

/** Every row matching the filters, for CSV and PDF export. No pagination. */
export function listInvoicesForExport(filters: InvoiceFilters, sort: InvoiceSort, order: "asc" | "desc") {
  return db.invoice.findMany({
    where: buildInvoiceWhere(filters),
    orderBy: orderFor(sort, order),
    include: {
      vendor: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

export function getInvoice(id: string) {
  return db.invoice.findUnique({
    where: { id },
    include: {
      vendor: true,
      createdBy: { select: { id: true, name: true, avatarColor: true, role: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
      attachments: {
        orderBy: { createdAt: "asc" },
        include: { uploadedBy: { select: { name: true } } },
      },
      approvalSteps: {
        orderBy: { sequence: "asc" },
        include: { approver: { select: { id: true, name: true, avatarColor: true } } },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        include: { initiatedBy: { select: { name: true } } },
      },
    },
  });
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** Audit entries for one invoice, newest first. Shown on the detail screen. */
export function getInvoiceHistory(invoiceId: string) {
  return db.auditLog.findMany({
    where: { entityType: "Invoice", entityId: invoiceId },
    orderBy: { createdAt: "desc" },
  });
}

/** Vendors for the filter dropdown and the invoice form's picker. */
export function listVendorOptions() {
  return db.vendor.findMany({
    where: { status: { not: "INACTIVE" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      paymentTerms: true,
      defaultPaymentMethod: true,
      category: true,
      // Prefills the invoice form's supplier TIN. Never sent to the scanner.
      taxId: true,
    },
  });
}

/**
 * Flags a vendor + number pair that already exists. The unique constraint
 * would catch this on save; catching it here lets the form say so in words
 * while the person is still typing.
 */
export async function findDuplicate(vendorId: string, invoiceNumber: string, excludeId?: string) {
  if (!vendorId || !invoiceNumber.trim()) return null;

  return db.invoice.findFirst({
    where: {
      vendorId,
      invoiceNumber: invoiceNumber.trim(),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, invoiceNumber: true, status: true, totalCents: true },
  });
}
