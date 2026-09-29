/**
 * Seeds a believable six months of accounts-payable history.
 *
 * The generator is deterministic — a fixed-seed PRNG — so re-running produces
 * the same ledger and screenshots stay comparable between runs.
 *
 * The important property is internal consistency: approval steps match the
 * threshold rules that would have routed them, payments exist only for
 * invoices that reached an approved state, and every audit entry corresponds
 * to a change that actually appears in the data. An audit log that disagrees
 * with the ledger would make the whole screen a lie.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

import { DEFAULT_TIERS, planApprovals, type ThresholdTier } from "../lib/approvals/route-invoice";
import { CURRENCY, INSTAPAY_MAX_CENTS, LOCALE, VAT_RATE } from "../lib/constants";
import { formatCents } from "../lib/format";
import {
  APPROVAL_COMMENTS,
  COST_CENTERS,
  DEMO_PASSWORD,
  GL_ACCOUNTS,
  LINE_ITEMS_BY_CATEGORY,
  REJECTION_REASONS,
  SEED_USERS,
  SEED_VENDORS,
} from "./seed-data";

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and repeatable from a fixed seed. */
function makeRandom(seed: number) {
  let state = seed;
  return function random(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260805);

const randomInt = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const chance = (probability: number) => random() < probability;

/** Box–Muller, so invoice amounts cluster around the vendor's typical size. */
function gaussian(): number {
  const u = Math.max(random(), 1e-9);
  const v = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60 * 1000);

/** Nothing that has already happened may carry a future timestamp. */
const past = (date: Date) => (date > NOW ? addMinutes(NOW, -randomInt(30, 2000)) : date);

const TERM_DAYS: Record<string, number> = {
  DUE_ON_RECEIPT: 0,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60,
};

const NOW = new Date();
const HISTORY_START = addDays(NOW, -182); // Six months back.

const pad = (value: number, width: number) => String(value).padStart(width, "0");

// ---------------------------------------------------------------------------

async function main() {
  console.log("Seeding PoultryMax FMS…");

  await wipe();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const users = await seedUsers(passwordHash);
  const tiers = await seedSettings();
  const vendors = await seedVendors();

  await seedLedger({ users, tiers, vendors });

  console.log("\nDone. Sign in with any of these — password: %s", DEMO_PASSWORD);
  for (const user of SEED_USERS) {
    console.log("  %s  %s (%s)", user.email.padEnd(28), user.name, user.role);
  }
}

/** Child rows first — SQLite enforces the foreign keys. */
async function wipe() {
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.payment.deleteMany();
  await db.paymentBatch.deleteMany();
  await db.approvalStep.deleteMany();
  await db.attachment.deleteMany();
  await db.invoiceLineItem.deleteMany();
  await db.invoice.deleteMany();
  await db.vendor.deleteMany();
  await db.session.deleteMany();
  await db.subscriptionInvoice.deleteMany();
  await db.subscription.deleteMany();
  await db.approvalThreshold.deleteMany();
  await db.orgSettings.deleteMany();
  await db.user.deleteMany();
}

async function seedUsers(passwordHash: string) {
  await db.user.createMany({
    data: SEED_USERS.map((user, index) => ({
      id: user.id,
      email: user.email,
      passwordHash,
      name: user.name,
      role: user.role,
      title: user.title,
      avatarColor: user.avatarColor,
      isActive: true,
      lastLoginAt: addDays(NOW, -randomInt(0, 3)),
      // Everyone but the two clerks has finished onboarding, so the tour has
      // somewhere real to run without resetting the database.
      onboardingCompletedAt: index < 3 || index === 5 ? addDays(HISTORY_START, 2) : null,
      tourCompletedAt: index < 3 ? addDays(HISTORY_START, 2) : null,
      createdAt: addDays(HISTORY_START, -randomInt(30, 400)),
    })),
  });

  console.log("  %d users", SEED_USERS.length);
  return SEED_USERS.map((user) => ({ ...user }));
}

async function seedSettings(): Promise<ThresholdTier[]> {
  await db.orgSettings.create({
    data: {
      id: "singleton",
      orgName: "Apollo Financial Group",
      legalName: "Apollo Financial Group (Philippines), Inc.",
      // BIR TIN: nine digits plus a three-digit branch code, head office 000.
      taxId: "008-624-193-000",
      addressLine1: "Unit 2204, Almendras Corporate Centre, 168 Dela Rosa Street",
      city: "Makati",
      province: "Metro Manila",
      postalCode: "1227",
      defaultCurrency: "PHP",
      fiscalYearStartMonth: 1,
    },
  });

  await db.approvalThreshold.createMany({
    data: DEFAULT_TIERS.map((tier, index) => ({ id: `thr_${index}`, ...tier })),
  });

  const periodStart = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
  await db.subscription.create({
    data: {
      id: "singleton",
      plan: "GROWTH",
      status: "ACTIVE",
      seats: SEED_USERS.length,
      pricePerSeatCents: 229_900,
      billingInterval: "MONTHLY",
      currentPeriodStart: periodStart,
      currentPeriodEnd: new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1),
    },
  });

  // Twelve months of subscription billing history for the billing screen.
  await db.subscriptionInvoice.createMany({
    data: Array.from({ length: 12 }, (_, index) => {
      const start = new Date(NOW.getFullYear(), NOW.getMonth() - (11 - index), 1);
      const end = new Date(NOW.getFullYear(), NOW.getMonth() - (10 - index), 1);
      const isCurrent = index === 11;
      return {
        id: `sub_inv_${pad(index, 2)}`,
        subscriptionId: "singleton",
        number: `APL-${start.getFullYear()}-${pad(start.getMonth() + 1, 2)}`,
        amountCents: SEED_USERS.length * 229_900,
        status: isCurrent ? "OPEN" : "PAID",
        periodStart: start,
        periodEnd: end,
        issuedAt: start,
        paidAt: isCurrent ? null : addDays(start, 1),
      };
    }),
  });

  const tiers = await db.approvalThreshold.findMany();
  console.log("  settings, %d approval tiers, subscription", tiers.length);
  return tiers;
}

/**
 * A landline in the right shape for its area code. Metro Manila numbers are
 * eight digits beginning 8; the provinces run seven.
 */
/**
 * InstaPay stops at ₱1,000,000 a transaction. A real AP team routes around that
 * ceiling rather than letting the payment fail, so the vendor's preferred rail
 * stays their preference and the payment takes the one that can carry it.
 */
function railFor(preferred: string, amountCents: number): string {
  return preferred === "INSTAPAY" && amountCents > INSTAPAY_MAX_CENTS ? "PESONET" : preferred;
}

function phoneFor(areaCode: string): string {
  return areaCode === "02"
    ? `(02) 8${pad(randomInt(0, 999), 3)} ${pad(randomInt(0, 9999), 4)}`
    : `(${areaCode}) ${randomInt(200, 999)} ${pad(randomInt(0, 9999), 4)}`;
}

async function seedVendors() {
  const vendors = SEED_VENDORS.map((vendor, index) => ({
    ...vendor,
    id: `ven_${pad(index + 1, 4)}`,
    createdAt: addDays(HISTORY_START, -randomInt(10, 500)),
  }));

  await db.vendor.createMany({
    data: vendors.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      legalName: `${vendor.name}, ${pick(["Inc.", "Corporation", "Philippines, Inc."])}`,
      // BIR TIN: nine digits plus a branch code, head office 000.
      taxId: `${pad(randomInt(0, 999), 3)}-${pad(randomInt(0, 999), 3)}-${pad(randomInt(0, 999), 3)}-000`,
      email: `ap@${slug(vendor.name)}.com.ph`,
      phone: phoneFor(vendor.areaCode),
      website: `https://www.${slug(vendor.name)}.com.ph`,
      addressLine1: `${chance(0.4) ? `Unit ${randomInt(2, 24)}${pick(["A", "B", "C"])}, ` : `${randomInt(50, 2800)} `}${pick(["Ayala", "Sen. Gil Puyat", "Ortigas", "Shaw", "Katipunan", "Osmeña", "Rizal", "Bonifacio", "Legaspi", "Dela Rosa"])} ${pick(["Avenue", "Street", "Extension", "Boulevard"])}`,
      city: vendor.city,
      province: vendor.province,
      postalCode: vendor.postalCode,
      paymentTerms: vendor.terms,
      defaultPaymentMethod: vendor.method,
      bankName: pick([
        "BDO Unibank",
        "Bank of the Philippine Islands",
        "Metrobank",
        "Security Bank",
        "Land Bank of the Philippines",
        "UnionBank of the Philippines",
      ]),
      bankAccountLast4: pad(randomInt(0, 9999), 4),
      category: vendor.category,
      // Fixed on the roster rather than rolled — see the note in seed-data.ts.
      status: vendor.status,
      createdAt: vendor.createdAt,
    })),
  });

  console.log("  %d vendors", vendors.length);

  // Read back rather than generated up here: the TIN is rolled inside the
  // createMany above, and moving that roll would shift every random value
  // after it and quietly reshape the whole ledger.
  const tins = new Map(
    (await db.vendor.findMany({ select: { id: true, taxId: true } })).map((row) => [row.id, row.taxId]),
  );
  return vendors.map((vendor) => ({ ...vendor, taxId: tins.get(vendor.id) ?? null }));
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

type SeedUser = { id: string; name: string; role: string; email: string };
type SeedVendor = (typeof SEED_VENDORS)[number] & { id: string; createdAt: Date; taxId: string | null };

const INVOICE_COUNT = 284;

/** How the six months of invoices are distributed across statuses. */
const STATUS_WEIGHTS: Array<[string, number]> = [
  ["PAID", 0.44],
  ["PENDING_APPROVAL", 0.14],
  ["DRAFT", 0.1],
  ["SCHEDULED", 0.08],
  ["APPROVED", 0.08],
  ["REJECTED", 0.07],
  ["VOID", 0.03],
  ["ARCHIVED_PAID", 0.06],
];

function rollStatus(): string {
  const roll = random();
  let cumulative = 0;
  for (const [status, weight] of STATUS_WEIGHTS) {
    cumulative += weight;
    if (roll <= cumulative) return status;
  }
  return "PAID";
}

async function seedLedger({
  users,
  tiers,
  vendors,
}: {
  users: readonly SeedUser[];
  tiers: ThresholdTier[];
  vendors: SeedVendor[];
}) {
  const clerks = users.filter((user) => user.role === "CLERK");
  const approvers = users.filter((user) => user.role === "APPROVER");
  const admin = users.find((user) => user.role === "ADMIN")!;

  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const lineRows: Prisma.InvoiceLineItemCreateManyInput[] = [];
  const stepRows: Prisma.ApprovalStepCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  const batchRows: Prisma.PaymentBatchCreateManyInput[] = [];
  const auditRows: Prisma.AuditLogCreateManyInput[] = [];
  const notificationRows: Prisma.NotificationCreateManyInput[] = [];

  const usedNumbers = new Set<string>();
  let paymentSeq = 0;
  let auditSeq = 0;
  let notificationSeq = 0;

  const audit = (entry: {
    at: Date;
    actor: SeedUser;
    action: string;
    entityType: string;
    entityId: string;
    entityLabel: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }) => {
    auditRows.push({
      id: `aud_${pad(auditSeq++, 5)}`,
      actorId: entry.actor.id,
      actorName: entry.actor.name,
      actorRole: entry.actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel,
      summary: entry.summary,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: `10.24.${randomInt(1, 40)}.${randomInt(2, 250)}`,
      createdAt: entry.at,
    });
  };

  const notify = (entry: {
    at: Date;
    userId: string;
    type: string;
    title: string;
    body: string;
    linkUrl: string;
    read: boolean;
  }) => {
    notificationRows.push({
      id: `ntf_${pad(notificationSeq++, 4)}`,
      userId: entry.userId,
      type: entry.type,
      title: entry.title,
      body: entry.body,
      linkUrl: entry.linkUrl,
      readAt: entry.read ? addMinutes(entry.at, randomInt(5, 900)) : null,
      createdAt: entry.at,
    });
  };

  // Vendor onboarding entries, so the audit log does not begin mid-story.
  for (const vendor of vendors) {
    audit({
      at: vendor.createdAt,
      actor: pick(clerks),
      action: "VENDOR_CREATED",
      entityType: "Vendor",
      entityId: vendor.id,
      entityLabel: vendor.name,
      summary: `Added vendor ${vendor.name}`,
    });
  }

  for (let index = 0; index < INVOICE_COUNT; index++) {
    const vendor = pick(vendors);
    const invoiceId = `inv_${pad(index + 1, 4)}`;

    // Vendor invoice numbers must be unique per vendor — the schema enforces it.
    let invoiceNumber: string;
    do {
      invoiceNumber = `${vendor.prefix}-${NOW.getFullYear()}-${pad(randomInt(1, 9999), 4)}`;
    } while (usedNumbers.has(`${vendor.id}:${invoiceNumber}`));
    usedNumbers.add(`${vendor.id}:${invoiceNumber}`);

    const rolled = rollStatus();
    const archived = rolled === "ARCHIVED_PAID";
    const status = archived ? "PAID" : rolled;

    // Archived work is old work; drafts and pending items are recent.
    const ageDays = archived
      ? randomInt(120, 182)
      : status === "DRAFT" || status === "PENDING_APPROVAL"
        ? randomInt(0, 21)
        : randomInt(3, 175);

    const issueDate = addDays(NOW, -ageDays);
    const dueDate = addDays(issueDate, TERM_DAYS[vendor.terms] ?? 30);
    // An invoice issued today is keyed in hours later, not days — clamp so a
    // fresh invoice is never recorded as created in the future.
    const createdAt = past(addMinutes(issueDate, randomInt(60, 2000)));

    const creator = chance(0.92) ? pick(clerks) : admin;

    // Amount: log-normal around the vendor's typical invoice size, except for
    // a small-ticket tail. Real AP is full of couriers, meryenda, and single
    // seat licences — and under this ladder a ₱1,500 courier bill needs a
    // signature exactly as a ₱4,000,000 one does, so the ledger should show
    // invoices that small rather than pretending they do not arrive.
    const smallTicket = chance(0.1);
    const multiplier = Math.exp(gaussian() * 0.5);
    const targetCents = smallTicket
      ? randomInt(150_000, 4_500_000) // ₱1,500 to ₱45,000
      : Math.max(4_500, Math.round(vendor.typical * 100 * multiplier));

    const catalogue = LINE_ITEMS_BY_CATEGORY[vendor.category] ?? LINE_ITEMS_BY_CATEGORY.General!;
    const lineCount = randomInt(1, Math.min(5, catalogue.length));
    const lines = buildLines(targetCents, lineCount, catalogue);

    const subtotalCents = lines.reduce((total, line) => total + line.amountCents, 0);
    // VAT is a property of the supplier, not a per-invoice coin flip: a
    // VAT-registered supplier bills 12% on everything, and the rest bill none.
    const taxCents = vendor.vatRegistered ? Math.round(subtotalCents * VAT_RATE) : 0;
    const totalCents = subtotalCents + taxCents;

    lines.forEach((line, lineIndex) => {
      lineRows.push({
        id: `lin_${pad(index + 1, 4)}_${lineIndex}`,
        invoiceId,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.amountCents,
        glAccount: chance(0.6) ? pick(GL_ACCOUNTS) : null,
        sortOrder: lineIndex,
      });
    });

    // Routing is computed from the same rules the running app uses, so the
    // seeded chains are exactly what a submit today would produce.
    const plan = planApprovals(totalCents, tiers);
    const submittedAt =
      status === "DRAFT" ? null : past(addMinutes(createdAt, randomInt(30, 4000)));

    let approvedAt: Date | null = null;
    let rejectedAt: Date | null = null;
    let rejectionReason: string | null = null;
    let paidAt: Date | null = null;

    const decidedSteps: Array<{ approver: SeedUser; at: Date; approved: boolean; comment: string }> = [];

    if (submittedAt && plan.steps.length > 0) {
      // Distinct approvers per step, and never the person who entered it.
      const eligible = approvers.filter((user) => user.id !== creator.id);
      const pool = [...eligible, ...(admin.id === creator.id ? [] : [admin])];

      const decideAll = ["APPROVED", "SCHEDULED", "PAID"].includes(status);
      const decideFirstOnly = status === "REJECTED";
      const partial = status === "PENDING_APPROVAL" && plan.steps.length > 1 && chance(0.45);

      let cursor = submittedAt;
      plan.steps.forEach((step, stepIndex) => {
        const approver = pool[stepIndex % pool.length]!;
        const stepId = `app_${pad(index + 1, 4)}_${step.sequence}`;

        const decides =
          decideAll || (decideFirstOnly && stepIndex === 0) || (partial && stepIndex === 0);

        if (!decides) {
          stepRows.push({
            id: stepId,
            invoiceId,
            sequence: step.sequence,
            requiredRole: step.requiredRole,
            approverId: null,
            status: status === "VOID" ? "SKIPPED" : "PENDING",
            createdAt: submittedAt,
          });
          return;
        }

        cursor = past(addMinutes(cursor, randomInt(120, 5000)));
        const approved = !decideFirstOnly;
        const comment = approved ? pick(APPROVAL_COMMENTS) : pick(REJECTION_REASONS);

        stepRows.push({
          id: stepId,
          invoiceId,
          sequence: step.sequence,
          requiredRole: step.requiredRole,
          approverId: approver.id,
          status: approved ? "APPROVED" : "REJECTED",
          decidedAt: cursor,
          comment: comment || null,
          createdAt: submittedAt,
        });

        decidedSteps.push({ approver, at: cursor, approved, comment });

        if (approved && stepIndex === plan.steps.length - 1) approvedAt = cursor;
        if (!approved) {
          rejectedAt = cursor;
          rejectionReason = comment;
        }
      });
    } else if (submittedAt && plan.autoApprove && status !== "REJECTED") {
      // Below the threshold: approved on submission, no step rows.
      approvedAt = past(addMinutes(submittedAt, 1));
    }

    if (status === "REJECTED" && !rejectedAt) {
      rejectedAt = past(addMinutes(submittedAt ?? createdAt, randomInt(120, 3000)));
      rejectionReason = pick(REJECTION_REASONS);
    }

    if (status === "PAID") {
      approvedAt = approvedAt ?? past(addMinutes(submittedAt ?? createdAt, randomInt(120, 4000)));
      paidAt = past(addDays(approvedAt, randomInt(1, 12)));
    }

    invoiceRows.push({
      id: invoiceId,
      invoiceNumber,
      vendorId: vendor.id,
      status,
      issueDate,
      dueDate,
      currency: CURRENCY,
      subtotalCents,
      taxCents,
      totalCents,
      // Registered suppliers bill a plain VATable sale; the rest are outside VAT.
      vatType: vendor.vatRegistered ? "VATABLE" : "NON_VAT",
      vatableSalesCents: vendor.vatRegistered ? subtotalCents : 0,
      supplierTin: vendor.taxId,
      amountPaidCents: status === "PAID" ? totalCents : 0,
      poNumber: chance(0.55) ? `PO-${randomInt(10000, 99999)}` : null,
      description: chance(0.4) ? `${vendor.category} — ${monthName(issueDate)} services` : null,
      glAccount: chance(0.7) ? pick(GL_ACCOUNTS) : null,
      costCenter: chance(0.65) ? pick(COST_CENTERS) : null,
      createdById: creator.id,
      requiredApprovals: plan.steps.length,
      submittedAt,
      approvedAt,
      rejectedAt,
      rejectionReason,
      paidAt,
      // Roughly a third arrived by scan rather than by hand.
      ocrConfidence: chance(0.34) ? Number((0.72 + random() * 0.27).toFixed(3)) : null,
      archivedAt: archived ? past(addDays(paidAt ?? NOW, randomInt(14, 40))) : null,
      createdAt,
      updatedAt: paidAt ?? rejectedAt ?? approvedAt ?? submittedAt ?? createdAt,
    });

    // --- Audit and notifications, following the same story -------------------

    audit({
      at: createdAt,
      actor: creator,
      action: "INVOICE_CREATED",
      entityType: "Invoice",
      entityId: invoiceId,
      entityLabel: invoiceNumber,
      summary: `Created invoice ${invoiceNumber} for ${vendor.name}`,
      metadata: { total: totalCents / 100, vendor: vendor.name },
    });

    if (submittedAt) {
      audit({
        at: submittedAt,
        actor: creator,
        action: "INVOICE_SUBMITTED",
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoiceNumber,
        summary: plan.autoApprove
          ? `Submitted ${invoiceNumber} — auto-approved below threshold`
          : `Submitted ${invoiceNumber} for ${plan.steps.length} approval${plan.steps.length === 1 ? "" : "s"}`,
      });

      // Tell the approvers who still owe a decision.
      if (status === "PENDING_APPROVAL") {
        for (const approver of approvers.filter((user) => user.id !== creator.id)) {
          notify({
            at: submittedAt,
            userId: approver.id,
            type: "APPROVAL_REQUESTED",
            title: `${invoiceNumber} needs your approval`,
            body: `${vendor.name} · ${formatCents(totalCents)}`,
            linkUrl: `/invoices/${invoiceId}`,
            read: chance(0.45),
          });
        }
      }
    }

    for (const decision of decidedSteps) {
      audit({
        at: decision.at,
        actor: decision.approver,
        action: decision.approved ? "INVOICE_APPROVED" : "INVOICE_REJECTED",
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoiceNumber,
        summary: decision.approved
          ? `Approved invoice ${invoiceNumber}`
          : `Rejected invoice ${invoiceNumber}`,
        metadata: decision.comment ? { comment: decision.comment } : undefined,
      });

      notify({
        at: decision.at,
        userId: creator.id,
        type: decision.approved ? "INVOICE_APPROVED" : "INVOICE_REJECTED",
        title: decision.approved
          ? `${invoiceNumber} was approved`
          : `${invoiceNumber} was rejected`,
        body: decision.approved
          ? `${decision.approver.name} approved ${formatCents(totalCents)} to ${vendor.name}`
          : decision.comment,
        linkUrl: `/invoices/${invoiceId}`,
        read: chance(0.6),
      });
    }

    // --- Payments ------------------------------------------------------------

    if (status === "PAID" || status === "SCHEDULED") {
      paymentSeq += 1;
      const paymentId = `pay_${pad(paymentSeq, 4)}`;
      const paymentNumber = `PAY-${NOW.getFullYear()}-${pad(paymentSeq, 5)}`;
      const initiator = chance(0.7) ? pick(approvers) : admin;

      // Two distinct instants, and conflating them puts audit entries in the
      // future: `scheduledDate` is when the money moves (ahead of now for a
      // payment still queued), `scheduledAt` is when a person pressed the
      // button. The audit trail records the latter.
      const scheduledDate =
        status === "PAID" ? addDays(paidAt!, -1) : addDays(NOW, randomInt(1, 12));
      const scheduledAt =
        status === "PAID" ? addDays(paidAt!, -1) : addDays(NOW, -randomInt(0, 6));

      const rail = railFor(vendor.method, totalCents);

      paymentRows.push({
        id: paymentId,
        paymentNumber,
        invoiceId,
        method: rail,
        amountCents: totalCents,
        status: status === "PAID" ? "COMPLETED" : "SCHEDULED",
        scheduledDate,
        executedDate: status === "PAID" ? paidAt : null,
        reference:
          status === "PAID"
            ? `${rail}${randomInt(100000000, 999999999)}`
            : null,
        memo: `${invoiceNumber} · ${vendor.name}`,
        initiatedById: initiator.id,
        createdAt: scheduledAt,
        updatedAt: paidAt ?? scheduledAt,
      });

      audit({
        at: scheduledAt,
        actor: initiator,
        action: "PAYMENT_SCHEDULED",
        entityType: "Payment",
        entityId: paymentId,
        entityLabel: paymentNumber,
        summary: `Scheduled ${formatCents(totalCents)} to ${vendor.name} by ${rail}`,
      });

      if (status === "PAID") {
        audit({
          at: paidAt!,
          actor: initiator,
          action: "PAYMENT_EXECUTED",
          entityType: "Payment",
          entityId: paymentId,
          entityLabel: paymentNumber,
          summary: `Paid ${formatCents(totalCents)} to ${vendor.name}`,
        });

        notify({
          at: paidAt!,
          userId: creator.id,
          type: "PAYMENT_EXECUTED",
          title: `${invoiceNumber} was paid`,
          body: `${formatCents(totalCents)} sent to ${vendor.name}`,
          linkUrl: `/invoices/${invoiceId}`,
          read: chance(0.8),
        });
      }
    }

    if (archived) {
      audit({
        at: past(addDays(paidAt ?? NOW, 20)),
        actor: admin,
        action: "INVOICE_ARCHIVED",
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoiceNumber,
        summary: `Archived invoice ${invoiceNumber}`,
      });
    }

    if (status === "VOID") {
      audit({
        at: past(addMinutes(createdAt, randomInt(200, 6000))),
        actor: admin,
        action: "INVOICE_VOIDED",
        entityType: "Invoice",
        entityId: invoiceId,
        entityLabel: invoiceNumber,
        summary: `Voided invoice ${invoiceNumber}`,
      });
    }
  }

  // --- Group completed payments into weekly runs -----------------------------

  const completed = paymentRows.filter((payment) => payment.status === "COMPLETED");
  const perBatch = 9;
  for (let index = 0; index * perBatch < completed.length; index++) {
    const slice = completed.slice(index * perBatch, (index + 1) * perBatch);
    if (slice.length < 3) break;

    const batchId = `bat_${pad(index + 1, 3)}`;
    const executed = slice
      .map((payment) => payment.executedDate as Date)
      .reduce((latest, date) => (date > latest ? date : latest), slice[0]!.executedDate as Date);

    batchRows.push({
      id: batchId,
      batchNumber: `RUN-${NOW.getFullYear()}-${pad(index + 1, 3)}`,
      status: "COMPLETED",
      totalCents: slice.reduce((total, payment) => total + (payment.amountCents as number), 0),
      itemCount: slice.length,
      scheduledDate: addDays(executed, -1),
      executedDate: executed,
      createdById: "usr_approver",
      createdAt: addDays(executed, -1),
      updatedAt: executed,
    });

    for (const payment of slice) payment.batchId = batchId;
  }

  // Sign-in history, so the audit log shows access as well as changes.
  for (let index = 0; index < 48; index++) {
    const actor = pick(users);
    audit({
      at: addDays(NOW, -randomInt(0, 30)),
      actor,
      action: "USER_SIGNED_IN",
      entityType: "Session",
      entityId: `ses_seed_${index}`,
      entityLabel: actor.email,
      summary: `${actor.name} signed in`,
    });
  }

  await db.invoice.createMany({ data: invoiceRows });
  await db.invoiceLineItem.createMany({ data: lineRows });
  await db.approvalStep.createMany({ data: stepRows });
  await db.paymentBatch.createMany({ data: batchRows });
  await db.payment.createMany({ data: paymentRows });
  await db.notification.createMany({ data: notificationRows });
  await db.auditLog.createMany({ data: auditRows });

  console.log(
    "  %d invoices, %d line items, %d approval steps",
    invoiceRows.length,
    lineRows.length,
    stepRows.length,
  );
  console.log("  %d payments in %d runs", paymentRows.length, batchRows.length);
  console.log("  %d notifications, %d audit entries", notificationRows.length, auditRows.length);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Splits a target amount across N lines with plausible quantities and unit
 * prices. The last line absorbs the rounding so the lines always sum exactly
 * to the subtotal — an invoice whose lines do not add up is a bug a finance
 * reader spots immediately.
 */
function buildLines(targetCents: number, count: number, catalogue: string[]) {
  const chosen = new Set<string>();
  while (chosen.size < count) chosen.add(pick(catalogue));
  const descriptions = [...chosen];

  const weights = descriptions.map(() => 0.5 + random());
  const weightTotal = weights.reduce((total, weight) => total + weight, 0);

  let allocated = 0;
  return descriptions.map((description, index) => {
    const isLast = index === descriptions.length - 1;
    const share = isLast
      ? targetCents - allocated
      : Math.round((targetCents * weights[index]!) / weightTotal);
    allocated += share;

    const quantity = chance(0.45) ? randomInt(2, 40) : 1;
    const unitPriceCents = Math.max(1, Math.round(share / quantity));

    return {
      description,
      quantity,
      unitPriceCents,
      // Recomputed from quantity × unit price so the line maths is honest.
      amountCents: unitPriceCents * quantity,
    };
  });
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

function monthName(date: Date): string {
  return date.toLocaleString(LOCALE, { month: "long" });
}


main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
