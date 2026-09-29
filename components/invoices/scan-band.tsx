"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, FileText, ScanLine, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FileDrop } from "@/components/upload/file-drop";
import { DocumentView } from "./document-view";

export type ScanStatus = "idle" | "scanning" | "done" | "failed";

/**
 * The upload band that sits above the invoice form.
 *
 * It has one job and three states: offer a dropzone, show that something is
 * happening, then get out of the way — collapsing to a single line naming the
 * file, what came back, and a toggle that reveals the document itself.
 *
 * Nothing here is a dead end. The form is on the same page, below, blank and
 * usable whatever the scan did, so a failure costs the typing it would have
 * saved and nothing else. That is the whole reason the two tabs were collapsed.
 */
export function ScanBand({
  available,
  status,
  file,
  error,
  readCount,
  fieldCount,
  lineItemCount,
  onFile,
  onCancel,
  onReset,
}: {
  /** False when the server has no API key, known before a file is ever dragged. */
  available: boolean;
  status: ScanStatus;
  file: File | null;
  error: string | null;
  /** Scalar fields the document actually carried a value for. */
  readCount: number | null;
  fieldCount: number;
  lineItemCount: number;
  onFile: (file: File) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const [showDocument, setShowDocument] = useState(false);

  if (!available) {
    return (
      <Card>
        <CardBody className="flex items-start gap-2.5">
          <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">Scanning is not set up on this server</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Enter the invoice by hand below. An administrator can enable scanning by configuring
              a reader key.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (status === "scanning") {
    return (
      <Card>
        <CardBody>
          <ScanningIndicator filename={file?.name} onCancel={onCancel} />
        </CardBody>
      </Card>
    );
  }

  // Collapsed: a scan has happened, well or badly, and the file is attached.
  if (file && (status === "done" || status === "failed")) {
    return (
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{file.name}</span>
            <span className="block text-2xs text-ink-subtle">
              {formatFileSize(file.size)}
              {status === "done" && readCount !== null ? (
                <>
                  {" · "}
                  read {readCount} of {fieldCount} fields
                  {lineItemCount > 0 ? ` · ${lineItemCount} line items` : ""}
                </>
              ) : null}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowDocument((current) => !current)}
              aria-expanded={showDocument}
            >
              {showDocument ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {showDocument ? "Hide document" : "Show document"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onReset}>
              Replace
            </Button>
          </span>
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 border-t border-line bg-warn-soft px-4 py-2 text-xs text-ink"
          >
            <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-warn" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {/* The blanks are the correct output, not a partial failure — say so
            rather than letting an empty field read as something going wrong. */}
        {status === "done" && readCount !== null && readCount < fieldCount ? (
          <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
            The rest were not printed on the document, so they were left blank.
          </p>
        ) : null}

        {showDocument ? (
          <div className="border-t border-line p-3">
            <DocumentView file={file} />
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Scan a document"
        description="Upload the supplier's invoice and the fields below fill in from it."
      />
      <CardBody>
        {error ? (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded border border-danger/25 bg-danger-soft px-3 py-2"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        ) : null}

        <FileDrop
          onFile={onFile}
          label="Drop an invoice here, or browse"
          hint="PDF, PNG, JPEG or WebP · if the file holds several invoices, only the first is read"
        />

        <div className="mt-4 rounded border border-line bg-surface-sunken px-3 py-2.5">
          <p className="text-xs font-medium text-ink">What happens next</p>
          <ol className="mt-1.5 space-y-1 text-xs text-ink-muted">
            {/* This says plainly that the document leaves the building. The
                flow this replaced promised the opposite, and that promise
                stopped being true the moment a hosted model did the reading. */}
            <li>
              1. The document is sent to Google&rsquo;s Gemini service, which reads it and returns
              what it says.
            </li>
            <li>
              2. The fields below fill in. Anything not printed on the document is left blank
              rather than guessed.
            </li>
            <li>3. You check the figures against the document and save — it stays attached.</li>
          </ol>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * One opaque round trip of a few seconds, so the indicator is indeterminate.
 *
 * The bar it replaces was weighted across recognition phases because most of
 * that wait was a 15 MB engine download with real progress to report. There is
 * no such thing to report here, and a bar that invents a position is worse than
 * one that admits it does not know.
 */
function ScanningIndicator({ filename, onCancel }: { filename?: string; onCancel: () => void }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex items-center gap-3">
      <ScanLine className="h-5 w-5 shrink-0 animate-pulse text-accent" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          Reading {filename ?? "the document"}
          <span aria-hidden="true">…</span>
        </p>
        <div
          role="progressbar"
          aria-label="Reading the document"
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-canvas"
        >
          <div className={cn("h-full w-1/3 rounded-full bg-accent", "animate-pulse")} />
        </div>
        {slow ? (
          <p className="mt-1.5 text-2xs text-ink-subtle">
            Still going. Large or photographed documents take longer.
          </p>
        ) : null}
      </div>

      <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="shrink-0">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Cancel
      </Button>
    </div>
  );
}
