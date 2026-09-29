/**
 * Checks the ledger's internal invariants.
 *
 * Run after seeding, and after any change to the approval or payment logic:
 *
 *   npm run verify:data
 *
 * Every check below states the value it expects. Nonzero output on a "must be
 * 0" line is a real defect in the data or in the code that wrote it.
 */

import { PrismaClient } from "@prisma/client";

import {
  INSTAPAY_MAX_CENTS,
  OWNER_SIGNOFF_THRESHOLD_CENTS,
  SEED_VENDOR_COUNT,
} from "../lib/constants";
import { formatCentsWhole } from "../lib/format";

const db = new PrismaClient();

let failures = 0;

function assertZero(label: string, count: number) {
  const ok = count === 0;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${count}`);
}

async function countRaw(query: Promise<Array<{ n: bigint | number }>>): Promise<number> {
  const rows = await query;
  return Number(rows[0]?.n ?? 0);
}

console.log("\nInvoice status distribution");
const byStatus = await db.invoice.groupBy({
  by: ["status"],
  _count: true,
  _sum: { totalCents: true },
});
for (const row of byStatus.sort((a, b) => b._count - a._count)) {
  console.log(
    `  ${row.status.padEnd(18)} ${String(row._count).padStart(4)}   ${formatCentsWhole(row._sum.totalCents ?? 0)}`,
  );
}

console.log("\nInvariants");

// The control an auditor actually tests: nobody approved their own invoice.
assertZero(
  "Steps approved by the invoice's own creator (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM ApprovalStep s
    JOIN Invoice i ON i.id = s.invoiceId
    WHERE s.approverId IS NOT NULL AND s.approverId = i.createdById`),
);

assertZero(
  "Invoices whose line items do not sum to the subtotal (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM (
      SELECT i.id FROM Invoice i
      JOIN InvoiceLineItem l ON l.invoiceId = i.id
      GROUP BY i.id HAVING SUM(l.amountCents) != i.subtotalCents)`),
);

assertZero(
  "Invoices where subtotal + tax != total (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice WHERE subtotalCents + taxCents != totalCents`),
);

assertZero(
  "Payments against invoices that never became payable (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Payment p JOIN Invoice i ON i.id = p.invoiceId
    WHERE i.status NOT IN ('PAID','SCHEDULED')`),
);

assertZero(
  "PAID invoices with no completed payment (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice i WHERE i.status = 'PAID'
    AND NOT EXISTS (SELECT 1 FROM Payment p WHERE p.invoiceId = i.id AND p.status = 'COMPLETED')`),
);

assertZero(
  "Approved or paid invoices with a step still pending (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice i
    WHERE i.status IN ('APPROVED','SCHEDULED','PAID')
    AND EXISTS (SELECT 1 FROM ApprovalStep s WHERE s.invoiceId = i.id AND s.status = 'PENDING')`),
);

assertZero(
  "Draft invoices carrying approval steps (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice i WHERE i.status = 'DRAFT'
    AND EXISTS (SELECT 1 FROM ApprovalStep s WHERE s.invoiceId = i.id)`),
);

assertZero(
  "Invoices due before they were issued (must be 0)",
  await countRaw(db.$queryRaw`SELECT COUNT(*) as n FROM Invoice WHERE dueDate < issueDate`),
);

// Something that has already happened cannot be dated in the future. A
// scheduled payment's *execution* date may be — the audit entry recording that
// somebody scheduled it may not.
assertZero(
  "Audit entries dated in the future (must be 0)",
  await db.auditLog.count({ where: { createdAt: { gt: new Date() } } }),
);

assertZero(
  "Invoices marked paid in the future (must be 0)",
  await db.invoice.count({ where: { paidAt: { gt: new Date() } } }),
);

assertZero(
  "Completed payments executed in the future (must be 0)",
  await db.payment.count({ where: { status: "COMPLETED", executedDate: { gt: new Date() } } }),
);

assertZero(
  "Invoices not denominated in PHP (must be 0)",
  await db.invoice.count({ where: { NOT: { currency: "PHP" } } }),
);

// The shipped ladder has no auto-approve band: approval is required from ₱0 up,
// so nothing that left DRAFT may be sitting there with no signature asked for.
assertZero(
  "Submitted invoices with no approval step (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice i
    WHERE i.status != 'DRAFT'
      AND (SELECT COUNT(*) FROM ApprovalStep s WHERE s.invoiceId = i.id) = 0`),
);

// VAT belongs to the supplier: 12% where they are registered, none where they
// are not. The tolerance is one minor unit — SQLite's arithmetic and JS's
// Math.round part company on a half-sentimo.
assertZero(
  "Invoices whose VAT is neither zero nor 12% of the subtotal (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice
    WHERE taxCents != 0 AND ABS(taxCents - (subtotalCents * 0.12)) > 1`),
);

// The BIR breakdown must account for the whole sale, and only the two types
// that bear VAT may carry any. See lib/tax/vat.ts.
assertZero(
  "Invoices whose VAT sales buckets do not sum to the subtotal (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice
    WHERE vatType != 'NON_VAT'
      AND vatableSalesCents + zeroRatedSalesCents + exemptSalesCents != subtotalCents`),
);

assertZero(
  "Zero-rated, exempt or non-VAT invoices carrying VAT (must be 0)",
  await countRaw(db.$queryRaw`
    SELECT COUNT(*) as n FROM Invoice
    WHERE vatType IN ('ZERO_RATED', 'EXEMPT', 'NON_VAT') AND taxCents != 0`),
);

assertZero(
  `InstaPay payments above the ${formatCentsWhole(INSTAPAY_MAX_CENTS)} ceiling (must be 0)`,
  await db.payment.count({
    where: { method: "INSTAPAY", amountCents: { gt: INSTAPAY_MAX_CENTS } },
  }),
);

// The roster is fixed, not rolled, and the end-to-end checks pick vendors by
// position in the dropdown — a drifting count is a broken assumption elsewhere.
const vendorCount = await db.vendor.count();
if (vendorCount !== SEED_VENDOR_COUNT) failures += 1;
console.log(
  `  ${vendorCount === SEED_VENDOR_COUNT ? "PASS" : "FAIL"}  Vendors on file (must be ${SEED_VENDOR_COUNT}): ${vendorCount}`,
);

console.log("\nCoverage");
const tiers: Array<[number, number | null, string]> = [
  [0, OWNER_SIGNOFF_THRESHOLD_CENTS - 1, `One approval (under ${formatCentsWhole(OWNER_SIGNOFF_THRESHOLD_CENTS)})`],
  [OWNER_SIGNOFF_THRESHOLD_CENTS, null, `Owner authorisation (${formatCentsWhole(OWNER_SIGNOFF_THRESHOLD_CENTS)}+)`],
];
for (const [min, max, label] of tiers) {
  const count = await db.invoice.count({
    where: { totalCents: { gte: min, ...(max === null ? {} : { lte: max }) } },
  });
  const ok = count > 0;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(32)} ${count} invoices`);
}

// Printed, not asserted: a reader should be able to see which VAT types are
// represented. The seed only produces VATable and non-VAT sales.
const byVatType = await db.invoice.groupBy({ by: ["vatType"], _count: { _all: true } });
console.log(
  `  ---   VAT types ${byVatType.map((row) => `${row.vatType} ${row._count._all}`).join(" · ")}`,
);

const [pending, overdue, archived, scanned, vendors, audits] = await Promise.all([
  db.invoice.count({ where: { status: "PENDING_APPROVAL" } }),
  db.invoice.count({
    where: {
      status: { in: ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"] },
      dueDate: { lt: new Date() },
    },
  }),
  db.invoice.count({ where: { archivedAt: { not: null } } }),
  db.invoice.count({ where: { ocrConfidence: { not: null } } }),
  db.vendor.count(),
  db.auditLog.count(),
]);

console.log(
  `\n  ${pending} pending approval · ${overdue} overdue and open · ${archived} archived · ${scanned} scanned · ${vendors} vendors · ${audits} audit entries`,
);

await db.$disconnect();

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
