import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Info, Send, X } from "lucide-react";

import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import {
  PAYMENT_METHOD_META,
  PAYMENT_TERMS_META,
  type PaymentMethod,
  type PaymentTerms,
} from "@/lib/constants";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, FieldGrid } from "@/components/ui/card";
import { Breadcrumb, PageHeader } from "@/components/ui/tabs";
import { cancelPayment, executePayment } from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const payment = await db.payment.findUnique({ where: { id }, select: { paymentNumber: true } });
  return { title: payment ? payment.paymentNumber : "Payment" };
}

export default async function PaymentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("payment:view");
  const { id } = await params;
  const flags = await searchParams;

  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      invoice: { include: { vendor: true } },
      initiatedBy: { select: { name: true, avatarColor: true } },
      batch: true,
    },
  });
  if (!payment) notFound();

  const mayManage = can(user, "payment:manage");
  const method = PAYMENT_METHOD_META[payment.method as PaymentMethod];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Payments", href: "/payments" }, { label: payment.paymentNumber }]}
          />
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="ident text-xl">{payment.paymentNumber}</span>
            <StatusPill kind="payment" status={payment.status} />
          </span>
        }
        description={`${formatCents(payment.amountCents)} to ${payment.invoice.vendor.name}`}
        actions={
          mayManage && payment.status === "SCHEDULED" ? (
            <>
              <form action={cancelPayment}>
                <input type="hidden" name="paymentId" value={payment.id} />
                <Button type="submit" variant="danger" size="md">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Cancel
                </Button>
              </form>
              <form action={executePayment}>
                <input type="hidden" name="paymentId" value={payment.id} />
                <Button type="submit" variant="primary" size="md">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Send payment
                </Button>
              </form>
            </>
          ) : null
        }
      />

      <Notices flags={flags} />

      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Remittance" description="What the vendor will see against this payment" />
          <CardBody>
            <FieldGrid columns={3}>
              <Field label="Amount">
                <span className="text-lg font-semibold tabular-nums">
                  {formatCents(payment.amountCents)}
                </span>
              </Field>
              <Field label="Method">{method?.label ?? payment.method}</Field>
              <Field label="Settlement">{method?.description ?? "—"}</Field>

              <Field label="Reference" mono>
                {payment.reference ?? <span className="text-ink-subtle">Assigned on send</span>}
              </Field>
              <Field label="Scheduled for">{formatDate(payment.scheduledDate)}</Field>
              <Field label="Executed">
                {payment.executedDate ? (
                  formatDateTime(payment.executedDate)
                ) : (
                  <span className="text-ink-subtle">Not yet sent</span>
                )}
              </Field>

              <Field label="Initiated by">{payment.initiatedBy.name}</Field>
              <Field label="Payment run" mono>
                {payment.batch ? payment.batch.batchNumber : <span className="text-ink-subtle">Not in a run</span>}
              </Field>
              <Field label="Bank account" mono>
                {payment.invoice.vendor.bankAccountLast4 ? (
                  `•••• ${payment.invoice.vendor.bankAccountLast4}`
                ) : (
                  <span className="text-ink-subtle">Not on file</span>
                )}
              </Field>
            </FieldGrid>

            {payment.memo ? (
              <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">{payment.memo}</p>
            ) : null}

            {payment.failureReason ? (
              <p className="mt-3 rounded border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
                {payment.failureReason}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Invoice" description="What is being settled" />
          <CardBody>
            <FieldGrid columns={2}>
              <Field label="Invoice" mono>
                <Link
                  href={`/invoices/${payment.invoiceId}`}
                  className="hover:text-accent hover:underline"
                >
                  {payment.invoice.invoiceNumber}
                </Link>
              </Field>
              <Field label="Status">
                <StatusPill kind="invoice" status={payment.invoice.status} />
              </Field>
              <Field label="Vendor">
                <Link
                  href={`/vendors/${payment.invoice.vendorId}`}
                  className="hover:text-accent hover:underline"
                >
                  {payment.invoice.vendor.name}
                </Link>
              </Field>
              <Field label="Terms">
                {PAYMENT_TERMS_META[payment.invoice.vendor.paymentTerms as PaymentTerms]?.label ??
                  payment.invoice.vendor.paymentTerms}
              </Field>
              <Field label="Issued">{formatDate(payment.invoice.issueDate)}</Field>
              <Field label="Due">{formatDate(payment.invoice.dueDate)}</Field>
            </FieldGrid>
          </CardBody>
        </Card>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs text-ink-subtle">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Payments in this build are simulated — no money moves and no bank is contacted. The status
        changes, audit entries, and remittance record are real.
      </p>
    </>
  );
}

function Notices({ flags }: { flags: Record<string, string | undefined> }) {
  const messages: Array<{ tone: "accent" | "warn"; text: string }> = [];

  if (flags.scheduled)
    messages.push({ tone: "accent", text: "Payment scheduled. Send it, or add it to a run." });
  if (flags.executed)
    messages.push({ tone: "accent", text: "Payment sent. The invoice is now marked paid." });
  if (flags.cancelled)
    messages.push({
      tone: "warn",
      text: "Payment cancelled. The invoice is approved again and still owed.",
    });
  if (flags.error === "notscheduled")
    messages.push({ tone: "warn", text: "This payment is no longer in a state that can be sent." });

  if (messages.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {messages.map((message) => (
        <div
          key={message.text}
          role="status"
          className={
            message.tone === "accent"
              ? "flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2.5"
              : "flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2.5"
          }
        >
          {message.tone === "accent" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          )}
          <p className={message.tone === "accent" ? "text-sm text-accent" : "text-sm text-warn"}>
            {message.text}
          </p>
        </div>
      ))}
    </div>
  );
}
