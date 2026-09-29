import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

/**
 * Attachment storage on the local filesystem.
 *
 * Files are written outside `public/`, so nothing is statically served: every
 * read goes through an authenticated route that looks the attachment up in the
 * database first. That lookup is also the defence against path traversal —
 * user input never reaches `path.join`, only a stored name the database
 * already vouches for.
 */

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");

export interface UploadCheck {
  ok: boolean;
  problem?: string;
}

/** Validates before anything touches the disk. Mirrored on the client. */
export function checkUpload(file: { type: string; size: number; name: string }): UploadCheck {
  if (!(ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, problem: "Upload a PDF, PNG, JPEG, or WebP file." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      problem: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    };
  }
  if (file.size === 0) return { ok: false, problem: "That file is empty." };
  return { ok: true };
}

/**
 * Writes the file under a generated name and returns it.
 *
 * The stored name is a UUID plus the extension: the supplier's original
 * filename is kept in the database for display but never used as a path, so a
 * file called `../../etc/passwd` is just an awkward label.
 */
export async function storeFile(file: File): Promise<{ storedName: string; sizeBytes: number }> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const extension = extensionFor(file.type);
  const storedName = `${randomUUID()}${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  return { storedName, sizeBytes: buffer.byteLength };
}

/**
 * Resolves a stored name to an absolute path.
 *
 * Callers must have already confirmed the name exists as an Attachment row.
 * The basename guard is a second line of defence, not the first.
 */
export function resolveStoredPath(storedName: string): string {
  const safe = path.basename(storedName);
  return path.join(UPLOAD_DIR, safe);
}

export async function deleteStoredFile(storedName: string): Promise<void> {
  try {
    await unlink(resolveStoredPath(storedName));
  } catch {
    // A missing file should not block deleting the row that pointed at it —
    // the database record is what the application actually reads.
  }
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
