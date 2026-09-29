import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth/session";
import { formatCents, formatDate, describeDueDate } from "@/lib/format";
import {
  OPEN_INVOICE_STATUSES,
  PAYMENT_METHOD_META,
  PAYMENT_TERMS_META,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentTerms,
} from "@/lib/constants";
import { StatusPill } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, FieldGrid } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumb, PageHeader } from "@/components/ui/tabs";
import { StatTile } from "@/components/ui/stat-tile";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vendor = await db.vendor.findUnique({ where: { id }, select: { name: true } });
  return { title: vendor ? vendor.name : "Vendor" };
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAction("vendor:view");
  const { id } = await params;

  const vendor = await db.vendor.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: { issueDate: "desc" },
        take: 15,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          issueDate: true,
          dueDate: true,
          totalCents: true,
          currency: true,
        },
      },
    },
  });
  if (!vendor) notFound();

  const [totals, paid, open] = await Promise.all([
    db.invoice.aggregate({ where: { vendorId: id }, _count: true, _sum: { totalCents: true } }),
    db.invoice.aggregate({ where: { vendorId: id, status: "PAID" }, _sum: { totalCents: true } }),
    db.invoice.aggregate({
      where: { vendorId: id, status: { in: OPEN_INVOICE_STATUSES }, archivedAt: null },
      _count: true,
      _sum: { totalCents: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: "Vendors", href: "/vendors" }, { label: vendor.name }]} />
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {vendor.name}
            <StatusPill kind="vendor" status={vendor.status} />
          </span>
        }
        description={vendor.legalName ?? vendor.category}
        actions={
          <ButtonLink href={`/invoices?vendor=${vendor.id}`} variant="secondary" size="md">
            All invoices
          </ButtonLink>
        }
      />

      <section aria-label="Vendor summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Outstanding" value={formatCents(open._sum.totalCents ?? 0)} detail={`${open._count} open invoices`} />
        <StatTile label="Paid to date" value={formatCents(paid._sum.totalCents ?? 0)} tone="accent" detail="Settled in full" />
        <StatTile label="Invoices" value={totals._count} detail="All time" />
        <StatTile
          label="Terms"
          value={PAYMENT_TERMS_META[vendor.paymentTerms as PaymentTerms]?.label ?? vendor.paymentTerms}
          detail={PAYMENT_METHOD_META[vendor.defaultPaymentMethod as PaymentMethod]?.label ?? vendor.defaultPaymentMethod}
        />
      </section>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent invoices"
            description="Most recently issued first"
            action={
              <Link href={`/invoices?vendor=${vendor.id}`} className="text-xs font-medium text-accent hover:underline">
                View all
              </Link>
            }
          />

          {vendor.invoices.length === 0 ? (
            <EmptyState
              compact
              icon={FileText}
              title="No invoices from this vendor yet"
              description="Invoices appear here as they are entered."
            />
          ) : (
            <ul className="divide-y divide-line">
              {vendor.invoices.map((invoice) => {
                const due = describeDueDate(invoice.dueDate);
                const owes = OPEN_INVOICE_STATUSES.includes(invoice.status as InvoiceStatus);

                return (
                  <li key={invoice.id}>
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="ident text-ink">{invoice.invoiceNumber}</span>
                          <StatusPill kind="invoice" status={invoice.status} />
                        </span>
                        <span className="mt-0.5 block text-2xs text-ink-subtle">
                          Issued {formatDate(invoice.issueDate)}
                        </span>
                      </span>

                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-medium tabular-nums text-ink">
                          {formatCents(invoice.totalCents)}
                        </span>
                        {owes ? (
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
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <FieldGrid columns={2}>
              <Field label="Category">{vendor.category}</Field>
              <Field label="Tax ID" mono>
                {vendor.taxId ?? <span className="text-ink-subtle">Not on file</span>}
              </Field>
              <Field label="Email">
                {vendor.email ? (
                  <a href={`mailto:${vendor.email}`} className="hover:text-accent hover:underline">
                    {vendor.email}
                  </a>
                ) : (
                  <span className="text-ink-subtle">Not on file</span>
                )}
              </Field>
              <Field label="Phone">{vendor.phone ?? <span className="text-ink-subtle">Not on file</span>}</Field>
              <Field label="Bank">{vendor.bankName ?? <span className="text-ink-subtle">Not on file</span>}</Field>
              <Field label="Account" mono>
                {vendor.bankAccountLast4 ? (
                  `•••• ${vendor.bankAccountLast4}`
                ) : (
                  <span className="text-ink-subtle">Not on file</span>
                )}
              </Field>
            </FieldGrid>

            {vendor.addressLine1 ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="col-head">Address</p>
                <address className="mt-1 text-sm not-italic text-ink">
                  {vendor.addressLine1}
                  <br />
                  {vendor.city}
                  {vendor.province ? `, ${vendor.province}` : ""} {vendor.postalCode}
                  <br />
                  {vendor.country}
                </address>
              </div>
            ) : null}

            {vendor.notes ? (
              <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">{vendor.notes}</p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
