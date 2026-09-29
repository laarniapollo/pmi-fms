# Add Vendor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone holding `vendor:manage` (Admin and Clerk) create a vendor from a dialog on `/vendors`, with the write audited and duplicate names surfaced before they commit.

**Architecture:** Validation lives as a pure module in `lib/vendors/` so it can be unit-tested — `vitest.config.mts` collects only `lib/**/*.test.ts`. A server action in `app/(app)/vendors/actions.ts` re-checks permission, parses with that schema, runs a duplicate-name check, then writes the vendor and its audit row in one transaction and redirects to the new record. A client component renders the button and modal, gated at render time by `can(user, "vendor:manage")`.

**Tech Stack:** Next.js 15.5 (App Router, server actions), React 19 (`useActionState`), Prisma 6.19 on SQLite, zod 4.4, Vitest 4.1, Tailwind 4.

## Global Constraints

- **Never run `git` commands.** The user commits manually; this is a hard rule from their global config. Every task ends with a verification checkpoint, not a commit. Leave changes in the working tree.
- **No database migration.** No schema change is needed. Do not touch `prisma/schema.prisma`.
- **Validate enums against `lib/constants.ts`.** Never hard-code a category, status, payment term, or payment method string list in a new file.
- **zod style:** this codebase writes `z.string().trim().email("…")` chains (see `app/(auth)/actions.ts:24`). Match it. Do not use zod 4's top-level `z.email()`.
- **Prisma SQLite has no `mode: "insensitive"`.** Never write it — it does not compile against this connector.
- **Spec:** `docs/superpowers/specs/2026-08-10-add-vendor-design.md`.

---

### Task 1: Vendor input validation module

**Files:**
- Create: `lib/vendors/vendor-input.ts`
- Test: `lib/vendors/vendor-input.test.ts`

**Interfaces:**
- Consumes: `VENDOR_CATEGORIES`, `VENDOR_STATUS`, `PAYMENT_TERMS`, `PAYMENT_METHOD` and the types `VendorStatus`, `PaymentTerms`, `PaymentMethod` from `@/lib/constants`.
- Produces:
  - `vendorInputSchema` — a zod object schema.
  - `type VendorInput = z.infer<typeof vendorInputSchema>` with fields `name: string`, `category` (union of `VENDOR_CATEGORIES` literals), `status: VendorStatus`, `paymentTerms: PaymentTerms`, `defaultPaymentMethod: PaymentMethod`, `email?: string`, `phone?: string`.
  - `findNameMatch<T extends { id: string; name: string }>(candidates: T[], name: string): T | null`.

- [ ] **Step 1: Write the failing test**

Create `lib/vendors/vendor-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { findNameMatch, vendorInputSchema } from "./vendor-input";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Northwind Logistics",
    category: "Logistics",
    status: "ACTIVE",
    paymentTerms: "NET_30",
    defaultPaymentMethod: "ACH",
    ...overrides,
  };
}

describe("vendorInputSchema", () => {
  it("accepts a minimal valid vendor", () => {
    expect(vendorInputSchema.safeParse(input()).success).toBe(true);
  });

  it("rejects a blank or whitespace-only name", () => {
    expect(vendorInputSchema.safeParse(input({ name: "" })).success).toBe(false);
    expect(vendorInputSchema.safeParse(input({ name: "   " })).success).toBe(false);
  });

  it("rejects a name longer than 120 characters", () => {
    expect(vendorInputSchema.safeParse(input({ name: "a".repeat(121) })).success).toBe(false);
  });

  it("rejects a category outside the pick list", () => {
    expect(vendorInputSchema.safeParse(input({ category: "Fictional" })).success).toBe(false);
  });

  it("rejects a malformed email but allows none at all", () => {
    expect(vendorInputSchema.safeParse(input({ email: "not-an-email" })).success).toBe(false);
    expect(vendorInputSchema.safeParse(input({ email: undefined })).success).toBe(true);
  });

  it("defaults status, terms, and method when they are absent", () => {
    const parsed = vendorInputSchema.safeParse({
      name: "Northwind Logistics",
      category: "Logistics",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.status).toBe("ACTIVE");
    expect(parsed.data.paymentTerms).toBe("NET_30");
    expect(parsed.data.defaultPaymentMethod).toBe("ACH");
  });

  it("trims the name it stores", () => {
    const parsed = vendorInputSchema.safeParse(input({ name: "  Northwind Logistics  " }));
    expect(parsed.success && parsed.data.name).toBe("Northwind Logistics");
  });
});

describe("findNameMatch", () => {
  const candidates = [
    { id: "ven_1", name: "ACME Corp" },
    { id: "ven_2", name: "Acme Corporation" },
  ];

  it("matches ignoring case and surrounding space", () => {
    expect(findNameMatch(candidates, "  acme corp ")?.id).toBe("ven_1");
  });

  it("does not match a mere prefix", () => {
    expect(findNameMatch(candidates, "Acme")).toBeNull();
  });

  it("returns null for an empty name", () => {
    expect(findNameMatch(candidates, "   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- lib/vendors/vendor-input.test.ts`
Expected: FAIL — `Failed to resolve import "./vendor-input"`.

- [ ] **Step 3: Write the implementation**

Create `lib/vendors/vendor-input.ts`:

```ts
import { z } from "zod";

import {
  PAYMENT_METHOD,
  PAYMENT_TERMS,
  VENDOR_CATEGORIES,
  VENDOR_STATUS,
  type PaymentMethod,
  type PaymentTerms,
  type VendorStatus,
} from "@/lib/constants";

type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

/** zod wants a non-empty tuple; the constants stay the single source of truth. */
const CATEGORIES = [...VENDOR_CATEGORIES] as [VendorCategory, ...VendorCategory[]];
const STATUSES = Object.values(VENDOR_STATUS) as [VendorStatus, ...VendorStatus[]];
const TERMS = Object.values(PAYMENT_TERMS) as [PaymentTerms, ...PaymentTerms[]];
const METHODS = Object.values(PAYMENT_METHOD) as [PaymentMethod, ...PaymentMethod[]];

/**
 * Validation for the add-vendor dialog.
 *
 * Kept free of I/O so it can be unit-tested: `vitest.config.mts` collects only
 * `lib/**` tests, so logic worth testing has to live here rather than beside
 * the server action.
 *
 * Every enum is checked against the same constant the tables render from, so
 * the form cannot produce a value a status pill would fail to label.
 */
export const vendorInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the vendor name")
    .max(120, "Keep the name under 120 characters"),
  category: z.enum(CATEGORIES),
  status: z.enum(STATUSES).default(VENDOR_STATUS.ACTIVE),
  paymentTerms: z.enum(TERMS).default(PAYMENT_TERMS.NET_30),
  defaultPaymentMethod: z.enum(METHODS).default(PAYMENT_METHOD.ACH),
  email: z.string().trim().email("Enter a valid email address").optional(),
  phone: z.string().trim().max(40, "Keep the phone number under 40 characters").optional(),
});

export type VendorInput = z.infer<typeof vendorInputSchema>;

/**
 * Decides whether `name` is already taken, ignoring case and surrounding space.
 *
 * The comparison lives here rather than in the query because Prisma's SQLite
 * connector has no `mode: "insensitive"`. Callers narrow the scan with
 * `contains` — SQLite `LIKE` is case-insensitive for ASCII — and this makes
 * the actual decision.
 */
export function findNameMatch<T extends { id: string; name: string }>(
  candidates: T[],
  name: string,
): T | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  return candidates.find((candidate) => candidate.name.trim().toLowerCase() === target) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- lib/vendors/vendor-input.test.ts`
Expected: PASS, 10 tests.

If `z.enum(CATEGORIES)` fails to typecheck, the cause is the tuple cast, not the schema — confirm `VENDOR_CATEGORIES` is still declared `as const` in `lib/constants.ts:226`.

- [ ] **Step 5: Checkpoint**

Run: `npm run test && npm run typecheck`
Expected: all tests pass, no TypeScript errors. Do not commit — the user commits.

---

### Task 2: Permission coverage for `vendor:manage`

**Files:**
- Modify: `lib/auth/permissions.test.ts` — add to the existing `describe("role matrix")` block.

**Interfaces:**
- Consumes: `can`, and the `admin` / `approver` / `clerk` / `auditor` `Actor` fixtures already declared at the top of that file (lines 6-9).
- Produces: nothing consumed by later tasks. This task locks the gate Task 4 renders against.

No implementation step — `vendor:manage` already exists in `lib/auth/permissions.ts`. This task proves it behaves as Task 4 assumes.

- [ ] **Step 1: Write the tests**

Add inside `describe("role matrix", …)` in `lib/auth/permissions.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- lib/auth/permissions.test.ts`
Expected: PASS. These describe behaviour that already exists, so they should pass first time. **If any fails, stop** — the permission matrix does not say what this plan assumes, and Task 4's gate would be wrong.

- [ ] **Step 3: Checkpoint**

Run: `npm run test`
Expected: whole suite green. Do not commit.

---

### Task 3: The `createVendor` server action

**Files:**
- Create: `app/(app)/vendors/actions.ts`

**Interfaces:**
- Consumes: `vendorInputSchema` and `findNameMatch` from Task 1.
- Produces:
  - `interface VendorFormState { error?: string; fieldErrors?: Record<string, string>; duplicate?: { id: string; name: string } }`
  - `createVendor(_prev: VendorFormState, formData: FormData): Promise<VendorFormState>` — the `useActionState` signature Task 4 binds to.

Note on testing: `vitest.config.mts` includes only `lib/**/*.test.ts`, and this action needs a database and a session, so it gets no unit test. Its testable logic was deliberately extracted into Task 1. Verification here is typecheck, lint, and the end-to-end pass at the end of this plan.

- [ ] **Step 1: Write the action**

Create `app/(app)/vendors/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit/record";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { currentIp, requireUser } from "@/lib/auth/session";
import { findNameMatch, vendorInputSchema } from "@/lib/vendors/vendor-input";

export interface VendorFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** The existing vendor of the same name, when one was found and not yet confirmed. */
  duplicate?: { id: string; name: string };
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!result[field]) result[field] = issue.message;
  }
  return result;
}

/**
 * Creates a vendor from the dialog on the vendors list.
 *
 * A name already on file is reported back rather than refused: two legal
 * entities can trade under one name, and the person adding it is the one who
 * knows which case this is. Confirming resubmits with the name that was
 * warned about, so editing the name to something else re-runs the check
 * instead of slipping past it.
 */
export async function createVendor(
  _prev: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  const user = await requireUser();
  try {
    assertCan(user, "vendor:manage");
  } catch (error) {
    if (error instanceof PermissionError) return { error: "Your role cannot add vendors." };
    throw error;
  }

  const parsed = vendorInputSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    status: formData.get("status") || undefined,
    paymentTerms: formData.get("paymentTerms") || undefined,
    defaultPaymentMethod: formData.get("defaultPaymentMethod") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const input = parsed.data;

  const confirmedFor = String(formData.get("confirmDuplicate") ?? "").trim().toLowerCase();
  if (confirmedFor !== input.name.toLowerCase()) {
    // No status filter: an INACTIVE vendor is exactly the one about to be
    // re-created by accident. `contains` only narrows the scan — the decision
    // is findNameMatch's,
    // because this connector has no case-insensitive query mode.
    const candidates = await db.vendor.findMany({
      where: { name: { contains: input.name } },
      select: { id: true, name: true },
      take: 25,
    });
    const match = findNameMatch(candidates, input.name);
    if (match) {
      return {
        duplicate: match,
        fieldErrors: { name: "A vendor with this name is already on file" },
      };
    }
  }

  const vendor = await db.$transaction(async (tx) => {
    const created = await tx.vendor.create({
      data: {
        name: input.name,
        category: input.category,
        status: input.status,
        paymentTerms: input.paymentTerms,
        defaultPaymentMethod: input.defaultPaymentMethod,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });

    await recordAudit(
      {
        actor: { id: user.id, name: user.name, role: user.role },
        action: AUDIT_ACTIONS.VENDOR_CREATED,
        entityType: "Vendor",
        entityId: created.id,
        entityLabel: created.name,
        summary: `Created vendor ${created.name}`,
        metadata: {
          category: created.category,
          status: created.status,
          paymentTerms: created.paymentTerms,
          defaultPaymentMethod: created.defaultPaymentMethod,
        },
        ipAddress: await currentIp(),
      },
      tx,
    );

    return created;
  });

  revalidatePath("/vendors");
  // Must stay outside the try/catch above: redirect() signals by throwing
  // NEXT_REDIRECT, and catching it would swallow the navigation.
  redirect(`/vendors/${vendor.id}`);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors. `redirect()` returns `never`, which satisfies the `Promise<VendorFormState>` return type — no `return` after it is needed or wanted.

- [ ] **Step 3: Checkpoint**

Run: `npm run lint && npm run typecheck`
Expected: both clean. Do not commit.

---

### Task 4: The dialog and the page wiring

**Files:**
- Create: `app/(app)/vendors/add-vendor.tsx`
- Modify: `app/(app)/vendors/page.tsx` (imports, the `requireAction` call, the `PageHeader`, and the empty-state description on line 88)

**Interfaces:**
- Consumes: `createVendor` and `VendorFormState` from Task 3; `can` from `@/lib/auth/permissions`.
- Produces: `AddVendor` — a client component taking no props.

- [ ] **Step 1: Write the dialog**

Create `app/(app)/vendors/add-vendor.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Plus } from "lucide-react";

import {
  PAYMENT_METHOD_META,
  PAYMENT_TERMS_META,
  VENDOR_CATEGORIES,
  VENDOR_STATUS_META,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { createVendor, type VendorFormState } from "./actions";

const FORM_ID = "add-vendor-form";

/**
 * Add-vendor dialog for the vendors list.
 *
 * Only the fields needed before an invoice can be raised against the supplier
 * are here. Addresses and bank details are not required to get one on file,
 * and a twenty-field dialog is a form wearing a dialog's clothes.
 */
export function AddVendor() {
  const [state, formAction, pending] = useActionState<VendorFormState, FormData>(createVendor, {});
  const [open, setOpen] = useState(false);

  const duplicate = state.duplicate;

  return (
    <>
      <Button type="button" variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add vendor
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add vendor"
        description="A supplier you can enter invoices against."
        size="lg"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} variant="primary" size="md" loading={pending}>
              {duplicate ? "Add anyway" : pending ? "Adding" : "Add vendor"}
            </Button>
          </>
        }
      >
        <form action={formAction} id={FORM_ID} className="flex flex-col gap-3">
          {/* Carries the name that was warned about, so editing the name
              re-runs the duplicate check rather than skipping it. */}
          {duplicate ? (
            <input type="hidden" name="confirmDuplicate" value={duplicate.name} />
          ) : null}

          <FormField label="Vendor name" required error={state.fieldErrors?.name}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="name"
                required
                autoFocus
                maxLength={120}
                placeholder="Northwind Logistics"
                invalid={Boolean(state.fieldErrors?.name)}
                aria-describedby={describedBy}
              />
            )}
          </FormField>

          {duplicate ? (
            <p
              role="alert"
              className="flex items-start gap-1.5 rounded border border-warn/25 bg-warn-soft px-2 py-1.5 text-xs text-ink"
            >
              <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                <Link href={`/vendors/${duplicate.id}`} className="font-medium underline">
                  {duplicate.name}
                </Link>{" "}
                is already on file. Add anyway only if this is a different supplier trading
                under the same name.
              </span>
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Category" required error={state.fieldErrors?.category}>
              {({ id }) => (
                <Select id={id} name="category" defaultValue="General">
                  {VENDOR_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Status">
              {({ id }) => (
                <Select id={id} name="status" defaultValue="ACTIVE">
                  {Object.entries(VENDOR_STATUS_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Payment terms">
              {({ id }) => (
                <Select id={id} name="paymentTerms" defaultValue="NET_30">
                  {Object.entries(PAYMENT_TERMS_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Default payment method">
              {({ id }) => (
                <Select id={id} name="defaultPaymentMethod" defaultValue="ACH">
                  {Object.entries(PAYMENT_METHOD_META).map(([value, meta]) => (
                    <option key={value} value={value}>
                      {meta.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField label="Email" error={state.fieldErrors?.email}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  name="email"
                  type="email"
                  placeholder="ap@northwind.com"
                  invalid={Boolean(state.fieldErrors?.email)}
                  aria-describedby={describedBy}
                />
              )}
            </FormField>

            <FormField label="Phone" error={state.fieldErrors?.phone}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  name="phone"
                  placeholder="+1 555 0142"
                  invalid={Boolean(state.fieldErrors?.phone)}
                  aria-describedby={describedBy}
                />
              )}
            </FormField>
          </div>

          {state.error ? (
            <p role="alert" className="text-xs text-danger">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Wire it into the page**

In `app/(app)/vendors/page.tsx`, make exactly four edits.

1. Add two imports beside the existing ones:

```ts
import { can } from "@/lib/auth/permissions";
import { AddVendor } from "./add-vendor";
```

2. Capture the user — change line 32 from:

```ts
  await requireAction("vendor:view");
```

to:

```ts
  const user = await requireAction("vendor:view");
```

3. Give the header an action. Replace the existing `<PageHeader …/>` with:

```tsx
      <PageHeader
        title="Vendors"
        description={`${total.toLocaleString()} ${total === 1 ? "supplier" : "suppliers"} on file`}
        actions={can(user, "vendor:manage") ? <AddVendor /> : null}
      />
```

4. Correct the empty-state description. The current text claims vendors are created as invoices are entered, which no code has ever done. Replace the `description` prop of the `EmptyState` with:

```tsx
              description={
                filtered
                  ? "Try a different category or status."
                  : "Add your first supplier to start entering invoices against it."
              }
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 4: Checkpoint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all green. Do not commit.

---

## Final verification

Run the app and drive it. The dev server may already be running on port 3000.

- [ ] **Step 1: Start the server**

```bash
npm run dev
```

Wait for `Ready`, then confirm `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` prints `200`.

Note: if the server is launched inside a command sandbox it binds in an isolated
network namespace and nothing can reach port 3000. Launch it with the sandbox disabled.

- [ ] **Step 2: Add a vendor as admin**

Sign in at http://localhost:3000/login as `admin@apollo-ap.com` / `Apollo!2026`, go to
`/vendors`, click **Add vendor**, enter `Northwind Logistics` with category `Logistics`,
and submit.

Expected: the browser lands on `/vendors/<new-id>` showing Northwind Logistics with
Net 30 terms and ACH as the default method.

- [ ] **Step 3: Confirm the audit row**

Sign in as `auditor@apollo-ap.com` / `Apollo!2026` and open `/audit`.

Expected: a `Created vendor Northwind Logistics` entry attributed to Priya Raghunathan (admin).

- [ ] **Step 4: Confirm the duplicate warning**

As admin, add `northwind logistics` — lower-case, to prove the match is case-insensitive.

Expected: the dialog stays open, the name field shows "A vendor with this name is already
on file", and a warning links to the existing vendor. Clicking **Add anyway** then creates
the second record and redirects to it.

Then repeat: trigger the warning, but edit the name to `Northwind Freight` before clicking
**Add anyway**. Expected: it creates `Northwind Freight` without complaint — the confirm
token no longer matches the typed name, so the check re-ran and found nothing.

- [ ] **Step 5: Confirm the gate**

Sign in as `approver@apollo-ap.com`, then `auditor@apollo-ap.com`, and open `/vendors`.

Expected: no **Add vendor** button for either.

- [ ] **Step 6: Full suite**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Hand back**

Report what passed and leave the changes uncommitted. The user commits.
