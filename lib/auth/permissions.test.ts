import { describe, expect, it } from "vitest";

import { can, canAccessPath, type Actor, type InvoiceSubject } from "./permissions";
import { ROLES } from "@/lib/constants";

const admin: Actor = { id: "u_admin", role: ROLES.ADMIN, isActive: true };
const approver: Actor = { id: "u_approver", role: ROLES.APPROVER, isActive: true };
const clerk: Actor = { id: "u_clerk", role: ROLES.CLERK, isActive: true };
const auditor: Actor = { id: "u_auditor", role: ROLES.AUDITOR, isActive: true };

function invoice(overrides: Partial<InvoiceSubject> = {}): InvoiceSubject {
  return {
    kind: "invoice",
    createdById: "u_clerk",
    status: "PENDING_APPROVAL",
    archivedAt: null,
    ...overrides,
  };
}

describe("role matrix", () => {
  it("lets only admins manage users, settings, and billing", () => {
    for (const action of ["users:manage", "settings:manage", "billing:manage"] as const) {
      expect(can(admin, action)).toBe(true);
      expect(can(approver, action)).toBe(false);
      expect(can(clerk, action)).toBe(false);
      expect(can(auditor, action)).toBe(false);
    }
  });

  it("lets clerks enter invoices but never approve them", () => {
    expect(can(clerk, "invoice:create")).toBe(true);
    expect(can(clerk, "invoice:scan")).toBe(true);
    expect(can(clerk, "invoice:approve")).toBe(false);
    expect(can(clerk, "payment:manage")).toBe(false);
  });

  it("lets approvers approve and pay but never enter an invoice", () => {
    expect(can(approver, "invoice:approve")).toBe(true);
    expect(can(approver, "payment:manage")).toBe(true);
    expect(can(approver, "invoice:create")).toBe(false);
    expect(can(approver, "invoice:edit")).toBe(false);
  });

  it("gives auditors read access and exports, and nothing that writes", () => {
    expect(can(auditor, "invoice:view")).toBe(true);
    expect(can(auditor, "audit:view")).toBe(true);
    expect(can(auditor, "export:run")).toBe(true);
    expect(can(auditor, "invoice:create")).toBe(false);
    expect(can(auditor, "invoice:approve")).toBe(false);
    expect(can(auditor, "payment:manage")).toBe(false);
  });

  it("refuses everything to a deactivated user or no user at all", () => {
    expect(can({ ...admin, isActive: false }, "invoice:view")).toBe(false);
    expect(can(null, "invoice:view")).toBe(false);
    expect(can(undefined, "invoice:view")).toBe(false);
  });

  it("refuses an unrecognised role rather than defaulting it open", () => {
    expect(can({ id: "u_x", role: "SUPERUSER", isActive: true }, "invoice:view")).toBe(false);
  });

  it("lets admins and clerks manage vendors, and no one else", () => {
    expect(can(admin, "vendor:manage")).toBe(true);
    expect(can(clerk, "vendor:manage")).toBe(true);
    expect(can(approver, "vendor:manage")).toBe(false);
    expect(can(auditor, "vendor:manage")).toBe(false);
  });

  it("gives every role read access to vendors", () => {
    for (const actor of [admin, approver, clerk, auditor]) {
      expect(can(actor, "vendor:view")).toBe(true);
    }
  });

  it("refuses vendor:manage to a deactivated admin", () => {
    expect(can({ ...admin, isActive: false }, "vendor:manage")).toBe(false);
  });
});

describe("separation of duties", () => {
  it("stops the person who entered an invoice approving it", () => {
    expect(can(clerk, "invoice:approve", invoice({ createdById: clerk.id }))).toBe(false);
  });

  it("applies to admins too — no role is exempt", () => {
    const ownInvoice = invoice({ createdById: admin.id });
    expect(can(admin, "invoice:approve", ownInvoice)).toBe(false);
    // The same admin may approve one somebody else entered.
    expect(can(admin, "invoice:approve", invoice({ createdById: "u_other" }))).toBe(true);
  });

  it("lets a different approver decide", () => {
    expect(can(approver, "invoice:approve", invoice({ createdById: clerk.id }))).toBe(true);
  });

  it("only allows approval while the invoice is awaiting it", () => {
    for (const status of ["DRAFT", "APPROVED", "REJECTED", "PAID", "VOID", "SCHEDULED"]) {
      expect(can(approver, "invoice:approve", invoice({ status }))).toBe(false);
    }
  });

  it("refuses approval of an archived invoice", () => {
    expect(can(approver, "invoice:approve", invoice({ archivedAt: new Date() }))).toBe(false);
  });
});

describe("invoice state rules", () => {
  it("locks editing once an invoice is approved or beyond", () => {
    for (const status of ["APPROVED", "SCHEDULED", "PAID", "VOID"]) {
      expect(can(clerk, "invoice:edit", invoice({ status }))).toBe(false);
    }
    for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED"]) {
      expect(can(clerk, "invoice:edit", invoice({ status }))).toBe(true);
    }
  });

  it("allows a rejected invoice to be corrected and resubmitted", () => {
    expect(can(clerk, "invoice:submit", invoice({ status: "REJECTED" }))).toBe(true);
    expect(can(clerk, "invoice:submit", invoice({ status: "DRAFT" }))).toBe(true);
    expect(can(clerk, "invoice:submit", invoice({ status: "PENDING_APPROVAL" }))).toBe(false);
  });

  it("only archives settled work", () => {
    for (const status of ["PAID", "VOID", "REJECTED"]) {
      expect(can(admin, "invoice:archive", invoice({ status }))).toBe(true);
    }
    for (const status of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"]) {
      expect(can(admin, "invoice:archive", invoice({ status }))).toBe(false);
    }
  });

  it("refuses to void an invoice already paid or already void", () => {
    expect(can(admin, "invoice:void", invoice({ status: "PAID" }))).toBe(false);
    expect(can(admin, "invoice:void", invoice({ status: "VOID" }))).toBe(false);
    expect(can(admin, "invoice:void", invoice({ status: "APPROVED" }))).toBe(true);
  });

  it("blocks uploads to a locked invoice", () => {
    expect(can(clerk, "attachment:upload", invoice({ status: "PAID" }))).toBe(false);
    expect(can(clerk, "attachment:upload", invoice({ status: "DRAFT" }))).toBe(true);
  });
});

describe("route guarding", () => {
  it("keeps clerks out of approvals and admin settings", () => {
    expect(canAccessPath(clerk, "/approvals")).toBe(false);
    expect(canAccessPath(clerk, "/settings/users")).toBe(false);
    expect(canAccessPath(clerk, "/invoices")).toBe(true);
  });

  it("keeps auditors out of anything that writes", () => {
    expect(canAccessPath(auditor, "/invoices/new")).toBe(false);
    expect(canAccessPath(auditor, "/approvals")).toBe(false);
    expect(canAccessPath(auditor, "/audit")).toBe(true);
  });

  it("matches nested paths, not just exact ones", () => {
    expect(canAccessPath(clerk, "/settings/users/u_1")).toBe(false);
    expect(canAccessPath(admin, "/settings/users/u_1")).toBe(true);
  });

  it("still requires a session on an unguarded path", () => {
    expect(canAccessPath(null, "/dashboard")).toBe(false);
    expect(canAccessPath(clerk, "/dashboard")).toBe(true);
  });
});
