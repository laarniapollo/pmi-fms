"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Ban, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/input";
import { archiveInvoice, voidInvoice } from "../../approvals/actions";

const VOID_FORM_ID = "void-invoice-form";

/**
 * Lifecycle actions that are not part of the everyday path: voiding an
 * invoice that should never be paid, and moving settled work off the active
 * ledger. Both sit behind an overflow menu because neither is a routine
 * click, and voiding asks for a reason before it will proceed.
 */
export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  canVoid,
  canArchive,
  isArchived,
}: {
  invoiceId: string;
  invoiceNumber: string;
  canVoid: boolean;
  canArchive: boolean;
  isArchived: boolean;
}) {
  const [voidOpen, setVoidOpen] = useState(false);

  if (!canVoid && !canArchive) return null;

  return (
    <>
      <Dropdown
        trigger={() => (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">More actions</span>
          </span>
        )}
      >
        {canArchive ? (
          <form action={archiveInvoice}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="restore" value={isArchived ? "1" : "0"} />
            <DropdownItem type="submit">
              {isArchived ? (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                  Restore to active
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                  Archive
                </>
              )}
            </DropdownItem>
          </form>
        ) : null}

        {canVoid && canArchive ? <DropdownDivider /> : null}

        {canVoid ? (
          <DropdownItem danger onClick={() => setVoidOpen(true)}>
            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
            Void invoice
          </DropdownItem>
        ) : null}
      </Dropdown>

      <Modal
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={`Void ${invoiceNumber}?`}
        description="This invoice will never be paid."
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={VOID_FORM_ID} variant="danger" size="md">
              Void invoice
            </Button>
          </>
        }
      >
        <form action={voidInvoice} id={VOID_FORM_ID}>
          <input type="hidden" name="invoiceId" value={invoiceId} />

          <label htmlFor="void-reason" className="mb-1 block text-xs font-medium text-ink-muted">
            Why is it being voided?
          </label>
          <Textarea
            id="void-reason"
            name="reason"
            rows={3}
            placeholder="Duplicate of INV-2026-0184, already paid in March."
          />
          <p className="mt-1.5 text-xs text-ink-subtle">
            Voiding cancels any payment still scheduled against this invoice and closes it
            permanently. Use Reject instead if the clerk should correct and resubmit it.
          </p>
        </form>
      </Modal>
    </>
  );
}
