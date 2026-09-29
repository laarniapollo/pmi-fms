"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, FileText, Paperclip, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";
import { Spinner } from "@/components/ui/button";

export interface UploadedFile {
  id: string;
  filename: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/**
 * Drag-and-drop file input.
 *
 * Two jobs, chosen by whether `invoiceId` is supplied: with one, the file is
 * posted straight to the server as an attachment; without one, the raw File is
 * handed to `onFile` so the caller can do something with it first — which is
 * how the scanning flow reads a document before any invoice exists to attach
 * it to.
 *
 * The client-side validation mirrors `checkUpload` on the server. It exists to
 * give a fast answer, not to be trusted: the server checks again.
 */
export function FileDrop({
  invoiceId,
  onFile,
  onUploaded,
  label = "Drop a file here, or browse",
  hint,
  disabled = false,
  compact = false,
}: {
  invoiceId?: string;
  onFile?: (file: File) => void;
  onUploaded?: (uploaded: UploadedFile) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);

      if (!(ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
        setError("Upload a PDF, PNG, JPEG, or WebP file.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        );
        return;
      }

      onFile?.(file);
      if (!invoiceId) return;

      setBusy(true);
      try {
        const body = new FormData();
        body.append("invoiceId", invoiceId);
        body.append("file", file);

        const response = await fetch("/api/upload", { method: "POST", body });
        const payload = await response.json();

        if (!response.ok) {
          setError(payload.error ?? "The upload failed.");
          return;
        }
        onUploaded?.(payload as UploadedFile);
      } catch {
        setError("The upload failed. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [invoiceId, onFile, onUploaded],
  );

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) void handle(event.dataTransfer.files[0]);
        }}
        className={cn(
          "rounded-lg border border-dashed transition-colors",
          compact ? "p-4" : "p-6",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-sunken",
          disabled && "opacity-55",
        )}
      >
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 text-center disabled:cursor-not-allowed"
        >
          <span
            className={cn(
              "flex items-center justify-center rounded-lg border border-line bg-surface",
              compact ? "h-8 w-8" : "h-10 w-10",
            )}
          >
            {busy ? (
              <Spinner className="text-accent" />
            ) : (
              <Upload
                className={cn("text-ink-subtle", compact ? "h-4 w-4" : "h-5 w-5")}
                aria-hidden="true"
              />
            )}
          </span>

          <span>
            <span className={cn("block font-medium text-ink", compact ? "text-xs" : "text-sm")}>
              {busy ? "Uploading…" : label}
            </span>
            <span className="mt-0.5 block text-2xs text-ink-subtle">
              {hint ?? `PDF, PNG, JPEG or WebP · up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`}
            </span>
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPTED_UPLOAD_TYPES.join(",")}
          disabled={disabled || busy}
          onChange={(event) => {
            void handle(event.target.files?.[0]);
            // Reset so choosing the same file twice fires onChange again.
            event.target.value = "";
          }}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 rounded border border-danger/25 bg-danger-soft px-2 py-1.5 text-xs text-danger"
        >
          <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Thumbnail-plus-metadata row for an attached file. */
export function AttachmentRow({
  filename,
  mimeType,
  sizeBytes,
  url,
  meta,
  action,
}: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  const isImage = mimeType.startsWith("image/");

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-surface-sunken"
      >
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
        )}
      </a>

      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 group">
        <span className="block truncate text-sm text-ink group-hover:text-accent">{filename}</span>
        <span className="block text-2xs text-ink-subtle">
          {formatFileSize(sizeBytes)}
          {meta ? ` · ${meta}` : ""}
        </span>
      </a>

      {action ?? <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />}
    </div>
  );
}
