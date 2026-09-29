"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Built on the native `<dialog>` element, which brings a real focus trap,
 * Escape-to-close, inert background, and top-layer stacking without a
 * scroll-lock hack or a focus-trap dependency.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  /** Set when a destructive confirmation should not be dismissed by accident. */
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault(); // Let React own the open state, not the DOM.
      if (dismissible) onClose();
    };
    const handleClose = () => {
      if (open) onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [dismissible, onClose, open]);

  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  } as const;

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onClick={(event) => {
        // Clicks land on the dialog itself only when they hit the backdrop.
        if (dismissible && event.target === ref.current) onClose();
      }}
      className={cn(
        "w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-overlay",
        "backdrop:bg-ink/25 backdrop:backdrop-blur-[1px]",
        "open:animate-[modal-in_120ms_ease-out]",
        widths[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="modal-title" className="text-sm font-semibold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>
        {dismissible ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 rounded p-1 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>

      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken px-4 py-3">
          {footer}
        </div>
      ) : null}

      <style>{`
        @keyframes modal-in {
          from { opacity: 0; transform: translateY(-4px) scale(0.99); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </dialog>
  );
}
