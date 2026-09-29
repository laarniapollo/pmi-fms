import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ReadableOptions } from "node:stream";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveStoredPath } from "@/lib/storage";

/**
 * Serves an uploaded document to a signed-in user.
 *
 * Uploads live outside `public/` precisely so this check exists: supplier
 * invoices carry bank details and contract rates, and a guessable static URL
 * would hand them to anyone.
 *
 * The requested name is resolved through the database first. A name with no
 * Attachment row is a 404 before it ever reaches the filesystem, which is what
 * makes path traversal a non-event here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to view this file.", { status: 401 });

  const { name } = await params;

  const attachment = await db.attachment.findUnique({
    where: { storedName: name },
    select: { filename: true, storedName: true, mimeType: true, sizeBytes: true },
  });
  if (!attachment) return new Response("Not found", { status: 404 });

  const filePath = resolveStoredPath(attachment.storedName);

  try {
    await stat(filePath);
  } catch {
    // The row survived but the file did not — say so honestly rather than
    // serving an empty body that looks like a corrupt document.
    return new Response("This file is no longer on disk.", { status: 410 });
  }

  const stream = createReadStream(filePath) as unknown as ReadableOptions & AsyncIterable<Buffer>;

  return new Response(toWebStream(stream), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.sizeBytes),
      // `inline` so PDFs and images preview in the browser instead of
      // downloading; the filename is quoted for names containing spaces.
      "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** Node stream → Web ReadableStream, so the file is not buffered in memory. */
function toWebStream(nodeStream: AsyncIterable<Buffer>): ReadableStream<Uint8Array> {
  const iterator = nodeStream[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(new Uint8Array(value));
    },
    cancel() {
      void iterator.return?.();
    },
  });
}
