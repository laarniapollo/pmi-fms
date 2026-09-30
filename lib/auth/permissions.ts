import {
  LOCKED_INVOICE_STATUSES,
  ROLES,
  type InvoiceStatus,
  type Role,
} from "@/lib/constants";

/**
 * The only place in the application that decides who may do what.
 *
 * Route handlers, server actions, and components all call `can()`. Nothing
 * infers permission from a role comparison inline — a second opinion about
 * authorization is how a system ends up with two answers.
 *
 * Two layers of rule live here:
 *
 *   1. The role matrix below: a coarse "may this role ever do this?".
 *   2. Resource refinements in `can()`: state and ownership checks that no
 *      role escapes, including Admin. Separation of duties lives here.
 */

export type Action =
  | "invoice:view"
  | "invoice:create"
  | "invoice:edit"
  | "invoice:submit"
  | "invoice:approve"
  | "invoice:void"
  | "invoice:archive"
  | "invoice:scan"
  | "attachment:upload"
  | "vendor:view"
  | "vendor:manage"
  | "payment:view"
  | "payment:manage"
  | "audit:view"
  | "export:run"
  | "settings:manage"
  | "users:manage"
  | "billing:manage"
  | "purchaseRequest:view"
  | "purchaseRequest:manage"
  | "purchaseOrder:view"
  | "purchaseOrder:manage";

/** The minimum a caller must supply. Accepts a full Prisma `User`. */
export interface Actor {
  id: string;
  role: string;
  isActive: boolean;
}

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  [ROLES.ADMIN]: new Set<Action>([
    "invoice:view",
    "invoice:create",
    "invoice:edit",
    "invoice:submit",
    "invoice:approve",
    "invoice:void",
    "invoice:archive",
    "invoice:scan",
    "attachment:upload",
    "vendor:view",
    "vendor:manage",
    "payment:view",
    "payment:manage",
    "audit:view",
    "export:run",
    "settings:manage",
    "users:manage",
    "billing:manage",
    "purchaseRequest:view",
    "purchaseRequest:manage",
    "purchaseOrder:view",
    "purchaseOrder:manage",
  ]),
  [ROLES.APPROVER]: new Set<Action>([
    "invoice:view",
    "invoice:approve",
    "invoice:void",
    "invoice:archive",
    "vendor:view",
    "payment:view",
    "payment:manage",
    "audit:view",
    "export:run",
  ]),
  [ROLES.CLERK]: new Set<Action>([
    "invoice:view",
    "invoice:create",
    "invoice:edit",
    "invoice:submit",
    "invoice:scan",
    "attachment:upload",
    "vendor:view",
    "vendor:manage",
    "payment:view",
    "export:run",
  ]),
  [ROLES.AUDITOR]: new Set<Action>([
    "invoice:view",
    "vendor:view",
    "payment:view",
    "audit:view",
    "export:run",
  ]),
};

/** Subject of a resource-scoped check. Omit for a coarse capability question. */
export interface InvoiceSubject {
  kind: "invoice";
  createdById: string;
  status: InvoiceStatus | string;
  archivedAt?: Date | null;
}

export type Subject = InvoiceSubject;

function isRole(value: string): value is Role {
  return value in MATRIX;
}

/**
 * Returns true when `actor` may perform `action`, optionally against a
 * specific `subject`.
 *
 * Called without a subject it answers the general question — use that to
 * decide whether to render a button at all. Called with one it also applies
 * the state and ownership rules, which is what a mutation must check.
 */
export function can(actor: Actor | null | undefined, action: Action, subject?: Subject): boolean {
  if (!actor || !actor.isActive) return false;
  if (!isRole(actor.role)) return false;
  if (!MATRIX[actor.role].has(action)) return false;
  if (!subject) return true;

  if (subject.kind === "invoice") return checkInvoice(actor, action, subject);
  return true;
}

function checkInvoice(actor: Actor, action: Action, invoice: InvoiceSubject): boolean {
  const archived = Boolean(invoice.archivedAt);

  switch (action) {
    case "invoice:approve":
      // Separation of duties. The person who entered an invoice may never
      // approve it, and no role — Admin included — is exempt. This is the
      // control an auditor will actually test.
      if (invoice.createdById === actor.id) return false;
      if (invoice.status !== "PENDING_APPROVAL") return false;
      return !archived;

    case "invoice:edit":
      // Once approved, an invoice is a financial commitment. Amending it
      // would invalidate the sign-offs already recorded against it.
      if (LOCKED_INVOICE_STATUSES.includes(invoice.status as InvoiceStatus)) return false;
      return !archived;

    case "invoice:submit":
      // Rejected invoices are correctable and can go round again.
      return (invoice.status === "DRAFT" || invoice.status === "REJECTED") && !archived;

    case "invoice:void":
      return invoice.status !== "PAID" && invoice.status !== "VOID" && !archived;

    case "invoice:archive":
      // Only settled work leaves the active ledger.
      return ["PAID", "VOID", "REJECTED"].includes(invoice.status);

    case "attachment:upload":
      if (LOCKED_INVOICE_STATUSES.includes(invoice.status as InvoiceStatus)) return false;
      return !archived;

    default:
      return true;
  }
}

/**
 * Throwing counterpart for server actions and route handlers. Catch
 * `PermissionError` at the boundary and map it to a 403.
 */
export class PermissionError extends Error {
  readonly status = 403;
  constructor(action: Action) {
    super(`Not permitted: ${action}`);
    this.name = "PermissionError";
  }
}

export function assertCan(
  actor: Actor | null | undefined,
  action: Action,
  subject?: Subject,
): void {
  if (!can(actor, action, subject)) throw new PermissionError(action);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Which top-level destinations a role can reach. The sidebar renders from
 * this, and `middleware.ts` uses it to bounce direct URL access, so a hidden
 * link and a blocked route can never disagree.
 */
export const ROUTE_REQUIREMENTS: Array<{ prefix: string; action: Action }> = [
  { prefix: "/invoices/new", action: "invoice:create" },
  { prefix: "/invoices", action: "invoice:view" },
  { prefix: "/vendors", action: "vendor:view" },
  { prefix: "/approvals", action: "invoice:approve" },
  { prefix: "/payments", action: "payment:view" },
  { prefix: "/audit", action: "audit:view" },
  { prefix: "/archive", action: "invoice:view" },
  { prefix: "/settings/users", action: "users:manage" },
  { prefix: "/settings/billing", action: "billing:manage" },
  { prefix: "/settings/rules", action: "settings:manage" },
  { prefix: "/settings/organization", action: "settings:manage" },
  { prefix: "/purchase-requests", action: "purchaseRequest:view" },
  { prefix: "/purchase-orders", action: "purchaseOrder:view" },
];

/** Returns the action guarding `pathname`, or null when it is open to all. */
export function requiredActionForPath(pathname: string): Action | null {
  const match = ROUTE_REQUIREMENTS.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
  );
  return match?.action ?? null;
}

export function canAccessPath(actor: Actor | null | undefined, pathname: string): boolean {
  const action = requiredActionForPath(pathname);
  if (!action) return Boolean(actor?.isActive);
  return can(actor, action);
}
