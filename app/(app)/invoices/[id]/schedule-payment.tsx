"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { toDateInput } from "@/lib/format";
import { PAYMENT_METHOD_META, type PaymentMethod } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { schedulePayment } from "../../payments/actions";

const FORM_ID = "schedule-payment-form";

/**
 * Queues an approved invoice for payment.
 *
 * The vendor's own preferred method and the invoice's due date are the
 * defaults, because those are right almost every time — the dialog exists so
 * they *can* be overridden, not so they must be chosen.
 */
export function SchedulePayment({
  invoiceId,
  invoiceNumber,
  vendorName,
  amount,
  defaultMethod,
  defaultDate,
}: {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amount: string;
  defaultMethod: string;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);

  // Never schedule into the past; the due date is the target where it is still
  // ahead of us, and today where it is not.
  const today = toDateInput(new Date());
  const initialDate = defaultDate < today ? today : defaultDate;

  return (
    <>
      <Button type="button" variant="primary" size="md" onClick={() => setOpen(true)}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        Schedule payment
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Schedule payment for ${invoiceNumber}`}
        description={`${vendorName} · ${amount}`}
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} variant="primary" size="md">
              Schedule payment
            </Button>
          </>
        }
      >
        <form action={schedulePayment} id={FORM_ID} className="space-y-3">
          <input type="hidden" name="invoiceId" value={invoiceId} />

          <FormField label="Method" hint="Defaults to what this vendor is set up for">
            {({ id }) => (
              <Select id={id} name="method" defaultValue={defaultMethod}>
                {(Object.keys(PAYMENT_METHOD_META) as PaymentMethod[]).map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_META[method].label} — {PAYMENT_METHOD_META[method].description}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField label="Send on" hint="The invoice due date, unless that has already passed">
            {({ id }) => (
              <Input id={id} name="scheduledDate" type="date" min={today} defaultValue={initialDate} />
            )}
          </FormField>

          <p className="text-xs text-ink-subtle">
            Scheduling moves the invoice to Scheduled. Nothing leaves until the payment is sent, on
            its own or as part of a run.
          </p>
        </form>
      </Modal>
    </>
  );
}
