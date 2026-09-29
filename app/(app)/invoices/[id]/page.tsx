import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Info, Send } from "lucide-react";

import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import {
  formatCents,
  formatCentsWhole,
  formatDate,
  formatDateTime,
  toDateInput,
  describeDueDate,
} from "@/lib/format";
import {
  isVatType,
  VAT_TYPE_META,
  AUDIT_ACTION_LABEL,
  OPEN_INVOICE_STATUSES,
  OWNER_SIGNOFF_THRESHOLD_CENTS,
  PAYMENT_METHOD_META,
  PAYMENT_TERMS_META,
  type AuditAction,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentTerms,
} from "@/lib/constants";
import { getInvoice, getInvoiceHistory } from "@/lib/queries/invoices";
import { ApprovalRail, buildRail } from "@/components/approval-rail";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { ButtonLink, Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, FieldGrid } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumb, PageHeader } from "@/components/ui/tabs";
import { DecisionPanel } from "../../approvals/decision-panel";
import { submitInvoice } from "../actions";
import { AttachmentsPanel } from "./attachments-panel";
import { DownloadPdf } from "./download-pdf";
import { InvoiceActions } from "./invoice-actions";
import { SchedulePayment } from "./schedule-payment";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const invoice = await getInvoice(id);
  return { title: invoice ? invoice.invoiceNumber : "Invoice" };
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAction("invoice:view");
  const { id } = await params;
  const flags = await searchParams;

  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const [history, settings] = await Promise.all([
    getInvoiceHistory(id),
    db.orgSettings.findUnique({ where: { id: "singleton" }, select: { orgName: true } }),
  ]);
  const orgName = settings?.orgName ?? "Apollo Financial Group";

  const subject = {
    kind: "invoice" as const,
    createdById: invoice.createdById,
    status: invoice.status,
    archivedAt: invoice.archivedAt,
  };

  const mayEdit = can(user, "invoice:edit", subject);
  const maySubmit = can(user, "invoice:submit", subject);
  const mayApprove = can(user, "invoice:approve", subject);
  const isOwnInvoice = invoice.createdById === user.id;
  const due = describeDueDate(invoice.dueDate);
  const rail = buildRail(invoice);
  const vatLabel = isVatType(invoice.vatType) ? VAT_TYPE_META[invoice.vatType].label : invoice.vatType;
  // Only a mixed sale needs its buckets spelled out; for every other type the
  // one bucket is the subtotal, already on the line above.
  const vatBuckets =
    invoice.vatType === "MIXED"
      ? ([
          ["VATable sales", invoice.vatableSalesCents],
          ["Zero-rated sales", invoice.zeroRatedSalesCents],
          ["VAT-exempt sales", invoice.exemptSalesCents],
        ] as const).filter(([, cents]) => cents !== 0)
      : [];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: "Invoices", href: "/invoices" }, { label: invoice.invoiceNumber }]}
          />
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="ident text-xl">{invoice.invoiceNumber}</span>
            <StatusPill kind="invoice" status={invoice.status} />
            {/* No percentage. The old number was mean character confidence
                from a local OCR engine — crude, but a real measurement. A
                model's self-reported number sits near 0.95 whether it read the
                document correctly or not, so printing it would put
                "Scanned · 95%" on a wrong invoice and lend it authority. */}
            {invoice.ocrConfidence !== null ? <Badge tone="neutral">Scanned</Badge> : null}
            {invoice.archivedAt ? <Badge tone="neutral">Archived</Badge> : null}
          </span>
        }
        description={
          <>
            <Link href={`/vendors/${invoice.vendorId}`} className="hover:text-ink hover:underline">
              {invoice.vendor.name}
            </Link>
            {" · "}
            {formatCents(invoice.totalCents)}
          </>
        }
        actions={
          <>
            {can(user, "export:run") ? (
              <DownloadPdf
                data={{
                  invoiceNumber: invoice.invoiceNumber,
                  status: invoice.status,
                  poNumber: invoice.poNumber,
                  issueDate: invoice.issueDate.toISOString(),
                  dueDate: invoice.dueDate.toISOString(),
                  subtotalCents: invoice.subtotalCents,
                  taxCents: invoice.taxCents,
                  totalCents: invoice.totalCents,
                  vatTypeLabel: vatLabel,
                  vatBuckets: vatBuckets.map(([label, cents]) => ({ label, cents })),
                  supplierTin: invoice.supplierTin,
                  vatExemptionBasis: invoice.vatExemptionBasis,
                  description: invoice.description,
                  glAccount: invoice.glAccount,
                  costCenter: invoice.costCenter,
                  vendor: {
                    name: invoice.vendor.name,
                    addressLine1: invoice.vendor.addressLine1,
                    city: invoice.vendor.city,
                    province: invoice.vendor.province,
                    postalCode: invoice.vendor.postalCode,
                    taxId: invoice.vendor.taxId,
                  },
                  createdByName: invoice.createdBy.name,
                  lineItems: invoice.lineItems.map((line) => ({
                    description: line.description,
                    quantity: line.quantity,
                    unitPriceCents: line.unitPriceCents,
                    amountCents: line.amountCents,
                  })),
                  approvals: invoice.approvalSteps.map((step) => ({
                    sequence: step.sequence,
                    status: step.status,
                    approverName: step.approver?.name ?? null,
                    decidedAt: step.decidedAt?.toISOString() ?? null,
                    comment: step.comment,
                  })),
                  payments: invoice.payments.map((payment) => ({
                    paymentNumber: payment.paymentNumber,
                    method: payment.method,
                    status: payment.status,
                    amountCents: payment.amountCents,
                    executedDate: payment.executedDate?.toISOString() ?? null,
                    reference: payment.reference,
                  })),
                  orgName: orgName,
                }}
              />
            ) : null}
            {mayEdit ? (
              <ButtonLink href={`/invoices/${invoice.id}/edit`} variant="secondary" size="md">
                Edit
              </ButtonLink>
            ) : null}
            {maySubmit ? (
              <form action={submitInvoice}>
                <input type="hidden" name="id" value={invoice.id} />
                <Button type="submit" variant="primary" size="md">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Submit for approval
                </Button>
              </form>
            ) : null}
            {invoice.status === "APPROVED" && can(user, "payment:manage") ? (
              <SchedulePayment
                invoiceId={invoice.id}
                invoiceNumber={invoice.invoiceNumber}
                vendorName={invoice.vendor.name}
                amount={formatCents(invoice.totalCents)}
                defaultMethod={invoice.vendor.defaultPaymentMethod}
                defaultDate={toDateInput(invoice.dueDate)}
              />
            ) : null}
            {mayApprove ? (
              <DecisionPanel
                invoiceId={invoice.id}
                invoiceNumber={invoice.invoiceNumber}
                vendorName={invoice.vendor.name}
                amount={formatCents(invoice.totalCents)}
                totalCents={invoice.totalCents}
                stepLabel=""
                compact
                returnTo={`/invoices/${invoice.id}`}
              />
            ) : null}
            <InvoiceActions
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              canVoid={can(user, "invoice:void", subject)}
              canArchive={can(user, "invoice:archive", subject)}
              isArchived={Boolean(invoice.archivedAt)}
            />
          </>
        }
      />

      <Notices flags={flags} isOwnInvoice={isOwnInvoice} status={invoice.status} />

      {/* The rail is the first thing on the page because "where has this got
          to?" is the first question anyone opening an invoice is asking. */}
      <Card className="mb-3">
        <CardHeader
          title="Progress"
          description={describeRoute(invoice.requiredApprovals, invoice.totalCents)}
        />
        <CardBody className="overflow-x-auto">
          <ApprovalRail steps={rail} className="min-w-[560px]" />
        </CardBody>
      </Card>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <Card>
            <CardHeader title="Line items" description={`${invoice.lineItems.length} lines`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px]">
                <thead>
                  <tr className="border-b border-line bg-surface-sunken">
                    <th className="col-head px-4 py-2 text-left">Description</th>
                    <th className="col-head w-20 px-3 py-2 text-right">Qty</th>
                    <th className="col-head w-32 px-3 py-2 text-right">Unit</th>
                    <th className="col-head w-40 px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lineItems.map((line) => (
                    <tr key={line.id} className="border-b border-line">
                      <td className="px-4 py-2 text-sm text-ink">
                        {line.description}
                        {line.glAccount ? (
                          <span className="block text-2xs text-ink-subtle">{line.glAccount}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-ink-muted">
                        {line.quantity}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-ink-muted">
                        {formatCents(line.unitPriceCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium tabular-nums text-ink">
                        {formatCents(line.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface-sunken">
                  <tr>
                    <td colSpan={3} className="px-4 py-1.5 text-right text-xs text-ink-muted">
                      Subtotal
                    </td>
                    <td className="px-4 py-1.5 text-right text-sm tabular-nums text-ink">
                      {formatCents(invoice.subtotalCents)}
                    </td>
                  </tr>
                  {vatBuckets.map(([label, cents]) => (
                    <tr key={label}>
                      <td colSpan={3} className="px-4 py-1 text-right text-2xs text-ink-subtle">
                        {label}
                      </td>
                      <td className="px-4 py-1 text-right text-xs tabular-nums text-ink-muted">
                        {formatCents(cents)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="px-4 py-1.5 text-right text-xs text-ink-muted">
                      VAT · {vatLabel}
                    </td>
                    <td className="px-4 py-1.5 text-right text-sm tabular-nums text-ink">
                      {formatCents(invoice.taxCents)}
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td colSpan={3} className="px-4 py-2 text-right text-sm font-medium text-ink">
                      Total
                    </td>
                    <td className="px-4 py-2 text-right text-base font-semibold tabular-nums text-ink">
                      {formatCents(invoice.totalCents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <AttachmentsPanel
              invoiceId={invoice.id}
              canUpload={can(user, "attachment:upload", subject)}
              attachments={invoice.attachments.map((attachment) => ({
                id: attachment.id,
                filename: attachment.filename,
                storedName: attachment.storedName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                isPrimary: attachment.isPrimary,
                createdAt: attachment.createdAt.toISOString(),
                uploadedByName: attachment.uploadedBy.name,
              }))}
            />
          </Card>

          <Card>
            <CardHeader title="History" description="Every recorded change to this invoice" />
            {history.length === 0 ? (
              <EmptyState compact title="No history yet" />
            ) : (
              <ol className="divide-y divide-line">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2.5 px-4 py-2.5">
                    <Avatar name={entry.actorName} size="xs" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{entry.summary}</p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {entry.actorName} ·{" "}
                        {AUDIT_ACTION_LABEL[entry.action as AuditAction] ?? entry.action} ·{" "}
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <FieldGrid columns={2}>
                <Field label="Vendor">
                  <Link href={`/vendors/${invoice.vendorId}`} className="hover:text-accent hover:underline">
                    {invoice.vendor.name}
                  </Link>
                </Field>
                <Field label="Terms">
                  {PAYMENT_TERMS_META[invoice.vendor.paymentTerms as PaymentTerms]?.label ??
                    invoice.vendor.paymentTerms}
                </Field>
                <Field label="Issued">{formatDate(invoice.issueDate)}</Field>
                <Field label="Due">
                  {formatDate(invoice.dueDate)}
                  {/* Only unsettled commitments can be overdue — see the same
                      rule applied on the listing. */}
                  {OPEN_INVOICE_STATUSES.includes(invoice.status as InvoiceStatus) ? (
                    <span
                      className={
                        due.tone === "danger"
                          ? "block text-2xs text-danger"
                          : due.tone === "warn"
                            ? "block text-2xs text-warn"
                            : "block text-2xs text-ink-subtle"
                      }
                    >
                      {due.label}
                    </span>
                  ) : null}
                </Field>
                <Field label="PO number" mono>
                  {invoice.poNumber ?? <span className="text-ink-subtle">Not set</span>}
                </Field>
                <Field label="Entered by">{invoice.createdBy.name}</Field>
                <Field label="GL account">
                  {invoice.glAccount ?? <span className="text-ink-subtle">Not set</span>}
                </Field>
                <Field label="Cost centre">
                  {invoice.costCenter ?? <span className="text-ink-subtle">Not set</span>}
                </Field>
                <Field label="VAT type">{vatLabel}</Field>
                <Field label="Supplier TIN" mono>
                  {invoice.supplierTin ?? <span className="text-ink-subtle">Not set</span>}
                </Field>
                {invoice.vatExemptionBasis ? (
                  <Field label="Exemption basis">{invoice.vatExemptionBasis}</Field>
                ) : null}
              </FieldGrid>

              {invoice.description ? (
                <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">
                  {invoice.description}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {invoice.rejectionReason ? (
            <Card className="border-danger/25">
              <CardHeader title="Why this was rejected" />
              <CardBody>
                <p className="text-sm text-ink">{invoice.rejectionReason}</p>
                {invoice.rejectedAt ? (
                  <p className="mt-1 text-2xs text-ink-subtle">{formatDateTime(invoice.rejectedAt)}</p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Payment" />
            {invoice.payments.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">
                  {invoice.status === "APPROVED"
                    ? "Approved and ready to schedule."
                    : "No payment scheduled yet."}
                </p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="ident text-ink">{payment.paymentNumber}</span>
                      <StatusPill kind="payment" status={payment.status} />
                    </div>
                    <dl className="mt-2 space-y-1">
                      <SummaryRow
                        label="Method"
                        value={
                          PAYMENT_METHOD_META[payment.method as PaymentMethod]?.label ?? payment.method
                        }
                      />
                      <SummaryRow label="Amount" value={formatCents(payment.amountCents)} />
                      <SummaryRow
                        label={payment.executedDate ? "Executed" : "Scheduled"}
                        value={formatDate(payment.executedDate ?? payment.scheduledDate)}
                      />
                      {payment.reference ? (
                        <SummaryRow label="Reference" value={payment.reference} mono />
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={mono ? "ident text-ink" : "text-xs tabular-nums text-ink"}>{value}</dd>
    </div>
  );
}

function describeRoute(requiredApprovals: number, totalCents: number): string {
  const base =
    requiredApprovals === 0
      ? "Below the approval threshold — no sign-off required"
      : requiredApprovals === 1
        ? "One approval required, based on the invoice total"
        : `${requiredApprovals} sequential approvals required, based on the invoice total`;

  // The owner is not a user of this system: they authorise offline, and the
  // approver's signature stays the only one recorded. Saying so here means the
  // approver meets the requirement before they reach the Approve button.
  if (totalCents >= OWNER_SIGNOFF_THRESHOLD_CENTS) {
    return `${base} · Above ${formatCentsWhole(OWNER_SIGNOFF_THRESHOLD_CENTS)}, the owner must authorise it personally, outside the system`;
  }
  return base;
}

/** Post-action confirmations and the one blocking explanation. */
function Notices({
  flags,
  isOwnInvoice,
  status,
}: {
  flags: Record<string, string | undefined>;
  isOwnInvoice: boolean;
  status: string;
}) {
  const messages: Array<{ tone: "accent" | "warn"; text: string }> = [];

  if (flags.created) messages.push({ tone: "accent", text: "Draft saved. Submit it when you are ready for approval." });
  if (flags.updated) messages.push({ tone: "accent", text: "Changes saved." });
  if (flags.decided === "approve")
    messages.push({
      tone: "accent",
      text:
        status === "APPROVED"
          ? "Approved. This invoice is now ready to schedule for payment."
          : "Your approval is recorded. It still needs the next sign-off.",
    });
  if (flags.decided === "reject")
    messages.push({ tone: "warn", text: "Rejected and sent back to be corrected." });
  if (flags.voided)
    messages.push({
      tone: "warn",
      text: "Voided. Any payment scheduled against it has been cancelled.",
    });
  if (flags.restored) messages.push({ tone: "accent", text: "Restored to the active ledger." });
  if (flags.error === "locked")
    messages.push({
      tone: "warn",
      text: "This invoice can no longer be edited — the approvals recorded against it would no longer match.",
    });
  if (flags.submitted)
    messages.push({
      tone: "accent",
      text:
        status === "APPROVED"
          ? "Submitted and auto-approved — the total is below the approval threshold."
          : "Submitted. The approvers have been notified.",
    });
  if (flags.error === "attachment")
    messages.push({
      tone: "warn",
      text: "Attach the supplier's document before submitting — your organisation requires one.",
    });

  // Explains the absent Approve button rather than leaving its absence a mystery.
  if (isOwnInvoice && status === "PENDING_APPROVAL")
    messages.push({
      tone: "warn",
      text: "You entered this invoice, so somebody else has to approve it.",
    });

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
