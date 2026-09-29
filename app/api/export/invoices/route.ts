import type { NextRequest } from "next/server";

import {
  AUDIT_ACTIONS,
  INVOICE_STATUS_META,
  isVatType,
  VAT_TYPE_META,
  type InvoiceStatus,
} from "@/lib/constants";
import { recordAudit } from "@/lib/audit/record";
import { PermissionError } from "@/lib/auth/permissions";
import { currentIp, requireActionOrThrow, UnauthenticatedError } from "@/lib/auth/session";
import { csvAmount, csvDate, csvResponse, timestampedName, toCsv } from "@/lib/export/csv";
import { INVOICE_SORTS, listInvoicesForExport, type InvoiceSort } from "@/lib/queries/invoices";

/**
 * Exports the *filtered* set, not the visible page. The query string this
 * route receives is the same one the list screen is showing, so what lands in
 * the file is exactly what the reader was looking at.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireActionOrThrow("export:run");
    const params = request.nextUrl.searchParams;

    const requestedSort = params.get("sort") ?? "";
    const sort = (INVOICE_SORTS as readonly string[]).includes(requestedSort)
      ? (requestedSort as InvoiceSort)
      : "dueDate";
    const order = params.get("order") === "desc" ? "desc" : "asc";

    const rows = await listInvoicesForExport(
      {
        q: params.get("q") ?? undefined,
        status: params.get("status") ?? undefined,
        vendorId: params.get("vendor") ?? undefined,
        due: params.get("due") ?? undefined,
        source: params.get("source") ?? undefined,
        archived: params.get("archived") === "1",
      },
      sort,
      order,
    );

    const csv = toCsv(rows, [
      { header: "Invoice number", value: (row) => row.invoiceNumber },
      { header: "Vendor", value: (row) => row.vendor.name },
      {
        header: "Status",
        value: (row) => INVOICE_STATUS_META[row.status as InvoiceStatus]?.label ?? row.status,
      },
      { header: "Issue date", value: (row) => csvDate(row.issueDate) },
      { header: "Due date", value: (row) => csvDate(row.dueDate) },
      { header: "Currency", value: (row) => row.currency },
      { header: "Subtotal", value: (row) => csvAmount(row.subtotalCents) },
      {
        header: "VAT type",
        value: (row) => (isVatType(row.vatType) ? VAT_TYPE_META[row.vatType].label : row.vatType),
      },
      { header: "VATable sales", value: (row) => csvAmount(row.vatableSalesCents) },
      { header: "Zero-rated sales", value: (row) => csvAmount(row.zeroRatedSalesCents) },
      { header: "VAT-exempt sales", value: (row) => csvAmount(row.exemptSalesCents) },
      { header: "VAT", value: (row) => csvAmount(row.taxCents) },
      { header: "Supplier TIN", value: (row) => row.supplierTin },
      { header: "Total", value: (row) => csvAmount(row.totalCents) },
      { header: "Amount paid", value: (row) => csvAmount(row.amountPaidCents) },
      { header: "PO number", value: (row) => row.poNumber },
      { header: "GL account", value: (row) => row.glAccount },
      { header: "Cost centre", value: (row) => row.costCenter },
      { header: "Entered by", value: (row) => row.createdBy.name },
      { header: "Submitted", value: (row) => csvDate(row.submittedAt) },
      { header: "Approved", value: (row) => csvDate(row.approvedAt) },
      { header: "Paid", value: (row) => csvDate(row.paidAt) },
      {
        header: "Source",
        value: (row) => (row.ocrConfidence === null ? "Keyed" : "Scanned"),
      },
    ]);

    // Who took data out of the system is exactly the sort of thing an auditor
    // asks about, so an export is a recorded event like any other.
    await recordAudit({
      actor: { id: user.id, name: user.name, role: user.role },
      action: AUDIT_ACTIONS.DATA_EXPORTED,
      entityType: "Invoice",
      entityId: "export",
      entityLabel: `${rows.length} invoices`,
      summary: `Exported ${rows.length} invoices to CSV`,
      metadata: { filters: Object.fromEntries(params.entries()) },
      ipAddress: await currentIp(),
    });

    return csvResponse(csv, timestampedName("poultrymax-invoices"));
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return new Response("Sign in to export data.", { status: 401 });
    }
    if (error instanceof PermissionError) {
      return new Response("Your role cannot export data.", { status: 403 });
    }
    throw error;
  }
}
