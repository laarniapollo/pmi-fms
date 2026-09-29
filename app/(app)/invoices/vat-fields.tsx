"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { centsToInput, formatCents, parseCents } from "@/lib/format";
import { VAT_RATE, VAT_TYPE_META, VAT_TYPE_ORDER, isVatType, type VatType } from "@/lib/constants";
import { computeVatBreakdown, type VatBreakdown } from "@/lib/tax/vat";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField, Input, Select } from "@/components/ui/input";

export interface VatDefaults {
  vatType?: VatType;
  /**
   * How the type was arrived at when the form was prefilled from a scan. The
   * badge it earns disappears the moment a person picks a type themselves.
   */
  vatTypeSource?: "read" | "inferred";
  taxCents?: number;
  /**
   * Whether `taxCents` is what the document printed (or what was saved) or
   * what we worked out. A computed figure is labelled as such, so nobody
   * submits an invented tax figure believing the supplier billed it.
   */
  taxSource?: "read" | "computed";
  vatableSalesCents?: number;
  zeroRatedSalesCents?: number;
  exemptSalesCents?: number;
  supplierTin?: string;
  vatExemptionBasis?: string;
}

export interface VatState {
  vatType: VatType | "";
  /** Null while no type is chosen: there is no honest breakdown to show yet. */
  breakdown: VatBreakdown | null;
  /** True when the VAT figure is the rate's answer rather than a keyed or printed one. */
  taxComputed: boolean;
  view: VatView;
}

interface VatView {
  typeTouched: boolean;
  setType: (next: VatType | "") => void;
  taxValue: string;
  onTaxChange: (value: string) => void;
  buckets: Buckets;
  setBucket: (key: keyof Buckets, value: string) => void;
  tinValue: string;
  onTinChange: (value: string) => void;
  exemptionBasis: string;
  setExemptionBasis: (value: string) => void;
}

interface Buckets {
  vatable: string;
  zeroRated: string;
  exempt: string;
}

const toInput = (cents: number | undefined) => (cents === undefined ? "" : centsToInput(cents));

/**
 * The VAT side of the invoice form, as state. Lives in the form component
 * because the Totals card reads the same breakdown the VAT card edits.
 *
 * Like the rest of the form it reads `defaults` only on mount — a new scan
 * remounts the form rather than pushing new values into it.
 */
export function useVat({
  defaults,
  subtotalCents,
  vendorTin,
}: {
  defaults: VatDefaults;
  subtotalCents: number;
  vendorTin: string | null;
}): VatState {
  const [vatType, setVatType] = useState<VatType | "">(defaults.vatType ?? "");
  const [typeTouched, setTypeTouched] = useState(false);

  const [taxInput, setTaxInput] = useState(defaults.taxCents ? centsToInput(defaults.taxCents) : "");
  const [taxTouched, setTaxTouched] = useState(false);

  const [buckets, setBuckets] = useState<Buckets>({
    vatable: toInput(defaults.vatableSalesCents),
    zeroRated: toInput(defaults.zeroRatedSalesCents),
    exempt: toInput(defaults.exemptSalesCents),
  });

  const [tin, setTin] = useState(defaults.supplierTin ?? "");
  const [tinTouched, setTinTouched] = useState(false);
  const [exemptionBasis, setExemptionBasis] = useState(defaults.vatExemptionBasis ?? "");

  /*
   * Which VAT figure stands, derived on every render and never pushed into
   * state (the render loop that an effect here produces is not hypothetical):
   *
   *   - once someone types in the box, theirs;
   *   - else a printed or saved figure above zero;
   *   - else the rate's answer, badged "Computed".
   *
   * A printed or saved zero does not stand once the type bears VAT. It was the
   * right figure for a non-VAT sale; carried onto a VATable one it would
   * silently record no tax on a sale that owes it.
   */
  const standingTax =
    defaults.taxSource !== "computed" && defaults.taxCents !== undefined && defaults.taxCents > 0
      ? defaults.taxCents
      : null;
  const keyedTax = taxTouched ? (parseCents(taxInput) ?? 0) : standingTax;

  const breakdown = vatType
    ? computeVatBreakdown({
        vatType,
        subtotalCents,
        vatableCents: parseCents(buckets.vatable),
        zeroRatedCents: parseCents(buckets.zeroRated),
        exemptCents: parseCents(buckets.exempt),
        taxCents: keyedTax,
      })
    : null;

  const taxable = vatType ? VAT_TYPE_META[vatType].taxable : false;
  const taxComputed = taxable && keyedTax === null;
  const taxValue = taxTouched ? taxInput : breakdown ? centsToInput(breakdown.taxCents) : "";

  // The supplier's TIN on file follows the vendor picker until someone types
  // over it. A TIN read off the document outranks the one on file: a branch
  // can bill under its own code.
  const tinValue = tinTouched ? tin : (defaults.supplierTin ?? vendorTin ?? "");

  return {
    vatType,
    breakdown,
    taxComputed,
    view: {
      typeTouched,
      setType: (next) => {
        setTypeTouched(true);
        setVatType(next);
        // A fresh mixed sale starts with everything VATable, so the person
        // only has to move the part that is not.
        if (next === "MIXED" && !buckets.vatable && !buckets.zeroRated && !buckets.exempt) {
          setBuckets({ vatable: centsToInput(subtotalCents), zeroRated: "", exempt: "" });
        }
      },
      taxValue,
      onTaxChange: (value) => {
        setTaxTouched(true);
        setTaxInput(value);
      },
      buckets,
      setBucket: (key, value) => setBuckets((current) => ({ ...current, [key]: value })),
      tinValue,
      onTinChange: (value) => {
        setTinTouched(true);
        setTin(value);
      },
      exemptionBasis,
      setExemptionBasis,
    },
  };
}

/**
 * The VAT card: the type picker and whatever that type needs.
 *
 * The picker is controlled but carries no `name`; the hidden input is what
 * posts. That follows the rest of the app (see add-vendor.tsx) against React
 * 19's post-action form reset, which does not re-apply a controlled select's
 * value. The invoice form also opts out of that reset — see its onSubmit.
 */
export function VatCard({
  vat,
  subtotalCents,
  source,
  scanned,
  lowConfidence,
  fieldErrors,
}: {
  vat: VatState;
  subtotalCents: number;
  source: VatDefaults["vatTypeSource"];
  /** Whether the form was prefilled from a scan, which is what an empty type is then a failure of. */
  scanned: boolean;
  lowConfidence: ReadonlySet<string>;
  fieldErrors?: Record<string, string>;
}) {
  const { vatType, breakdown, taxComputed, view } = vat;
  const meta = vatType ? VAT_TYPE_META[vatType] : null;
  const shownSource = view.typeTouched ? undefined : source;
  const undetermined = !vatType;
  // Amber only when a scan left it blank or unsure. An empty picker on a form
  // typed by hand is just a question nobody has answered yet.
  const typeFlagged = !view.typeTouched && scanned && (undetermined || lowConfidence.has("vatType"));

  const mixedSum =
    (parseCents(view.buckets.vatable) ?? 0) +
    (parseCents(view.buckets.zeroRated) ?? 0) +
    (parseCents(view.buckets.exempt) ?? 0);
  const mixedOff = vatType === "MIXED" && mixedSum !== subtotalCents;

  return (
    <Card>
      <CardHeader
        title="VAT"
        description="How this sale is treated for VAT"
        action={
          shownSource === "read" ? (
            <Badge tone="info">Read from document</Badge>
          ) : shownSource === "inferred" ? (
            <Badge tone="info">Inferred from document</Badge>
          ) : null
        }
      />

      <input type="hidden" name="vatType" value={vatType} />
      <input type="hidden" name="taxCents" value={String(breakdown?.taxCents ?? 0)} />
      {vatType === "MIXED" && breakdown ? (
        <>
          <input type="hidden" name="vatableSalesCents" value={String(breakdown.vatableSalesCents)} />
          <input type="hidden" name="zeroRatedSalesCents" value={String(breakdown.zeroRatedSalesCents)} />
          <input type="hidden" name="exemptSalesCents" value={String(breakdown.exemptSalesCents)} />
        </>
      ) : null}

      <CardBody className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="VAT type"
          htmlFor="vat-type"
          required
          error={fieldErrors?.vatType}
          hint={
            undetermined
              ? scanned
                ? "Couldn’t tell from the document — choose one"
                : "Choose how this sale is treated for VAT"
              : typeFlagged
                ? "Scan was unsure — please check"
                : meta?.hint
          }
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={vatType}
              invalid={Boolean(fieldErrors?.vatType)}
              className={cn(typeFlagged && "border-warn")}
              onChange={(event) => {
                const next = event.target.value;
                view.setType(isVatType(next) ? next : "");
              }}
            >
              <option value="">Choose a VAT type…</option>
              {VAT_TYPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {VAT_TYPE_META[type].label}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {vatType ? (
          <FormField
            label="Supplier TIN"
            required={meta?.tinRequired}
            error={fieldErrors?.supplierTin}
            hint={
              lowConfidence.has("supplierTin") && !fieldErrors?.supplierTin
                ? "Scan was unsure — please check"
                : !meta?.tinRequired
                  ? "Optional for this type"
                  : "As printed on the invoice, with the branch code"
            }
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="supplierTin"
                aria-describedby={describedBy}
                value={view.tinValue}
                placeholder="123-456-789-00000"
                className={cn("ident", lowConfidence.has("supplierTin") && "border-warn")}
                invalid={Boolean(fieldErrors?.supplierTin)}
                onChange={(event) => view.onTinChange(event.target.value)}
              />
            )}
          </FormField>
        ) : null}

        {vatType === "EXEMPT" ? (
          <FormField label="Exemption basis" hint="The Tax Code provision the supplier cites, if any">
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="vatExemptionBasis"
                aria-describedby={describedBy}
                value={view.exemptionBasis}
                placeholder="Sec. 109(1)(A)"
                onChange={(event) => view.setExemptionBasis(event.target.value)}
              />
            )}
          </FormField>
        ) : null}

        {undetermined ? (
          <p className="self-end pb-1.5 text-xs text-ink-subtle sm:col-span-1">
            Its fields appear here once a type is chosen.
          </p>
        ) : null}

        {vatType === "MIXED" ? (
          <div className="space-y-2 sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-3">
              <BucketInput label="VATable sales" value={view.buckets.vatable} flagged={mixedOff || lowConfidence.has("vatBreakdown")} onChange={(value) => view.setBucket("vatable", value)} />
              <BucketInput label="Zero-rated sales" value={view.buckets.zeroRated} flagged={mixedOff || lowConfidence.has("vatBreakdown")} onChange={(value) => view.setBucket("zeroRated", value)} />
              <BucketInput label="VAT-exempt sales" value={view.buckets.exempt} flagged={mixedOff || lowConfidence.has("vatBreakdown")} onChange={(value) => view.setBucket("exempt", value)} />
            </div>
            {fieldErrors?.vatBreakdown ? (
              <p className="text-xs text-danger">{fieldErrors.vatBreakdown}</p>
            ) : (
              <p className={cn("text-xs", mixedOff ? "text-warn" : "text-ink-subtle")}>
                Adds up to {formatCents(mixedSum)} of {formatCents(subtotalCents)} subtotal
                {mixedOff ? " — the three must account for every line" : ""}
              </p>
            )}
          </div>
        ) : null}

        {vatType && vatType !== "MIXED" && vatType !== "NON_VAT" && breakdown ? (
          <ReadOnlyAmount
            label={vatType === "VATABLE" ? "VATable sales" : vatType === "ZERO_RATED" ? "Zero-rated sales" : "VAT-exempt sales"}
            cents={subtotalCents}
            hint="The whole subtotal"
          />
        ) : null}

        {vatType === "NON_VAT" ? (
          <p className="self-end pb-1.5 text-xs text-ink-subtle">
            Supplier not VAT-registered — no VAT is billed, and none can be claimed as input tax.
          </p>
        ) : null}

        {vatType && meta?.taxable ? (
          <FormField
            label={vatType === "MIXED" ? `VAT (${Math.round(VAT_RATE * 100)}% of VATable sales)` : `VAT (${Math.round(VAT_RATE * 100)}%)`}
            htmlFor="tax-input"
            hint={
              taxComputed
                ? "Worked out at the rate. Type over it if the supplier billed something else."
                : "What the supplier billed, not what the rate would give"
            }
            className={cn(vatType === "MIXED" && "sm:col-start-1")}
          >
            {({ id, describedBy }) => (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputSize="md"
                  leading="₱"
                  inputMode="decimal"
                  value={view.taxValue}
                  placeholder="0.00"
                  className={cn("text-right", lowConfidence.has("taxCents") && "border-warn")}
                  onChange={(event) => view.onTaxChange(event.target.value)}
                />
                {/* `info`, not `warn`. Amber here means the scan was unsure of
                    something it read; a computed VAT is a deliberate
                    substitution, and reusing amber would blunt the marks
                    that matter. */}
                {taxComputed ? <Badge tone="info">Computed</Badge> : null}
              </div>
            )}
          </FormField>
        ) : vatType ? (
          <ReadOnlyAmount label="VAT" cents={0} hint="None is billed on this type of sale" />
        ) : null}
      </CardBody>
    </Card>
  );
}

function BucketInput({
  label,
  value,
  flagged,
  onChange,
}: {
  label: string;
  value: string;
  flagged: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label}>
      {({ id }) => (
        <Input
          id={id}
          leading="₱"
          inputMode="decimal"
          value={value}
          placeholder="0.00"
          className={cn("text-right", flagged && "border-warn")}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

function ReadOnlyAmount({ label, cents, hint }: { label: string; cents: number; hint: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-ink-muted">{label}</p>
      <p className="flex h-8 items-center rounded border border-line bg-canvas px-2.5 text-sm tabular-nums text-ink">
        {formatCents(cents)}
      </p>
      <p className="mt-1 text-xs text-ink-subtle">{hint}</p>
    </div>
  );
}
