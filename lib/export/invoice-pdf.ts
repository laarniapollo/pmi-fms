import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import { formatCentsCode, formatDate, formatDateTime } from "@/lib/format";
import { INVOICE_STATUS_META, type InvoiceStatus } from "@/lib/constants";

/**
 * Renders an invoice to PDF in the browser.
 *
 * Client-side on purpose: this is a document a person asked for, so producing
 * it where they asked avoids a headless-browser dependency on the server and
 * keeps invoice contents off the wire a second time.
 *
 * The output is deliberately a *record*, not a re-issue of the supplier's
 * invoice: it carries the approval trail and payment status, which is what
 * makes it worth filing.
 */

const INK = "#1E2229";
const MUTED = "#5C6470";
const LINE = "#E2E6EA";
const ACCENT = "#168A48";

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  poNumber: string | null;
  issueDate: Date | string;
  dueDate: Date | string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  vatTypeLabel: string;
  /** Only the non-zero buckets of a mixed sale; empty for every other type. */
  vatBuckets: Array<{ label: string; cents: number }>;
  supplierTin: string | null;
  vatExemptionBasis: string | null;
  description: string | null;
  glAccount: string | null;
  costCenter: string | null;
  vendor: {
    name: string;
    addressLine1: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    taxId: string | null;
  };
  createdByName: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }>;
  approvals: Array<{
    sequence: number;
    status: string;
    approverName: string | null;
    decidedAt: Date | string | null;
    comment: string | null;
  }>;
  payments: Array<{
    paymentNumber: string;
    method: string;
    status: string;
    amountCents: number;
    executedDate: Date | string | null;
    reference: string | null;
  }>;
  orgName: string;
}

export function buildInvoicePdf(data: InvoicePdfData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(INK);
  doc.text(data.orgName, margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("Accounts payable record", margin, y + 14);

  // Status, right-aligned, in the accent only when settled.
  const statusLabel = INVOICE_STATUS_META[data.status as InvoiceStatus]?.label ?? data.status;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(data.status === "PAID" ? ACCENT : MUTED);
  doc.text(statusLabel.toUpperCase(), pageWidth - margin, y, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(INK);
  doc.text(data.invoiceNumber, pageWidth - margin, y + 16, { align: "right" });

  y += 34;
  doc.setDrawColor(LINE);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // Two columns: who billed us, and the invoice's own particulars.
  const rightColumn = margin + (pageWidth - margin * 2) / 2;

  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text("VENDOR", margin, y);
  doc.text("DETAILS", rightColumn, y);

  doc.setFontSize(10);
  doc.setTextColor(INK);
  const vendorLines = [
    data.vendor.name,
    data.vendor.addressLine1 ?? "",
    [data.vendor.city, data.vendor.province, data.vendor.postalCode].filter(Boolean).join(", "),
    data.vendor.taxId ? `Tax ID ${data.vendor.taxId}` : "",
  ].filter(Boolean);
  vendorLines.forEach((line, index) => doc.text(line, margin, y + 14 + index * 12));

  const detailLines = [
    ["Issued", formatDate(data.issueDate)],
    ["Due", formatDate(data.dueDate)],
    ["PO number", data.poNumber ?? "—"],
    ["Entered by", data.createdByName],
    ["GL account", data.glAccount ?? "—"],
    ["Cost centre", data.costCenter ?? "—"],
    ["VAT type", data.vatTypeLabel],
    ["Supplier TIN", data.supplierTin ?? "—"],
    ...(data.vatExemptionBasis ? [["Exemption basis", data.vatExemptionBasis]] : []),
  ];
  detailLines.forEach(([label, value], index) => {
    doc.setTextColor(MUTED);
    doc.text(String(label), rightColumn, y + 14 + index * 12);
    doc.setTextColor(INK);
    doc.text(String(value), pageWidth - margin, y + 14 + index * 12, { align: "right" });
  });

  y += 14 + Math.max(vendorLines.length, detailLines.length) * 12 + 16;

  if (data.description) {
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text(doc.splitTextToSize(data.description, pageWidth - margin * 2), margin, y);
    y += 18;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Description", "Qty", "Unit price", "Amount"]],
    body: data.lineItems.map((item) => [
      item.description,
      String(item.quantity),
      formatCentsCode(item.unitPriceCents),
      formatCentsCode(item.amountCents),
    ]),
    foot: [
      ["", "", "Subtotal", formatCentsCode(data.subtotalCents)],
      ...data.vatBuckets.map((bucket) => ["", "", bucket.label, formatCentsCode(bucket.cents)]),
      ["", "", "VAT", formatCentsCode(data.taxCents)],
      ["", "", "Total", formatCentsCode(data.totalCents)],
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
    headStyles: { fontStyle: "bold", fillColor: [250, 251, 252], textColor: MUTED, fontSize: 8 },
    footStyles: { fontStyle: "bold", textColor: INK, fillColor: [255, 255, 255] },
    columnStyles: {
      1: { halign: "right", cellWidth: 44 },
      // Sized for "PHP 2,940,000.00" — the ISO code plus a seven-figure peso
      // amount is far wider than the dollar figures these columns once held.
      2: { halign: "right", cellWidth: 100 },
      3: { halign: "right", cellWidth: 112 },
    },
  });

  // @ts-expect-error — autoTable stashes its finishing position on the doc.
  y = (doc.lastAutoTable?.finalY ?? y) + 24;

  if (data.approvals.length > 0) {
    y = section(doc, "APPROVALS", margin, y, pageWidth);
    for (const approval of data.approvals) {
      const decided = approval.decidedAt ? formatDateTime(approval.decidedAt) : "Pending";
      doc.setFontSize(9);
      doc.setTextColor(INK);
      doc.text(
        `${approval.sequence}. ${approval.approverName ?? "Awaiting approver"} — ${approval.status.toLowerCase()}`,
        margin,
        y,
      );
      doc.setTextColor(MUTED);
      doc.text(decided, pageWidth - margin, y, { align: "right" });
      y += 12;

      if (approval.comment) {
        doc.setFontSize(8);
        doc.text(doc.splitTextToSize(`“${approval.comment}”`, pageWidth - margin * 2 - 20), margin + 12, y);
        y += 12;
      }
    }
    y += 12;
  }

  if (data.payments.length > 0) {
    y = section(doc, "PAYMENTS", margin, y, pageWidth);
    for (const payment of data.payments) {
      doc.setFontSize(9);
      doc.setTextColor(INK);
      doc.text(
        `${payment.paymentNumber} — ${payment.method}, ${payment.status.toLowerCase()}`,
        margin,
        y,
      );
      doc.setTextColor(MUTED);
      doc.text(
        `${formatCentsCode(payment.amountCents)}${payment.reference ? ` · ${payment.reference}` : ""}`,
        pageWidth - margin,
        y,
        { align: "right" },
      );
      y += 12;
    }
  }

  // Footer on every page: a printed record needs to say what produced it.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    const height = doc.internal.pageSize.getHeight();
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    doc.text(
      `Generated from PoultryMax FMS on ${formatDateTime(new Date())} · not a tax document`,
      margin,
      height - 24,
    );
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, height - 24, { align: "right" });
  }

  return doc;
}

function section(doc: jsPDF, title: string, margin: number, y: number, pageWidth: number): number {
  doc.setDrawColor(LINE);
  doc.line(margin, y - 10, pageWidth - margin, y - 10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(title, margin, y);
  doc.setFont("helvetica", "normal");
  return y + 14;
}
