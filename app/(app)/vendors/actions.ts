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

/** Everything the invoice form's vendor dropdown needs to show a new option. */
export interface CreatedVendor {
  id: string;
  name: string;
  paymentTerms: string;
  category: string;
}

export interface InlineVendorState extends VendorFormState {
  /** Set once the vendor exists, so the caller can select it straight away. */
  created?: CreatedVendor;
}

type VendorSaveResult = { ok: true; vendor: CreatedVendor } | { ok: false; state: VendorFormState };

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!result[field]) result[field] = issue.message;
  }
  return result;
}

/**
 * Creates a vendor, and reports the outcome rather than navigating.
 *
 * A name already on file is reported back rather than refused: two legal
 * entities can trade under one name, and the person adding it is the one who
 * knows which case this is. Confirming resubmits with the name that was
 * warned about, so editing the name to something else re-runs the check
 * instead of slipping past it.
 *
 * The duplicate check and the audit entry live here, once, because the same
 * vendor can now be created from two places: the vendors list, which navigates
 * to the new vendor afterwards, and the invoice form, which must stay exactly
 * where it is with a half-filled draft intact.
 */
async function saveVendor(formData: FormData): Promise<VendorSaveResult> {
  const user = await requireUser();
  try {
    assertCan(user, "vendor:manage");
  } catch (error) {
    if (error instanceof PermissionError) {
      return { ok: false, state: { error: "Your role cannot add vendors." } };
    }
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
  if (!parsed.success) return { ok: false, state: { fieldErrors: fieldErrorsFrom(parsed.error) } };

  const input = parsed.data;

  let confirmedDuplicateOf: string | null = null;
  const confirmedFor = String(formData.get("confirmDuplicate") ?? "").trim().toLowerCase();
  if (confirmedFor !== input.name.toLowerCase()) {
    // No status filter: an INACTIVE vendor is exactly the one about to be
    // re-created by accident. `contains` only narrows the scan — the decision
    // is findNameMatch's,
    // because this connector has no case-insensitive query mode.
    const candidates = await db.vendor.findMany({
      where: { name: { contains: input.name } },
      select: { id: true, name: true },
    });
    const match = findNameMatch(candidates, input.name);
    if (match) {
      return {
        ok: false,
        state: {
          duplicate: match,
          fieldErrors: { name: "A vendor with this name is already on file" },
        },
      };
    }
  } else {
    // User confirmed they want to create despite a known duplicate.
    // Look up the duplicate being overridden to record it in the audit trail.
    const candidates = await db.vendor.findMany({
      where: { name: { contains: input.name } },
      select: { id: true, name: true },
    });
    const match = findNameMatch(candidates, input.name);
    confirmedDuplicateOf = match?.id ?? null;
  }

  const ipAddress = await currentIp();
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
          ...(confirmedDuplicateOf ? { confirmedDuplicateOf } : {}),
        },
        ipAddress,
      },
      tx,
    );

    return created;
  });

  revalidatePath("/vendors");
  revalidatePath("/dashboard");
  revalidatePath("/invoices/new");

  return {
    ok: true,
    vendor: {
      id: vendor.id,
      name: vendor.name,
      paymentTerms: vendor.paymentTerms,
      category: vendor.category,
    },
  };
}

/** The vendors list: create, then go to the vendor that was created. */
export async function createVendor(
  _prev: VendorFormState,
  formData: FormData,
): Promise<VendorFormState> {
  const result = await saveVendor(formData);
  if (!result.ok) return result.state;

  // Must stay outside any try/catch: redirect() signals by throwing
  // NEXT_REDIRECT, and catching it would swallow the navigation.
  redirect(`/vendors/${result.vendor.id}`);
}

/**
 * The invoice form: create, and stay put.
 *
 * `createVendor` ends in `redirect()`, which would navigate away from a
 * half-filled invoice and lose both the typing and the scanned document held
 * in memory. This returns the vendor instead so the dropdown can select it.
 */
export async function createVendorInline(
  _prev: InlineVendorState,
  formData: FormData,
): Promise<InlineVendorState> {
  const result = await saveVendor(formData);
  return result.ok ? { created: result.vendor } : result.state;
}
