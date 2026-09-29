"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SCALAR_FIELDS, type ExtractedInvoice, type ScanResponse } from "@/lib/extract/types";
import { resolveTax, resolveVatType } from "@/lib/extract/vat";
import { hasEdits, snapshotForm, type FormSnapshot } from "@/lib/forms/form-diff";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { AddVendorDialog } from "@/app/(app)/vendors/add-vendor";
import {
  InvoiceForm,
  type InvoiceDefaults,
  type VendorChoice,
} from "@/app/(app)/invoices/invoice-form";
import { ScanBand, type ScanStatus } from "./scan-band";

/**
 * `useLayoutEffect` warns when it runs during server rendering, where it does
 * nothing. This component is server-rendered before it hydrates, so the choice
 * has to be made per environment.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface PendingScan {
  file: File;
  extracted: ExtractedInvoice;
  model: string;
}

/**
 * `/invoices/new`: the dropzone and the invoice form, on one page.
 *
 * Scanning is a shortcut for filling in a form you were going to fill in
 * anyway, not a separate mode you commit to up front — so there are no tabs and
 * no review screen. Upload, and the fields below fill in place.
 *
 * The extraction never has to survive a navigation, which is what makes this
 * simple: the previous two-tab design needed a mode state machine, a history
 * rewrite to keep `?mode=scan` honest, and tabs that could not be links because
 * following one would have destroyed the in-memory File.
 */
export function NewInvoiceWorkspace({
  vendors: initialVendors,
  scanAvailable,
  canAddVendor,
}: {
  vendors: VendorChoice[];
  /** Known from the server before a file is ever dragged. */
  scanAvailable: boolean;
  canAddVendor: boolean;
}) {
  const [vendors, setVendors] = useState(initialVendors);
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedInvoice | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [addingVendor, setAddingVendor] = useState<string | null>(null);
  const [chosenVendorId, setChosenVendorId] = useState<string | null>(null);

  /*
   * `InvoiceForm` reads its defaults in `useState` initialisers, so it only
   * takes new values on a fresh mount. This counter is that mount key, and it
   * is bumped only when an extraction is actually applied — keying on the
   * defaults object instead would remount the form every time a vendor was
   * added mid-edit and throw away everything typed.
   */
  const [scanId, setScanId] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const formHostRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<FormSnapshot | null>(null);

  /*
   * Re-taken after every remount, so a second scan is compared against the form
   * as the first one left it rather than against the original blank.
   *
   * A *layout* effect, not a passive one, and that is the whole point. A
   * passive effect runs after paint, which leaves a window where the form is
   * on screen and typeable but the baseline has not been recorded yet —
   * anything typed in that window gets folded into the baseline, the form then
   * looks pristine, and the next scan overwrites the person's work without
   * asking. That window is invisible on a fast production build and wide
   * enough to reproduce every time under `next dev`.
   */
  useIsomorphicLayoutEffect(() => {
    const form = formHostRef.current?.querySelector("form");
    baselineRef.current = form ? snapshotForm(new FormData(form)) : null;
  }, [scanId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const formHasEdits = useCallback(() => {
    const form = formHostRef.current?.querySelector("form");
    const baseline = baselineRef.current;
    if (!form || !baseline) return false;
    return hasEdits(baseline, new FormData(form));
  }, []);

  const apply = useCallback((next: ExtractedInvoice, usedModel: string) => {
    setExtracted(next);
    setModel(usedModel);
    setChosenVendorId(null);
    setPendingScan(null);
    setStatus("done");
    setMessage(null);
    setScanId((current) => current + 1);
  }, []);

  const scan = useCallback(
    async (uploaded: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPendingScan(null);
      setMessage(null);
      setStatus("scanning");
      // Attached straight away: however the read goes, the invoice keeps its
      // source document rather than asking for the same file a second time.
      setFile(uploaded);

      try {
        const body = new FormData();
        body.append("file", uploaded);

        const response = await fetch("/api/scan", {
          method: "POST",
          body,
          signal: controller.signal,
        });
        const payload = (await response.json()) as ScanResponse;

        if (!payload.ok) {
          setStatus("failed");
          setMessage(payload.message);
          return;
        }

        // Filling silently is right only when there is nothing to overwrite.
        if (formHasEdits()) {
          setPendingScan({ file: uploaded, extracted: payload.extracted, model: payload.model });
          // The read is finished, so the band stops saying otherwise. Nothing
          // has been applied yet, so it shows the attached file and no counts.
          setStatus("done");
          return;
        }

        apply(payload.extracted, payload.model);
      } catch {
        if (controller.signal.aborted) return;
        setStatus("failed");
        setMessage("Could not reach the scanning service. Fill the form in below.");
      }
    },
    [apply, formHasEdits],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    // A cancel is a decision, not a failure — so the file goes too.
    setStatus("idle");
    setFile(null);
    setMessage(null);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setFile(null);
    setMessage(null);
    setPendingScan(null);
  }, []);

  const keepTyped = useCallback(() => {
    setPendingScan(null);
    setStatus("done");
    setMessage("Your entries were kept. The document is still attached to this draft.");
  }, []);

  const defaults = extracted
    ? toDefaults(extracted, model, chosenVendorId)
    : undefined;

  const readCount = extracted ? countRead(extracted) : null;

  return (
    <div className="space-y-3">
      <ScanBand
        available={scanAvailable}
        status={status}
        file={file}
        error={message}
        readCount={readCount}
        fieldCount={SCALAR_FIELDS.length}
        lineItemCount={extracted?.lineItems.length ?? 0}
        onFile={(uploaded) => void scan(uploaded)}
        onCancel={cancel}
        onReset={reset}
      />

      <div ref={formHostRef}>
        <InvoiceForm
          key={scanId}
          mode="create"
          vendors={vendors}
          defaults={defaults}
          scanFile={file}
          onAddVendor={canAddVendor ? (name) => setAddingVendor(name) : undefined}
        />
      </div>

      <Modal
        open={pendingScan !== null}
        onClose={keepTyped}
        title="Replace what you have filled in?"
        description="This form already has details in it. Using the scan will replace them with what the document says."
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={keepTyped}>
              Keep what I typed
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => pendingScan && apply(pendingScan.extracted, pendingScan.model)}
            >
              Replace
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Either way the document stays attached to this draft, so the invoice keeps its source
          even if you keep your own figures.
        </p>
      </Modal>

      {canAddVendor ? (
        <AddVendorDialog
          open={addingVendor !== null}
          onClose={() => setAddingVendor(null)}
          initialName={addingVendor ?? ""}
          onCreated={(vendor) => {
            setAddingVendor(null);
            // The inline dialog does not ask for a TIN, so there is none on file yet.
            setVendors((current) => [...current, { ...vendor, taxId: null }]);

            // Selecting it needs a remount, which discards the form — so it is
            // only done when there is nothing to discard. Otherwise the new
            // option is simply there in the dropdown to be picked.
            if (extracted && !formHasEdits()) {
              setChosenVendorId(vendor.id);
              setScanId((current) => current + 1);
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** How many of the scalar fields the document actually carried a value for. */
function countRead(extracted: ExtractedInvoice): number {
  return SCALAR_FIELDS.filter((name) => extracted[name].value !== null).length;
}

function toDefaults(
  extracted: ExtractedInvoice,
  model: string | null,
  chosenVendorId: string | null,
): InvoiceDefaults {
  /*
   * The 12% lives here rather than in the extraction module. "What does the
   * document say" and "what do we do when it says nothing" are different jobs,
   * and putting the second in the extractor would have it invent a figure —
   * the exact thing the model is instructed never to do.
   */
  const vat = resolveVatType(extracted);
  const tax = resolveTax({
    taxCents: extracted.taxCents.value,
    subtotalCents: extracted.subtotalCents.value,
    vatType: vat.vatType ?? null,
    vatableSalesCents: extracted.vatableSalesCents.value,
  });

  const vendorId = chosenVendorId ?? extracted.matchedVendorId;

  return {
    vendorId: vendorId ?? undefined,
    // Kept only while nothing matched, so the clerk sees the name that was read
    // instead of an unexplained empty dropdown.
    readVendorName: vendorId ? undefined : (extracted.vendorName.value ?? undefined),
    invoiceNumber: extracted.invoiceNumber.value ?? undefined,
    poNumber: extracted.poNumber.value ?? undefined,
    issueDate: extracted.issueDate.value ?? undefined,
    dueDate: extracted.dueDate.value ?? undefined,
    taxCents: tax.taxCents,
    taxSource: tax.source,
    vatType: vat.vatType,
    vatTypeSource: vat.source,
    vatableSalesCents: extracted.vatableSalesCents.value ?? undefined,
    zeroRatedSalesCents: extracted.zeroRatedSalesCents.value ?? undefined,
    exemptSalesCents: extracted.exemptSalesCents.value ?? undefined,
    supplierTin: extracted.supplierTin.value ?? undefined,
    readTotalCents: extracted.totalCents.value ?? undefined,
    lineItems: extracted.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      glAccount: null,
    })),
    ocrConfidence: extracted.overallConfidence,
    /*
     * The evidence trail. This column held the text the machine saw, which was
     * searchable and was what an auditor went back to; a model returns JSON
     * instead, so the whole reading is stored, model id included. Without this
     * the column would quietly go empty and nobody would notice until it was
     * needed.
     */
    ocrRawText: JSON.stringify({ model, extracted }),
    // The vendor stops being flagged once it has been matched to one on file.
    lowConfidenceFields: extracted.lowConfidenceFields.filter(
      (name) => !(name === "vendorName" && vendorId),
    ),
  };
}
