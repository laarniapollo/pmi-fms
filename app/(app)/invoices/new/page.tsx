import type { Metadata } from "next";

import { can } from "@/lib/auth/permissions";
import { requireAction } from "@/lib/auth/session";
import { listVendorOptions } from "@/lib/queries/invoices";
import { isScanConfigured } from "@/lib/extract/gemini-client";
import { Breadcrumb, PageHeader } from "@/components/ui/tabs";
import { NewInvoiceWorkspace } from "@/components/invoices/new-invoice-workspace";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const user = await requireAction("invoice:create");
  const vendors = await listVendorOptions();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: "Invoices", href: "/invoices" }, { label: "New" }]} />
        }
        title="New invoice"
        description="Upload the supplier's document to fill the form in, or key it in yourself. It saves as a draft until you submit it."
      />

      <NewInvoiceWorkspace
        vendors={vendors}
        /*
         * Read on the server so the band can say "not set up" before anyone
         * drags a file in, rather than after a round trip that was never going
         * to work. `isScanConfigured` is server-only, which is what keeps the
         * key itself on this side of the boundary.
         */
        scanAvailable={isScanConfigured()}
        /*
         * Passed explicitly rather than inferred from `invoice:create`. CLERK
         * happens to hold both today, but deriving one permission from another
         * is how a matrix drifts into being quietly wrong.
         */
        canAddVendor={can(user, "vendor:manage")}
      />
    </>
  );
}
