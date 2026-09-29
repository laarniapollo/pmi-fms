"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";

import {
  PAYMENT_METHOD_META,
  PAYMENT_TERMS_META,
  VENDOR_CATEGORIES,
  VENDOR_STATUS_META,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { createVendorInline, type CreatedVendor, type InlineVendorState } from "./actions";

const FORM_ID = "add-vendor-form";

/**
 * The trigger on the vendors list.
 *
 * Creation itself lives in `AddVendorDialog` below, because the invoice form
 * needs the same dialog without this button and without navigating anywhere
 * afterwards.
 */
export function AddVendor() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add vendor
      </Button>

      <AddVendorDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(vendor) => {
          setOpen(false);
          router.push(`/vendors/${vendor.id}`);
        }}
      />
    </>
  );
}

/**
 * Add-vendor dialog.
 *
 * Only the fields needed before an invoice can be raised against the supplier
 * are here. Addresses and bank details are not required to get one on file,
 * and a twenty-field dialog is a form wearing a dialog's clothes.
 *
 * It reports the created vendor back through `onCreated` rather than
 * navigating, so the invoice form can select the new supplier without losing a
 * half-filled draft — or the scanned document, which exists only in memory.
 */
export function AddVendorDialog({
  open,
  onClose,
  initialName = "",
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the name — the supplier read off a document, typically. */
  initialName?: string;
  onCreated?: (vendor: CreatedVendor) => void;
}) {
  const [state, formAction, pending] = useActionState<InlineVendorState, FormData>(
    createVendorInline,
    {},
  );

  const [fields, setFields] = useState({
    name: initialName,
    category: "General",
    status: "ACTIVE",
    paymentTerms: "NET_30",
    defaultPaymentMethod: "PESONET",
    email: "",
    phone: "",
  });

  // Reopening for a different supplier must not show the last one's name.
  const lastOpenedWith = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastOpenedWith.current = null;
      return;
    }
    if (lastOpenedWith.current === initialName) return;
    lastOpenedWith.current = initialName;
    setFields((current) => ({ ...current, name: initialName }));
  }, [open, initialName]);

  // The action state survives the dialog closing, so the handover is fired
  // once per created vendor rather than on every render that still sees it.
  const handedOver = useRef<string | null>(null);
  useEffect(() => {
    const created = state.created;
    if (!created || handedOver.current === created.id) return;
    handedOver.current = created.id;
    onCreated?.(created);
  }, [state.created, onCreated]);

  // The warning is only true while the name it was raised about is still the
  // one in the box: editing the name away from what was warned about clears
  // the banner, the "Add anyway" label, and the confirm token, keeping the
  // client's confirm token in step with the server's own case-insensitive
  // comparison instead of silently carrying a stale warning forward.
  const duplicate =
    state.duplicate &&
    fields.name.trim().toLowerCase() === state.duplicate.name.trim().toLowerCase()
      ? state.duplicate
      : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add vendor"
      description="A supplier you can enter invoices against."
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" size="md" loading={pending}>
            {duplicate ? "Add anyway" : pending ? "Adding" : "Add vendor"}
          </Button>
        </>
      }
    >
      <form action={formAction} id={FORM_ID} className="flex flex-col gap-3" noValidate>
        {/* Carries the name that was warned about, so editing the name
            re-runs the duplicate check rather than skipping it. */}
        {duplicate ? <input type="hidden" name="confirmDuplicate" value={duplicate.name} /> : null}

        {/* The four selects below are controlled but no longer carry `name` —
            React 19 resets the form's DOM after the action completes, and
            while it re-syncs controlled <input> elements on the next render,
            it does not re-apply a controlled <select>'s value, so the select
            would silently revert to its initial option. These hidden inputs
            are the actual source of truth for submission; React does write
            the `value` attribute on hidden inputs, so a reset restores
            rather than clears them. */}
        <input type="hidden" name="category" value={fields.category} />
        <input type="hidden" name="status" value={fields.status} />
        <input type="hidden" name="paymentTerms" value={fields.paymentTerms} />
        <input type="hidden" name="defaultPaymentMethod" value={fields.defaultPaymentMethod} />

        <FormField label="Vendor name" required error={state.fieldErrors?.name}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="name"
              required
              autoFocus
              maxLength={120}
              placeholder="Northwind Logistics"
              invalid={Boolean(state.fieldErrors?.name)}
              aria-describedby={describedBy}
              value={fields.name}
              onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
            />
          )}
        </FormField>

        {duplicate ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded border border-warn/25 bg-warn-soft px-2 py-1.5 text-xs text-ink"
          >
            <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              <Link href={`/vendors/${duplicate.id}`} className="font-medium underline">
                {duplicate.name}
              </Link>{" "}
              is already on file. Add anyway only if this is a different supplier trading under the
              same name.
            </span>
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Category" required error={state.fieldErrors?.category}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                value={fields.category}
                onChange={(e) => setFields((f) => ({ ...f, category: e.target.value }))}
                invalid={Boolean(state.fieldErrors?.category)}
                aria-describedby={describedBy}
              >
                {VENDOR_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Status">
            {({ id }) => (
              <Select
                id={id}
                value={fields.status}
                onChange={(e) => setFields((f) => ({ ...f, status: e.target.value }))}
              >
                {Object.entries(VENDOR_STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Payment terms">
            {({ id }) => (
              <Select
                id={id}
                value={fields.paymentTerms}
                onChange={(e) => setFields((f) => ({ ...f, paymentTerms: e.target.value }))}
              >
                {Object.entries(PAYMENT_TERMS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Default payment method">
            {({ id }) => (
              <Select
                id={id}
                value={fields.defaultPaymentMethod}
                onChange={(e) => setFields((f) => ({ ...f, defaultPaymentMethod: e.target.value }))}
              >
                {Object.entries(PAYMENT_METHOD_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Email" error={state.fieldErrors?.email}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="email"
                type="email"
                placeholder="ap@northwind.com"
                invalid={Boolean(state.fieldErrors?.email)}
                aria-describedby={describedBy}
                value={fields.email}
                onChange={(e) => setFields((f) => ({ ...f, email: e.target.value }))}
              />
            )}
          </FormField>

          <FormField label="Phone" error={state.fieldErrors?.phone}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="phone"
                placeholder="+1 555 0142"
                invalid={Boolean(state.fieldErrors?.phone)}
                aria-describedby={describedBy}
                value={fields.phone}
                onChange={(e) => setFields((f) => ({ ...f, phone: e.target.value }))}
              />
            )}
          </FormField>
        </div>

        {state.error ? (
          <p role="alert" className="text-xs text-danger">
            {state.error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
