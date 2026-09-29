"use client";

import { useRouter } from "next/navigation";
import { Paperclip, Trash2 } from "lucide-react";

import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AttachmentRow, FileDrop } from "@/components/upload/file-drop";
import { deleteAttachment } from "../actions";

export interface AttachmentView {
  id: string;
  filename: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  isPrimary: boolean;
  createdAt: string;
  uploadedByName: string;
}

/**
 * The attachment list plus its upload target.
 *
 * Client-side only because uploading happens over `fetch` and the list has to
 * refresh once it lands — `router.refresh()` re-runs the server component that
 * supplied these rows, so the new file appears without a full navigation.
 */
export function AttachmentsPanel({
  invoiceId,
  attachments,
  canUpload,
}: {
  invoiceId: string;
  attachments: AttachmentView[];
  canUpload: boolean;
}) {
  const router = useRouter();

  return (
    <>
      <CardHeader
        title="Attachments"
        description="The source document and anything supporting it"
        action={
          attachments.length > 0 ? (
            <span className="text-2xs text-ink-subtle">
              {attachments.length} {attachments.length === 1 ? "file" : "files"}
            </span>
          ) : null
        }
      />

      {attachments.length === 0 && !canUpload ? (
        <EmptyState
          compact
          icon={Paperclip}
          title="No attachments"
          description="Nothing was attached to this invoice before it was locked."
        />
      ) : null}

      {attachments.length > 0 ? (
        <ul className="divide-y divide-line">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentRow
                filename={attachment.filename}
                mimeType={attachment.mimeType}
                sizeBytes={attachment.sizeBytes}
                url={`/api/files/${attachment.storedName}`}
                meta={`${attachment.uploadedByName} · ${formatDate(attachment.createdAt)}`}
                action={
                  <span className="flex shrink-0 items-center gap-2">
                    {attachment.isPrimary ? <Badge tone="neutral">Source</Badge> : null}
                    {canUpload ? (
                      <form action={deleteAttachment}>
                        <input type="hidden" name="attachmentId" value={attachment.id} />
                        <button
                          type="submit"
                          aria-label={`Remove ${attachment.filename}`}
                          className="rounded p-1 text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </form>
                    ) : null}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      {canUpload ? (
        <div className="border-t border-line p-3">
          <FileDrop
            compact
            invoiceId={invoiceId}
            label={
              attachments.length === 0
                ? "Attach the supplier's document"
                : "Attach another document"
            }
            hint={
              attachments.length === 0
                ? "An approver needs this to check the invoice against it"
                : undefined
            }
            onUploaded={() => router.refresh()}
          />
        </div>
      ) : null}
    </>
  );
}
