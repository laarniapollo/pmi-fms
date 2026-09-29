import type { NextRequest } from "next/server";

import { can, PermissionError } from "@/lib/auth/permissions";
import { getCurrentUser, UnauthenticatedError } from "@/lib/auth/session";
import { listVendorOptions } from "@/lib/queries/invoices";
import { checkUpload } from "@/lib/storage";
import {
  callGemini,
  isScanConfigured,
  type GeminiFailureReason,
} from "@/lib/extract/gemini-client";
import { parseGeminiInvoice } from "@/lib/extract/parse-response";
import {
  SCAN_FAILURE_MESSAGE,
  type ScanFailureReason,
  type ScanResponse,
} from "@/lib/extract/types";

/**
 * Reads an uploaded document and returns what it says.
 *
 * This is the only place in the application that talks to the model, and the
 * only reason the API key never reaches a browser: the document goes up as
 * multipart form data, and what comes back is our own shape, never the
 * provider's. `lib/extract/gemini-client.ts` is server-only, so an accidental
 * import of it from a client component fails the build rather than shipping
 * the key.
 *
 * Nothing here is persisted. The invoice, and the attachment, are created later
 * by `createInvoice` when the clerk saves the form this fills in — so an
 * abandoned scan leaves nothing behind to clean up.
 *
 * The order of checks mirrors `app/api/upload/route.ts` deliberately: identity,
 * then permission, then configuration, then the file itself. A caller who is
 * not allowed to scan learns that before we look at what they sent.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();

    // `invoice:scan` has existed in the permission matrix since the beginning
    // and has never been enforced anywhere. This route is its first consumer.
    if (!can(user, "invoice:scan")) throw new PermissionError("invoice:scan");

    if (!isScanConfigured()) return fail("not-configured", 503);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return fail("invalid-file", 400);

    const check = checkUpload(file);
    // The client checks this first, so reaching here means a direct caller or a
    // bug. The specific problem is safe to return; it is about their own file.
    if (!check.ok) return fail("invalid-file", 400, check.problem);

    const vendors = await listVendorOptions();
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");

    const first = await callGemini({ data, mimeType: file.type, vendors });
    if (!first.ok) return fromGemini(first.reason, first.detail, first.retryAfterSeconds);

    let parsed = parseGeminiInvoice(first.text, vendors);

    if (!parsed.ok) {
      // One repair attempt, never more. A model that has ignored the schema
      // twice will not honour it on a third ask, and each try costs the clerk
      // another few seconds in front of a spinner.
      console.error("[scan] unparseable reply (%s): %s", parsed.reason, first.text.slice(0, 500));

      const repaired = await callGemini({ data, mimeType: file.type, vendors, repairFrom: first.text });
      if (!repaired.ok) return fromGemini(repaired.reason, repaired.detail, repaired.retryAfterSeconds);

      parsed = parseGeminiInvoice(repaired.text, vendors);
      if (!parsed.ok) {
        console.error("[scan] repair failed (%s): %s", parsed.reason, repaired.text.slice(0, 500));
        return fail("unreadable", 502);
      }
    }

    // Not an invoice is a correct reading, not a server fault — so it is a 200
    // with `ok: false`, and the file stays attached to whatever gets saved.
    if (!parsed.extracted.looksLikeInvoice) return fail("not-an-invoice", 200);

    return json({ ok: true, extracted: parsed.extracted, model: first.model });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return fail("unauthorized", 401);
    if (error instanceof PermissionError) return fail("forbidden", 403);
    throw error;
  }
}

/**
 * Provider vocabulary in, ours out. The upstream detail is logged and dropped:
 * it can carry the model id, quota shape, or an echo of the request, none of
 * which belongs in a browser.
 */
function fromGemini(
  reason: GeminiFailureReason,
  detail: string,
  retryAfterSeconds?: number,
): Response {
  console.error("[scan] %s: %s", reason, detail);

  switch (reason) {
    case "not-configured":
      return fail("not-configured", 503);
    case "timeout":
      return fail("timeout", 504);
    case "rate-limited":
      return fail("rate-limited", 429, undefined, retryAfterSeconds);
    // An upstream 4xx means this server is misconfigured — a wrong key, or a
    // model id that no longer exists. Reporting it as a document problem would
    // send an operator looking at the wrong thing entirely.
    case "rejected":
      return fail("not-configured", 503);
    case "blocked":
    case "truncated":
      return fail("unreadable", 502);
    case "network":
    case "upstream":
      return fail("unreachable", 502);
  }
}

function fail(
  reason: ScanFailureReason,
  status: number,
  message?: string,
  retryAfterSeconds?: number,
): Response {
  return json(
    {
      ok: false,
      reason,
      message: message ?? SCAN_FAILURE_MESSAGE[reason],
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
    status,
    retryAfterSeconds === undefined ? undefined : { "retry-after": String(retryAfterSeconds) },
  );
}

/** Typed so a response shape that drifts from `ScanResponse` fails the build. */
function json(payload: ScanResponse, status = 200, headers?: HeadersInit): Response {
  return Response.json(payload, { status, headers });
}
