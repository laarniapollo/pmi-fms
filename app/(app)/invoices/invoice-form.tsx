"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, GripVertical, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { centsToInput, formatCents, parseCents, toDateInput } from "@/lib/format";
import { GL_ACCOUNTS, COST_CENTERS } from "@/lib/form-options";
import { PAYMENT_TERMS_META, VAT_TYPE_META, type PaymentTerms } from "@/lib/constants";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { createInvoice, updateInvoice, type InvoiceFormState } from "./actions";
import { useVat, VatCard, type VatDefaults } from "./vat-fields";

export interface VendorChoice {
  id: string;
  name: string;
  paymentTerms: string;
  category: string;
  taxId: string | null;
}

export interface LineItemDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  glAccount: string;
}

export interface InvoiceDefaults extends VatDefaults {
  id?: string;
  vendorId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  poNumber?: string;
  description?: string;
  glAccount?: string;
  costCenter?: string;
  lineItems?: Array<{ description: string; quantity: number; unitPriceCents: number; glAccount: string | null }>;
  /**
   * The supplier name read off the document when it matched nothing on file.
   * Kept so the clerk can see what was read rather than an empty dropdown.
   */
  readVendorName?: string;
  /**
   * The total printed on the document, kept only to be compared against the
   * one these lines add up to. Never used as a value — the form's total is
   * always its own arithmetic.
   */
  readTotalCents?: number;
  /** Present when the form was prefilled from a scan. */
  ocrConfidence?: number | null;
  ocrRawText?: string | null;
  /** Fields the scan was unsure about, so they can be flagged for checking. */
  lowConfidenceFields?: string[];
}

let keyCounter = 0;
const nextKey = () => `line-${keyCounter++}`;

function emptyLine(): LineItemDraft {
  return { key: nextKey(), description: "", quantity: "1", unitPrice: "", glAccount: "" };
}

/**
 * The create and edit surface.
 *
 * Line items live in React state and are posted as one JSON field, which keeps
 * a variable-length list out of flat form-data naming schemes. The running
 * total shown here is for the person typing — the server recomputes it from
 * the same lines and stores its own answer.
 */
export function InvoiceForm({
  mode,
  vendors,
  defaults,
  scanFile,
  onAddVendor,
}: {
  mode: "create" | "edit";
  vendors: VendorChoice[];
  defaults?: InvoiceDefaults;
  /** The document this draft was scanned from — attached on save. */
  scanFile?: File | null;
  /** Offered when a scanned supplier matches nothing already on file. */
  onAddVendor?: (name: string) => void;
}) {
  const action = mode === "create" ? createInvoice : updateInvoice;
  const [state, formAction, pending] = useActionState<InvoiceFormState, FormData>(action, {});

  const [vendorId, setVendorId] = useState(defaults?.vendorId ?? "");
  const [issueDate, setIssueDate] = useState(defaults?.issueDate ?? toDateInput(new Date()));
  const [dueDate, setDueDate] = useState(defaults?.dueDate ?? "");

  const [lines, setLines] = useState<LineItemDraft[]>(() =>
    defaults?.lineItems?.length
      ? defaults.lineItems.map((line) => ({
          key: nextKey(),
          description: line.description,
          quantity: String(line.quantity),
          unitPrice: centsToInput(line.unitPriceCents),
          glAccount: line.glAccount ?? "",
        }))
      : [emptyLine()],
  );

  const lowConfidence = new Set(defaults?.lowConfidenceFields ?? []);
  const linesFlagged = lowConfidence.has("lineItems");

  const subtotalCents = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const quantity = Number(line.quantity) || 0;
        const unit = parseCents(line.unitPrice) ?? 0;
        return sum + Math.round(quantity * unit);
      }, 0),
    [lines],
  );

  const selectedVendor = vendors.find((vendor) => vendor.id === vendorId);

  const vat = useVat({
    defaults: defaults ?? {},
    subtotalCents,
    vendorTin: selectedVendor?.taxId ?? null,
  });
  const breakdown = vat.breakdown;
  const totalCents = subtotalCents + (breakdown?.taxCents ?? 0);

  /** The read supplier name, only while the dropdown is still empty. */
  const unmatchedVendor = defaults?.readVendorName && !vendorId ? defaults.readVendorName : null;

  const totalDisagrees =
    defaults?.readTotalCents !== undefined &&
    Math.abs(defaults.readTotalCents - totalCents) > 2;

  /** Applying the vendor's terms saves keying a date that is entirely derivable. */
  const applyTerms = (nextVendorId: string, from: string) => {
    const vendor = vendors.find((candidate) => candidate.id === nextVendorId);
    if (!vendor || !from) return;
    const days = PAYMENT_TERMS_META[vendor.paymentTerms as PaymentTerms]?.days ?? 30;
    const due = new Date(from);
    due.setDate(due.getDate() + days);
    setDueDate(toDateInput(due));
  };

  const serialisedLines = JSON.stringify(
    lines.map((line) => ({
      description: line.description.trim(),
      quantity: Number(line.quantity) || 0,
      unitPriceCents: parseCents(line.unitPrice) ?? 0,
      glAccount: line.glAccount || null,
    })),
  );

  return (
    /*
     * Submitted through onSubmit rather than `action={formAction}`, on purpose.
     * With `action`, React 19 resets the form's DOM once the action settles —
     * on a failed save too. Verified in a browser: that blanked both pickers
     * while their hidden inputs still held the real values (the screen no
     * longer matched what would be saved), reverted hand-typed fields to their
     * prefilled values, and emptied the scanned file's input. Dispatching the
     * same action in a transition keeps `pending` and skips the reset. Success
     * redirects, so there is nothing left on screen that a reset would clear.
     */
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <input type="hidden" name="lineItems" value={serialisedLines} />
      {/* The vendor picker is controlled and carries no `name`; this posts.
          Same pattern as the VAT picker — see the note in vat-fields.tsx. */}
      <input type="hidden" name="vendorId" value={vendorId} />
      {defaults?.ocrConfidence ? (
        <input type="hidden" name="ocrConfidence" value={String(defaults.ocrConfidence)} />
      ) : null}
      {defaults?.ocrRawText ? (
        <input type="hidden" name="ocrRawText" value={defaults.ocrRawText} />
      ) : null}

      {/* The scanned document rides along with the form so the saved invoice
          arrives with its source attached, rather than asking the clerk to
          upload the same file a second time. */}
      {scanFile ? <ScanFileInput file={scanFile} /> : null}

      {state.error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="text-sm text-danger">
            <p>{state.error}</p>
            {state.duplicateId ? (
              <Link
                href={`/invoices/${state.duplicateId}`}
                className="mt-0.5 inline-block font-medium underline"
              >
                Open the existing invoice
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <Card>
            <CardHeader title="Invoice details" />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Vendor"
                // Stable ids on the pickers are what scripts/check-*.mjs drive.
                htmlFor="invoice-vendor"
                error={state.fieldErrors?.vendorId}
                hint={
                  unmatchedVendor
                    ? `The document says “${unmatchedVendor}”, which matches no vendor on file.`
                    : undefined
                }
                required
                className="sm:col-span-2"
              >
                {({ id }) => (
                  <>
                    <Select
                      id={id}
                      value={vendorId}
                      invalid={Boolean(state.fieldErrors?.vendorId)}
                      className={cn(unmatchedVendor && "border-warn")}
                      onChange={(event) => {
                        setVendorId(event.target.value);
                        applyTerms(event.target.value, issueDate);
                      }}
                    >
                      <option value="">Choose a vendor…</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name} · {PAYMENT_TERMS_META[vendor.paymentTerms as PaymentTerms]?.label ?? vendor.paymentTerms}
                        </option>
                      ))}
                    </Select>

                    {/* Left blank rather than guessed: picking the closest name
                        would decide which supplier gets paid on a resemblance. */}
                    {unmatchedVendor && onAddVendor ? (
                      <button
                        type="button"
                        onClick={() => onAddVendor(unmatchedVendor)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        Add “{unmatchedVendor}” as a vendor
                      </button>
                    ) : null}
                  </>
                )}
              </FormField>

              <FormField
                label="Invoice number"
                error={state.fieldErrors?.invoiceNumber}
                hint={lowConfidence.has("invoiceNumber") ? "Scan was unsure — please check" : undefined}
                required
              >
                {({ id }) => (
                  <Input
                    id={id}
                    name="invoiceNumber"
                    defaultValue={defaults?.invoiceNumber}
                    placeholder="INV-2026-0184"
                    className={cn("ident", lowConfidence.has("invoiceNumber") && "border-warn")}
                    invalid={Boolean(state.fieldErrors?.invoiceNumber)}
                  />
                )}
              </FormField>

              <FormField
                label="PO number"
                hint={lowConfidence.has("poNumber") ? "Scan was unsure — please check" : undefined}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    name="poNumber"
                    defaultValue={defaults?.poNumber}
                    placeholder="PO-48221"
                    className={cn("ident", lowConfidence.has("poNumber") && "border-warn")}
                  />
                )}
              </FormField>

              <FormField
                label="Issue date"
                error={state.fieldErrors?.issueDate}
                hint={lowConfidence.has("issueDate") ? "Scan was unsure — please check" : undefined}
                required
              >
                {({ id }) => (
                  <Input
                    id={id}
                    name="issueDate"
                    type="date"
                    value={issueDate}
                    invalid={Boolean(state.fieldErrors?.issueDate)}
                    className={cn(lowConfidence.has("issueDate") && "border-warn")}
                    onChange={(event) => {
                      setIssueDate(event.target.value);
                      if (!dueDate) applyTerms(vendorId, event.target.value);
                    }}
                  />
                )}
              </FormField>

              <FormField
                label="Due date"
                error={state.fieldErrors?.dueDate}
                hint={
                  lowConfidence.has("dueDate")
                    ? "Scan was unsure — please check"
                    : selectedVendor && dueDate
                      ? `${PAYMENT_TERMS_META[selectedVendor.paymentTerms as PaymentTerms]?.label ?? ""} from issue`
                      : undefined
                }
                required
              >
                {({ id }) => (
                  <Input
                    id={id}
                    name="dueDate"
                    type="date"
                    value={dueDate}
                    invalid={Boolean(state.fieldErrors?.dueDate)}
                    className={cn(lowConfidence.has("dueDate") && "border-warn")}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                )}
              </FormField>

              <FormField label="Description" className="sm:col-span-2">
                {({ id }) => (
                  <Textarea
                    id={id}
                    name="description"
                    rows={2}
                    defaultValue={defaults?.description}
                    placeholder="What this invoice covers, in a line."
                  />
                )}
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Line items"
              description="What the vendor is billing for"
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setLines((current) => [...current, emptyLine()])}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add line
                </Button>
              }
            />

            {state.fieldErrors?.lineItems ? (
              <p className="border-b border-line bg-danger-soft px-4 py-2 text-xs text-danger">
                {state.fieldErrors.lineItems}
              </p>
            ) : null}

            {/* Not a validation error — the rows may well be right and the
                printed subtotal misread. It is a prompt to look, which is the
                one thing the old review screen never actually offered. */}
            {linesFlagged ? (
              <p className="border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
                These rows do not add up to the subtotal printed on the document. Check for a line
                that was missed or misread.
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-line bg-surface-sunken">
                    <th className="col-head w-8 px-2 py-1.5" />
                    <th className="col-head px-2 py-1.5 text-left">Description</th>
                    <th className="col-head w-20 px-2 py-1.5 text-right">Qty</th>
                    <th className="col-head w-36 px-2 py-1.5 text-right">Unit price</th>
                    <th className="col-head w-36 px-2 py-1.5 text-right">Amount</th>
                    <th className="col-head w-10 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const quantity = Number(line.quantity) || 0;
                    const unit = parseCents(line.unitPrice) ?? 0;
                    const amount = Math.round(quantity * unit);

                    return (
                      <tr key={line.key} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1.5 text-center">
                          <GripVertical className="mx-auto h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            inputSize="sm"
                            aria-label={`Line ${index + 1} description`}
                            value={line.description}
                            placeholder="Consultant hours — March"
                            onChange={(event) =>
                              setLines((current) =>
                                current.map((item) =>
                                  item.key === line.key
                                    ? { ...item, description: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            inputSize="sm"
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`Line ${index + 1} quantity`}
                            value={line.quantity}
                            className="text-right"
                            onChange={(event) =>
                              setLines((current) =>
                                current.map((item) =>
                                  item.key === line.key
                                    ? { ...item, quantity: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            inputSize="sm"
                            leading="₱"
                            inputMode="decimal"
                            aria-label={`Line ${index + 1} unit price`}
                            value={line.unitPrice}
                            placeholder="0.00"
                            className={cn("text-right", linesFlagged && "border-warn")}
                            onChange={(event) =>
                              setLines((current) =>
                                current.map((item) =>
                                  item.key === line.key
                                    ? { ...item, unitPrice: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right text-sm tabular-nums text-ink">
                          {formatCents(amount)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            aria-label={`Remove line ${index + 1}`}
                            disabled={lines.length === 1}
                            onClick={() =>
                              setLines((current) => current.filter((item) => item.key !== line.key))
                            }
                            className="rounded p-1 text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <VatCard
            vat={vat}
            subtotalCents={subtotalCents}
            source={defaults?.vatTypeSource}
            scanned={defaults?.ocrConfidence != null}
            lowConfidence={lowConfidence}
            fieldErrors={state.fieldErrors}
          />
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader title="Totals" />
            <CardBody className="space-y-2.5">
              <Row label="Subtotal" value={formatCents(subtotalCents)} />

              {breakdown && vat.vatType === "MIXED" ? (
                <>
                  {breakdown.vatableSalesCents ? <Row label="VATable sales" value={formatCents(breakdown.vatableSalesCents)} muted /> : null}
                  {breakdown.zeroRatedSalesCents ? <Row label="Zero-rated sales" value={formatCents(breakdown.zeroRatedSalesCents)} muted /> : null}
                  {breakdown.exemptSalesCents ? <Row label="VAT-exempt sales" value={formatCents(breakdown.exemptSalesCents)} muted /> : null}
                </>
              ) : null}

              <Row
                label={vat.vatType ? `VAT · ${VAT_TYPE_META[vat.vatType].label}` : "VAT"}
                value={breakdown ? formatCents(breakdown.taxCents) : "—"}
              />

              <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
                <span className="text-sm font-medium text-ink">Total</span>
                <span className="text-lg font-semibold tabular-nums text-ink">
                  {formatCents(totalCents)}
                </span>
              </div>

              {/* Not an error and not a block — the lines may be right and the
                  printed total misread, or the supplier may have applied a
                  discount that is not on any row. Either way it is worth a
                  look before this goes for approval, because the total is the
                  figure an approver actually acts on. */}
              {totalDisagrees ? (
                <p className="text-2xs text-warn">
                  The document says {formatCents(defaults?.readTotalCents ?? 0)}. These lines add
                  up to {formatCents(totalCents)}.
                </p>
              ) : null}

              <p className="text-2xs text-ink-subtle">
                The approval route is chosen from this total when you submit.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Coding" description="Where this lands in the ledger" />
            <CardBody className="space-y-3">
              <FormField label="GL account">
                {({ id }) => (
                  <Select id={id} name="glAccount" defaultValue={defaults?.glAccount ?? ""}>
                    <option value="">Not set</option>
                    {GL_ACCOUNTS.map((account) => (
                      <option key={account} value={account}>
                        {account}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>

              <FormField label="Cost centre">
                {({ id }) => (
                  <Select id={id} name="costCenter" defaultValue={defaults?.costCenter ?? ""}>
                    <option value="">Not set</option>
                    {COST_CENTERS.map((centre) => (
                      <option key={centre} value={centre}>
                        {centre}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </CardBody>
          </Card>

          <div className="flex flex-col gap-2">
            <Button type="submit" variant="primary" size="lg" loading={pending} className="justify-center">
              {pending
                ? mode === "create"
                  ? "Saving draft"
                  : "Saving changes"
                : mode === "create"
                  ? "Save draft"
                  : "Save changes"}
            </Button>
            <ButtonLink
              href={defaults?.id ? `/invoices/${defaults.id}` : "/invoices"}
              variant="ghost"
              size="lg"
              className="justify-center"
            >
              Cancel
            </ButtonLink>
            <p className="text-center text-2xs text-ink-subtle">
              Saving keeps this a draft. You submit it for approval from the invoice page.
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * Carries a File that exists only in memory into the form submission.
 *
 * A file input's `files` cannot be set from a string, so the File is written
 * into a DataTransfer and assigned — the one supported way to populate an
 * input programmatically, and it keeps the upload inside the same server
 * action as the invoice rather than needing a second round trip.
 */
function ScanFileInput({ file }: { file: File }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    ref.current.files = transfer.files;
  }, [file]);

  return <input ref={ref} type="file" name="scanFile" className="sr-only" tabIndex={-1} aria-hidden="true" />;
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn("text-ink-muted", muted ? "pl-3 text-xs" : "text-sm")}>{label}</span>
      <span className={cn("tabular-nums", muted ? "text-xs text-ink-muted" : "text-sm text-ink")}>{value}</span>
    </div>
  );
}
