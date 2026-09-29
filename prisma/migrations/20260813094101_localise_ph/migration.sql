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
CREATE TABLE "new_OrgSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "orgName" TEXT NOT NULL DEFAULT 'Apollo Financial Group',
    "legalName" TEXT,
    "taxId" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Philippines',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'PHP',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "requireAttachmentOnSubmit" BOOLEAN NOT NULL DEFAULT true,
    "duplicateDetection" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_OrgSettings" ("addressLine1", "city", "country", "defaultCurrency", "duplicateDetection", "fiscalYearStartMonth", "id", "legalName", "orgName", "postalCode", "requireAttachmentOnSubmit", "taxId", "updatedAt") SELECT "addressLine1", "city", "country", "defaultCurrency", "duplicateDetection", "fiscalYearStartMonth", "id", "legalName", "orgName", "postalCode", "requireAttachmentOnSubmit", "taxId", "updatedAt" FROM "OrgSettings";
DROP TABLE "OrgSettings";
ALTER TABLE "new_OrgSettings" RENAME TO "OrgSettings";
CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "plan" TEXT NOT NULL DEFAULT 'GROWTH',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "seats" INTEGER NOT NULL DEFAULT 10,
    "pricePerSeatCents" INTEGER NOT NULL DEFAULT 229900,
    "billingInterval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodStart" DATETIME NOT NULL,
    "currentPeriodEnd" DATETIME NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cardBrand" TEXT DEFAULT 'Visa',
    "cardLast4" TEXT DEFAULT '4242',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Subscription" ("billingInterval", "cancelAtPeriodEnd", "cardBrand", "cardLast4", "currentPeriodEnd", "currentPeriodStart", "id", "plan", "pricePerSeatCents", "seats", "status", "updatedAt") SELECT "billingInterval", "cancelAtPeriodEnd", "cardBrand", "cardLast4", "currentPeriodEnd", "currentPeriodStart", "id", "plan", "pricePerSeatCents", "seats", "status", "updatedAt" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE TABLE "new_Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Philippines',
    "paymentTerms" TEXT NOT NULL DEFAULT 'NET_30',
    "defaultPaymentMethod" TEXT NOT NULL DEFAULT 'PESONET',
    "bankName" TEXT,
    "bankAccountLast4" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Vendor" ("addressLine1", "addressLine2", "bankAccountLast4", "bankName", "category", "city", "country", "createdAt", "defaultPaymentMethod", "email", "id", "legalName", "name", "notes", "paymentTerms", "phone", "postalCode", "status", "taxId", "updatedAt", "website") SELECT "addressLine1", "addressLine2", "bankAccountLast4", "bankName", "category", "city", "country", "createdAt", "defaultPaymentMethod", "email", "id", "legalName", "name", "notes", "paymentTerms", "phone", "postalCode", "status", "taxId", "updatedAt", "website" FROM "Vendor";
DROP TABLE "Vendor";
ALTER TABLE "new_Vendor" RENAME TO "Vendor";
CREATE INDEX "Vendor_status_idx" ON "Vendor"("status");
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

