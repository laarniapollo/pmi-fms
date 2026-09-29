"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { InvoicePdfData } from "@/lib/export/invoice-pdf";

/**
 * Builds the invoice PDF on demand.
 *
 * jsPDF is loaded lazily — it is ~350 KB and only matters the moment someone
 * asks for a document, so it has no business in the bundle for every screen.
 */
export function DownloadPdf({ data }: { data: InvoicePdfData }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const download = async () => {
    setBusy(true);
    try {
      const { buildInvoicePdf } = await import("@/lib/export/invoice-pdf");
      buildInvoicePdf(data).save(`${data.invoiceNumber}.pdf`);
      toast.success("PDF downloaded", `${data.invoiceNumber}.pdf`);
    } catch {
      toast.error("Could not build the PDF", "Try again, or export the list as CSV instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="secondary" size="md" loading={busy} onClick={() => void download()}>
      <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
      {busy ? "Building" : "PDF"}
    </Button>
  );
}
