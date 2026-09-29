-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "vatType" TEXT NOT NULL DEFAULT 'VATABLE',
    "vatableSalesCents" INTEGER NOT NULL DEFAULT 0,
    "zeroRatedSalesCents" INTEGER NOT NULL DEFAULT 0,
    "exemptSalesCents" INTEGER NOT NULL DEFAULT 0,
    "supplierTin" TEXT,
    "vatExemptionBasis" TEXT,
    "poNumber" TEXT,
    "description" TEXT,
    "glAccount" TEXT,
    "costCenter" TEXT,
    "createdById" TEXT NOT NULL,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "rejectedAt" DATETIME,
    "rejectionReason" TEXT,
    "paidAt" DATETIME,
    "ocrConfidence" REAL,
    "ocrRawText" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amountPaidCents", "approvedAt", "archivedAt", "costCenter", "createdAt", "createdById", "currency", "description", "dueDate", "glAccount", "id", "invoiceNumber", "issueDate", "ocrConfidence", "ocrRawText", "paidAt", "poNumber", "rejectedAt", "rejectionReason", "requiredApprovals", "status", "submittedAt", "subtotalCents", "taxCents", "totalCents", "updatedAt", "vendorId") SELECT "amountPaidCents", "approvedAt", "archivedAt", "costCenter", "createdAt", "createdById", "currency", "description", "dueDate", "glAccount", "id", "invoiceNumber", "issueDate", "ocrConfidence", "ocrRawText", "paidAt", "poNumber", "rejectedAt", "rejectionReason", "requiredApprovals", "status", "submittedAt", "subtotalCents", "taxCents", "totalCents", "updatedAt", "vendorId" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX "Invoice_issueDate_idx" ON "Invoice"("issueDate");
CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");
CREATE INDEX "Invoice_archivedAt_idx" ON "Invoice"("archivedAt");
CREATE UNIQUE INDEX "Invoice_vendorId_invoiceNumber_key" ON "Invoice"("vendorId", "invoiceNumber");

-- Backfill (hand-written). Every invoice before this carried VAT of either
-- 12% or nothing, and nothing meant the supplier was not VAT-registered — the
-- seed's own rule. So VAT > 0 is a VATable sale and zero is a non-VAT one.
UPDATE "Invoice" SET "vatType" = 'VATABLE', "vatableSalesCents" = "subtotalCents" WHERE "taxCents" > 0;
UPDATE "Invoice" SET "vatType" = 'NON_VAT' WHERE "taxCents" = 0;
UPDATE "Invoice" SET "supplierTin" = (SELECT "taxId" FROM "Vendor" WHERE "Vendor"."id" = "Invoice"."vendorId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
