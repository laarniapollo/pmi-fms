# Add vendor from the vendors page

Date: 2026-08-10
Status: approved, not yet implemented

## Problem

An admin cannot create a vendor. Neither can anyone else — no code path in the
application writes a `Vendor` row. Every vendor on file came from `prisma/seed.ts`.

The scaffolding for the feature is already in place and unused:

- `vendor:manage` is declared in `lib/auth/permissions.ts:33` and granted to Admin
  (line 61) and Clerk (line 89). It is enforced nowhere.
- `AUDIT_ACTIONS.VENDOR_CREATED` and `VENDOR_UPDATED` exist at `lib/constants.ts:279-280`
  and are never emitted.
- The vendors empty state at `app/(app)/vendors/page.tsx:88` tells the user that
  "Vendors are created as invoices are entered against them." No code does this.

## Outcome

Anyone holding `vendor:manage` — Admin and Clerk — can add a vendor from `/vendors`.
The write is audited. Duplicate names are surfaced before they are committed, and can
be overridden deliberately.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Who can add | Gate on existing `vendor:manage` (Admin + Clerk) | Honours the matrix as written; no permission change. Clerks entering invoices meet new suppliers first. |
| Placement | Modal launched from `/vendors` | Keeps the user in the list they are working in. |
| Field set | Seven essentials; rest take schema defaults | The Vendor model has ~20 fields, most optional. A 20-field modal is a form, not a dialog. |
| Duplicate names | Warn, allow override | Two entities can share a trading name. Blocking outright is wrong; saying nothing invites duplicate payments. |
| On success | Redirect to the new vendor's detail page | See "Why redirect" below. |
| Realtime | None | `lib/realtime/bus.ts:16` defines only invoice, payment, and notification events. A vendor topic is not warranted. |

## Scope

### New files

**`lib/vendors/vendor-input.ts`** — pure, no I/O.

- `vendorInputSchema`: zod schema for the seven fields.
- `findNameMatch(candidates, name)`: returns the candidate whose trimmed,
  lowercased name equals the input's, else null.

Lives in `lib/` because `vitest.config.mts` includes only `lib/**/*.test.ts`.
That is the sole place unit tests run in this project.

**`lib/vendors/vendor-input.test.ts`** — tests for the above.

**`app/(app)/vendors/actions.ts`** — `createVendor(prev, formData): Promise<VendorFormState>`.

**`app/(app)/vendors/add-vendor.tsx`** — `"use client"`. Button, `Modal`, form.

### Edited files

**`app/(app)/vendors/page.tsx`** — capture the return of `requireAction("vendor:view")`,
render `<AddVendor />` in the `PageHeader` `actions` slot when `can(user, "vendor:manage")`.
Correct the misleading empty-state description on line 88.

**`lib/auth/permissions.test.ts`** — add `vendor:manage` cases. The file currently has
no vendor coverage at all.

## Fields

The form always submits all seven; every select renders with a value preselected.
The schema defaults listed below apply only when a field is absent altogether, which
keeps the action honest if it is ever called with a partial payload.

| Field | Required in form | Validation | Default when absent |
|---|---|---|---|
| `name` | yes | trimmed, 1–120 chars | — (rejected) |
| `category` | yes | one of `VENDOR_CATEGORIES` | — (rejected) |
| `status` | yes | key of `VENDOR_STATUS_META` | `ACTIVE` |
| `paymentTerms` | yes | key of `PAYMENT_TERMS` | `NET_30` |
| `defaultPaymentMethod` | yes | key of `PAYMENT_METHOD` | `ACH` |
| `email` | no | email format when non-empty | null |
| `phone` | no | free text, ≤40 chars | null |

Every enum is validated against the constant the rest of the app renders from, so the
form cannot produce a value a table cell would fail to label.

All other Vendor columns take their Prisma defaults (`country` = "United States") or null.

## Data flow

1. Click **Add vendor** → modal opens via local `useState`, as `app/(app)/approvals/decision-panel.tsx:50` does.
2. Submit through `useActionState(createVendor, {})`.
3. `createVendor`: `requireUser()` → `assertCan(user, "vendor:manage")` → parse → duplicate check.
4. On a name match with no `confirmDuplicate` field present, return
   `{ duplicate: { id, name }, fieldErrors: { name: "A vendor with this name already exists" } }`
   and write nothing. The modal shows the match, links to it, and swaps the submit
   button to **Add anyway**, which resubmits with `confirmDuplicate=1`.
5. Otherwise `db.$transaction`: `vendor.create`, then `recordAudit` in the same
   transaction — the rule stated in `lib/audit/record.ts:7-12`.
6. `revalidatePath("/vendors")`, then `redirect(`/vendors/${vendor.id}`)`.

The duplicate check considers **all** vendors regardless of status. An INACTIVE
"Northwind Logistics" is exactly the record someone is about to re-create by accident.

### Why redirect rather than close the modal

`/vendors` is sorted by name and paginated at `PAGE_SIZES[0]`. With 38 vendors on file,
a new "Zebra Ltd" lands on the last page — closing the modal would return the user to a
list showing no evidence anything happened. Redirecting to the new vendor's detail page
gives unambiguous confirmation and matches `createInvoice`, which redirects to the
invoice it just made (`app/(app)/invoices/actions.ts:202`).

`redirect()` throws `NEXT_REDIRECT`, so it must be called outside the `try`/`catch` that
handles `PermissionError` — the same structure `createInvoice` uses, where the `try`
wraps only `assertCan`.

### Audit entry

```
action:      VENDOR_CREATED
entityType:  "Vendor"
entityId:    vendor.id
entityLabel: vendor.name
summary:     `Created vendor ${vendor.name}`
metadata:    { category, status, paymentTerms, defaultPaymentMethod }
ipAddress:   await currentIp()
```

## Case-insensitive matching on SQLite

Prisma's SQLite connector does not support `mode: "insensitive"`. A case-insensitive
exact match therefore cannot be expressed in the query.

`findNameMatch` narrows with `contains` — SQLite `LIKE` is case-insensitive for ASCII —
then compares trimmed and lowercased in JavaScript. This is the reason the helper is a
separate pure function rather than an inline query: it is the part most likely to be
wrong, and separating it is what makes it testable.

## Error handling

- `PermissionError` → `{ error: "Your role cannot add vendors." }`, matching the shape
  `createInvoice` uses at `app/(app)/invoices/actions.ts:107-110`.
- Zod issues → per-field messages through the existing `FormField` `error` prop.
- The server checks permission on every call regardless of whether the button rendered.
  The button is a hint; the action is the control.

## Testing

**Unit** (`lib/vendors/vendor-input.test.ts`):

- rejects a blank or whitespace-only name
- rejects a name over 120 chars
- rejects a category outside `VENDOR_CATEGORIES`
- rejects a malformed email, accepts an absent one
- applies the documented defaults when status/terms/method are omitted
- `findNameMatch` matches "acme corp" to "ACME Corp"
- `findNameMatch` does not match "Acme" to "Acme Corporation"

**Permissions** (`lib/auth/permissions.test.ts`): Admin and Clerk hold `vendor:manage`;
Approver and Auditor do not; an inactive Admin does not.

**Manual, against the running app:**

1. Sign in as `admin@apollo-ap.com`, open `/vendors`, add a vendor, confirm the redirect
   lands on its detail page with the entered values.
2. Confirm `/audit` shows "Created vendor …" attributed to that admin.
3. Add a second vendor with the same name; confirm the warning and the link to the
   existing record; confirm **Add anyway** then succeeds.
4. Sign in as `auditor@apollo-ap.com` and `approver@apollo-ap.com`; confirm no button.
5. `npm run test`, `npm run typecheck`, `npm run lint` all clean.

## Out of scope

- Editing an existing vendor. `VENDOR_UPDATED` stays unemitted; that is a separate change.
- The remaining ~13 Vendor fields (address, tax ID, bank details, website, notes).
- A "Vendor created" banner on the detail page. `app/(app)/vendors/[id]/page.tsx` takes
  no `searchParams` today and has no banner mechanism; adding one is a separate change.
  Landing on the populated record is confirmation enough.
- Any database migration. No schema change is needed.
