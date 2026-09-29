/**
 * Domain vocabulary.
 *
 * SQLite cannot hold Prisma enums, so these const objects are the real
 * definition of every status column. Each set pairs its values with a human
 * label and a visual `tone`, which means a status renders identically
 * wherever it appears — there is no second opinion about what "Scheduled"
 * looks like.
 */

/** Badge and pill appearance. Only `accent` fills with emerald. */
export type Tone = "neutral" | "accent" | "accent-outline" | "warn" | "danger" | "info";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * The currency this system keeps its books in. Every amount column stores
 * minor units of it, and `lib/format.ts` renders it. Invoices carry their own
 * `currency` column so the shape is there if a second one is ever needed, but
 * nothing in the application produces anything other than this.
 *
 * The peso's minor unit is the sentimo. The schema keeps the `Cents` suffix as
 * the generic name for minor units — renaming nine columns and every call site
 * would swamp the diff and change nothing.
 */
export const CURRENCY = "PHP";

/**
 * Everything user-facing is formatted for this locale. Dates go through
 * `date-fns` on explicit day-first patterns, so this governs numbers and month
 * names only.
 */
export const LOCALE = "en-PH";

/** Philippine VAT. Suppliers who are not VAT-registered bill no VAT at all. */
export const VAT_RATE = 0.12;

/**
 * How an invoice is treated for VAT, following the BIR's own breakdown of a
 * sales invoice. Kept per invoice rather than per supplier: a registered
 * supplier can still bill a zero-rated or exempt sale, and one invoice can
 * carry more than one kind (MIXED).
 */
export const VAT_TYPES = {
  VATABLE: "VATABLE",
  ZERO_RATED: "ZERO_RATED",
  EXEMPT: "EXEMPT",
  MIXED: "MIXED",
  NON_VAT: "NON_VAT",
} as const;

export type VatType = (typeof VAT_TYPES)[keyof typeof VAT_TYPES];

export const VAT_TYPE_ORDER: VatType[] = ["VATABLE", "ZERO_RATED", "EXEMPT", "MIXED", "NON_VAT"];

export const VAT_TYPE_META: Record<
  VatType,
  {
    label: string;
    hint: string;
    /** Whether the supplier must be VAT-registered, and so must show a TIN. */
    tinRequired: boolean;
    /** Whether any part of the sale bears 12%. */
    taxable: boolean;
  }
> = {
  VATABLE: {
    label: "VATable (12%)",
    hint: "The whole sale bears 12% VAT.",
    tinRequired: true,
    taxable: true,
  },
  ZERO_RATED: {
    label: "Zero-rated (0%)",
    hint: "A VAT sale taxed at 0% — typically exports and services to exempt entities.",
    tinRequired: true,
    taxable: false,
  },
  EXEMPT: {
    label: "VAT-exempt",
    hint: "Outside VAT under the Tax Code, e.g. Sec. 109.",
    tinRequired: false,
    taxable: false,
  },
  MIXED: {
    label: "Mixed",
    hint: "One invoice split between VATable, zero-rated and exempt sales.",
    tinRequired: true,
    taxable: true,
  },
  NON_VAT: {
    label: "Non-VAT",
    hint: "Supplier not VAT-registered. Bills no VAT and cannot give input tax.",
    tinRequired: false,
    taxable: false,
  },
};

export function isVatType(value: unknown): value is VatType {
  return typeof value === "string" && (VAT_TYPE_ORDER as string[]).includes(value);
}

/**
 * Above this, the approver must obtain the owner's authorisation before they
 * sign.
 *
 * This is a warning, not a routing rule. The owner is not a user of this
 * system: they authorise offline, nothing about their decision is recorded, and
 * the approver's signature remains the only one on file. `DEFAULT_TIERS` splits
 * on this same value, and a unit test pins the two together so they cannot
 * drift apart.
 */
export const OWNER_SIGNOFF_THRESHOLD_CENTS = 300_000_000; // ₱3,000,000.00

/**
 * BSP's per-transaction ceiling on InstaPay. Shown to the user in the method
 * description and respected when seeding payments; deliberately not enforced,
 * since the rail here is simulated and blocking on behalf of a rail we never
 * contact would invent a control the system cannot honour.
 */
export const INSTAPAY_MAX_CENTS = 100_000_000; // ₱1,000,000.00

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMIN: "ADMIN",
  APPROVER: "APPROVER",
  CLERK: "CLERK",
  AUDITOR: "AUDITOR",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_ORDER: Role[] = [ROLES.ADMIN, ROLES.APPROVER, ROLES.CLERK, ROLES.AUDITOR];

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  ADMIN: {
    label: "Administrator",
    description: "Full access, including users, approval rules, and billing.",
  },
  APPROVER: {
    label: "Approver",
    description: "Approves or rejects invoices and releases payments.",
  },
  CLERK: {
    label: "AP Clerk",
    description: "Enters and scans invoices and submits them for approval.",
  },
  AUDITOR: {
    label: "Auditor",
    description: "Read-only access to all records and the full audit trail.",
  },
};

// ---------------------------------------------------------------------------
// Invoice status
// ---------------------------------------------------------------------------

export const INVOICE_STATUS = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SCHEDULED: "SCHEDULED",
  PAID: "PAID",
  VOID: "VOID",
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warn" },
  APPROVED: { label: "Approved", tone: "accent-outline" },
  REJECTED: { label: "Rejected", tone: "danger" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  PAID: { label: "Paid", tone: "accent" },
  VOID: { label: "Void", tone: "neutral" },
};

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "PAID",
  "REJECTED",
  "VOID",
];

/** Statuses that still owe the vendor money. Drives the "outstanding" figure. */
export const OPEN_INVOICE_STATUSES: InvoiceStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
];

/** An invoice in one of these can no longer be edited by a clerk. */
export const LOCKED_INVOICE_STATUSES: InvoiceStatus[] = [
  "APPROVED",
  "SCHEDULED",
  "PAID",
  "VOID",
];

// ---------------------------------------------------------------------------
// Approval steps
// ---------------------------------------------------------------------------

export const APPROVAL_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SKIPPED: "SKIPPED",
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

export const APPROVAL_STATUS_META: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warn" },
  APPROVED: { label: "Approved", tone: "accent" },
  REJECTED: { label: "Rejected", tone: "danger" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_STATUS = {
  SCHEDULED: "SCHEDULED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; tone: Tone }> = {
  SCHEDULED: { label: "Scheduled", tone: "info" },
  PROCESSING: { label: "Processing", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "accent" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/** Philippine payment rails. PESONet first — it is the everyday default. */
export const PAYMENT_METHOD = {
  PESONET: "PESONET",
  INSTAPAY: "INSTAPAY",
  RTGS: "RTGS",
  CHECK: "CHECK",
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

export const PAYMENT_METHOD_META: Record<
  PaymentMethod,
  { label: string; settlementDays: number; description: string }
> = {
  PESONET: {
    label: "PESONet transfer",
    settlementDays: 1,
    description: "Batch clearing — credited the next banking day",
  },
  INSTAPAY: {
    label: "InstaPay transfer",
    settlementDays: 0,
    description: "Credited within minutes · ₱1,000,000 per transaction",
  },
  RTGS: {
    label: "RTGS bank transfer",
    settlementDays: 0,
    description: "Real-time gross settlement via PhilPaSSplus — same banking day",
  },
  CHECK: {
    label: "Cheque",
    settlementDays: 3,
    description: "Printed and released for clearing",
  },
};

export const BATCH_STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type BatchStatus = (typeof BATCH_STATUS)[keyof typeof BATCH_STATUS];

export const BATCH_STATUS_META: Record<BatchStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  PROCESSING: { label: "Processing", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "accent" },
  FAILED: { label: "Failed", tone: "danger" },
};

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export const VENDOR_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING_REVIEW: "PENDING_REVIEW",
} as const;

export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

export const VENDOR_STATUS_META: Record<VendorStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "accent-outline" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  PENDING_REVIEW: { label: "Pending review", tone: "warn" },
};

export const PAYMENT_TERMS = {
  DUE_ON_RECEIPT: "DUE_ON_RECEIPT",
  NET_15: "NET_15",
  NET_30: "NET_30",
  NET_45: "NET_45",
  NET_60: "NET_60",
} as const;

export type PaymentTerms = (typeof PAYMENT_TERMS)[keyof typeof PAYMENT_TERMS];

export const PAYMENT_TERMS_META: Record<PaymentTerms, { label: string; days: number }> = {
  DUE_ON_RECEIPT: { label: "Due on receipt", days: 0 },
  NET_15: { label: "Net 15", days: 15 },
  NET_30: { label: "Net 30", days: 30 },
  NET_45: { label: "Net 45", days: 45 },
  NET_60: { label: "Net 60", days: 60 },
};

/**
 * The seeded supplier roster is a fixed list, not a generated count. The
 * end-to-end checks pick vendors by position in the dropdown, so a drift here
 * silently breaks assumptions elsewhere; `verify:data` asserts it.
 */
export const SEED_VENDOR_COUNT = 12;

export const VENDOR_CATEGORIES = [
  "Software & SaaS",
  "Professional Services",
  "Facilities",
  "Logistics",
  "Marketing",
  "Hardware & Equipment",
  "Travel",
  "Utilities",
  "Insurance",
  "General",
] as const;

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

/** Standard AP aging ladder. `maxDays` null is the terminal bucket. */
export const AGING_BUCKETS = [
  { key: "current", label: "Current", minDays: -Infinity, maxDays: 0 },
  { key: "1-30", label: "1–30 days", minDays: 1, maxDays: 30 },
  { key: "31-60", label: "31–60 days", minDays: 31, maxDays: 60 },
  { key: "61-90", label: "61–90 days", minDays: 61, maxDays: 90 },
  { key: "90+", label: "Over 90 days", minDays: 91, maxDays: null },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = {
  USER_SIGNED_IN: "USER_SIGNED_IN",
  USER_SIGNED_OUT: "USER_SIGNED_OUT",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  USER_DEACTIVATED: "USER_DEACTIVATED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",

  INVOICE_CREATED: "INVOICE_CREATED",
  INVOICE_UPDATED: "INVOICE_UPDATED",
  INVOICE_SUBMITTED: "INVOICE_SUBMITTED",
  INVOICE_APPROVED: "INVOICE_APPROVED",
  INVOICE_REJECTED: "INVOICE_REJECTED",
  INVOICE_VOIDED: "INVOICE_VOIDED",
  INVOICE_ARCHIVED: "INVOICE_ARCHIVED",
  INVOICE_RESTORED: "INVOICE_RESTORED",
  INVOICE_OCR_PROCESSED: "INVOICE_OCR_PROCESSED",
  ATTACHMENT_UPLOADED: "ATTACHMENT_UPLOADED",
  ATTACHMENT_DELETED: "ATTACHMENT_DELETED",

  VENDOR_CREATED: "VENDOR_CREATED",
  VENDOR_UPDATED: "VENDOR_UPDATED",

  PAYMENT_SCHEDULED: "PAYMENT_SCHEDULED",
  PAYMENT_EXECUTED: "PAYMENT_EXECUTED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_CANCELLED: "PAYMENT_CANCELLED",
  BATCH_CREATED: "BATCH_CREATED",
  BATCH_EXECUTED: "BATCH_EXECUTED",

  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  THRESHOLD_UPDATED: "THRESHOLD_UPDATED",
  SUBSCRIPTION_UPDATED: "SUBSCRIPTION_UPDATED",
  DATA_EXPORTED: "DATA_EXPORTED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Verb shown in the audit log. Keep these past-tense and plain. */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  USER_SIGNED_IN: "Signed in",
  USER_SIGNED_OUT: "Signed out",
  USER_CREATED: "Created user",
  USER_UPDATED: "Updated user",
  USER_ROLE_CHANGED: "Changed role",
  USER_DEACTIVATED: "Deactivated user",
  PASSWORD_CHANGED: "Changed password",
  INVOICE_CREATED: "Created invoice",
  INVOICE_UPDATED: "Updated invoice",
  INVOICE_SUBMITTED: "Submitted for approval",
  INVOICE_APPROVED: "Approved invoice",
  INVOICE_REJECTED: "Rejected invoice",
  INVOICE_VOIDED: "Voided invoice",
  INVOICE_ARCHIVED: "Archived invoice",
  INVOICE_RESTORED: "Restored invoice",
  INVOICE_OCR_PROCESSED: "Scanned invoice",
  ATTACHMENT_UPLOADED: "Uploaded attachment",
  ATTACHMENT_DELETED: "Deleted attachment",
  VENDOR_CREATED: "Created vendor",
  VENDOR_UPDATED: "Updated vendor",
  PAYMENT_SCHEDULED: "Scheduled payment",
  PAYMENT_EXECUTED: "Executed payment",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_CANCELLED: "Cancelled payment",
  BATCH_CREATED: "Created payment batch",
  BATCH_EXECUTED: "Executed payment batch",
  SETTINGS_UPDATED: "Updated settings",
  THRESHOLD_UPDATED: "Updated approval rules",
  SUBSCRIPTION_UPDATED: "Updated subscription",
  DATA_EXPORTED: "Exported data",
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPE = {
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  INVOICE_APPROVED: "INVOICE_APPROVED",
  INVOICE_REJECTED: "INVOICE_REJECTED",
  PAYMENT_EXECUTED: "PAYMENT_EXECUTED",
  INVOICE_OVERDUE: "INVOICE_OVERDUE",
  SYSTEM: "SYSTEM",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export const PLANS = {
  STARTER: "STARTER",
  GROWTH: "GROWTH",
  ENTERPRISE: "ENTERPRISE",
} as const;

export type Plan = (typeof PLANS)[keyof typeof PLANS];

export const PLAN_META: Record<
  Plan,
  {
    label: string;
    pricePerSeatCents: number;
    tagline: string;
    invoiceLimit: string;
    features: string[];
  }
> = {
  STARTER: {
    label: "Starter",
    pricePerSeatCents: 109_900,
    tagline: "For teams putting a real approval process in place for the first time.",
    invoiceLimit: "200 invoices per month",
    features: [
      "Up to 5 users",
      "Single-step approvals",
      "Invoice scanning",
      "CSV export",
      "90-day audit history",
    ],
  },
  GROWTH: {
    label: "Growth",
    pricePerSeatCents: 229_900,
    tagline: "For finance teams that need routing rules and payment runs.",
    invoiceLimit: "2,000 invoices per month",
    features: [
      "Unlimited users",
      "Amount-based approval routing",
      "Batch payment runs",
      "CSV and PDF export",
      "Unlimited audit history",
      "Real-time status updates",
    ],
  },
  ENTERPRISE: {
    label: "Enterprise",
    pricePerSeatCents: 459_900,
    tagline: "For controllers who answer to auditors.",
    invoiceLimit: "Unlimited invoices",
    features: [
      "Everything in Growth",
      "Custom approval chains",
      "SSO and SCIM provisioning",
      "Dedicated support",
      "Data residency options",
    ],
  },
};

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export const SESSION_COOKIE = "apollo_session";
export const SIDEBAR_COOKIE = "apollo_sidebar";

/** Uploads accepted for OCR and attachment. Enforced server-side too. */
export const ACCEPTED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Avatar colours. Chosen to stay legible with white text and stay muted. */
export const AVATAR_COLORS = [
  "#1E2229",
  "#3A5A8C",
  "#5C6470",
  "#7A4B7E",
  "#166A5B",
  "#8C5A2B",
  "#9A1E14",
  "#2F5C3F",
] as const;
