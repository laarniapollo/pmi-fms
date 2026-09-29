import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { isVatType } from "@/lib/constants";
import { toDateInput } from "@/lib/format";
import { getInvoice, listVendorOptions } from "@/lib/queries/invoices";
import { Breadcrumb, PageHeader } from "@/components/ui/tabs";
import { InvoiceForm } from "../../invoice-form";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  // An approved invoice is a commitment the company has made; amending it
  // would invalidate the sign-offs already recorded against it.
  const editable = can(user, "invoice:edit", {
    kind: "invoice",
    createdById: invoice.createdById,
    status: invoice.status,
    archivedAt: invoice.archivedAt,
  });
  if (!editable) redirect(`/invoices/${id}?error=locked`);

  const vendors = await listVendorOptions();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Invoices", href: "/invoices" },
              { label: invoice.invoiceNumber, href: `/invoices/${id}` },
              { label: "Edit" },
            ]}
          />
        }
        title={`Edit ${invoice.invoiceNumber}`}
        description={invoice.vendor.name}
      />

      <InvoiceForm
        mode="edit"
        vendors={vendors}
        defaults={{
          id: invoice.id,
          vendorId: invoice.vendorId,
          invoiceNumber: invoice.invoiceNumber,
          issueDate: toDateInput(invoice.issueDate),
          dueDate: toDateInput(invoice.dueDate),
          poNumber: invoice.poNumber ?? undefined,
          description: invoice.description ?? undefined,
          glAccount: invoice.glAccount ?? undefined,
          costCenter: invoice.costCenter ?? undefined,
          taxCents: invoice.taxCents,
          // A saved figure stands like a printed one; see `useVat`.
          taxSource: "read",
          vatType: isVatType(invoice.vatType) ? invoice.vatType : undefined,
          vatableSalesCents: invoice.vatableSalesCents,
          zeroRatedSalesCents: invoice.zeroRatedSalesCents,
          exemptSalesCents: invoice.exemptSalesCents,
          supplierTin: invoice.supplierTin ?? undefined,
          vatExemptionBasis: invoice.vatExemptionBasis ?? undefined,
          lineItems: invoice.lineItems.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            glAccount: line.glAccount,
          })),
        }}
      />
    </>
  );
}
