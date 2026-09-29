"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Toasts confirm that something happened, in the same words as the control
 * that caused it — "Publish" produces "Published". They never carry the only
 * copy of an error a person needs to act on; that belongs next to the field.
 */

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  detail?: string;
}

interface ToastContextValue {
  toast: (message: string, options?: { variant?: ToastVariant; detail?: string }) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    (message, options) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [
        ...current,
        { id, message, variant: options?.variant ?? "info", detail: options?.detail },
      ]);
      setTimeout(() => dismiss(id), DURATION);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message, detail) => toast(message, { variant: "success", detail }),
      error: (message, detail) => toast(message, { variant: "error", detail }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Announced to screen readers; `polite` so it never interrupts typing. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => (
          <ToastCard key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

const VARIANTS: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; iconClass: string; borderClass: string }
> = {
  success: { icon: CheckCircle2, iconClass: "text-accent", borderClass: "border-l-accent" },
  error: { icon: XCircle, iconClass: "text-danger", borderClass: "border-l-danger" },
  warning: { icon: AlertTriangle, iconClass: "text-warn", borderClass: "border-l-warn" },
  info: { icon: Info, iconClass: "text-info", borderClass: "border-l-info" },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { icon: Icon, iconClass, borderClass } = VARIANTS[toast.variant];

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded border border-l-2 border-line bg-surface px-3 py-2.5 shadow-overlay",
        "animate-[toast-in_140ms_ease-out]",
        borderClass,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.message}</p>
        {toast.detail ? <p className="mt-0.5 text-xs text-ink-muted">{toast.detail}</p> : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 rounded p-0.5 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
