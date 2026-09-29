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
  defaultPaymentMethod: z.enum(METHODS).default(PAYMENT_METHOD.PESONET),
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
