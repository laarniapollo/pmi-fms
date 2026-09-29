import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";
import {
  APPROVAL_STATUS_META,
  BATCH_STATUS_META,
  INVOICE_STATUS_META,
  PAYMENT_STATUS_META,
  VENDOR_STATUS_META,
} from "@/lib/constants";

/**
 * Tones are deliberately quiet apart from `accent`. A screen full of coloured
 * badges reads as noise; the eye should land on emerald and nothing else.
 */
const TONES: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-ink-muted border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
  "accent-outline": "bg-surface text-accent border-accent/35",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  /** Adds a leading dot — useful when the badge sits in a dense table row. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

type StatusKind = "invoice" | "payment" | "approval" | "vendor" | "batch";

const REGISTRY: Record<StatusKind, Record<string, { label: string; tone: Tone }>> = {
  invoice: INVOICE_STATUS_META,
  payment: PAYMENT_STATUS_META,
  approval: APPROVAL_STATUS_META,
  vendor: VENDOR_STATUS_META,
  batch: BATCH_STATUS_META,
};

/**
 * Renders any status column. Looking the label and tone up from the shared
 * registry means "Paid" is emerald everywhere, without each screen deciding.
 */
export function StatusPill({
  kind,
  status,
  dot = true,
  className,
}: {
  kind: StatusKind;
  status: string;
  dot?: boolean;
  className?: string;
}) {
  const meta = REGISTRY[kind][status] ?? { label: humanise(status), tone: "neutral" as Tone };
  return (
    <Badge tone={meta.tone} dot={dot} className={className}>
      {meta.label}
    </Badge>
  );
}

/** `"PENDING_REVIEW"` → `"Pending review"`, for values not yet in a registry. */
function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Small count marker for tabs and sidebar items. */
export function CountBadge({ count, active = false }: { count: number; active?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-2xs font-semibold tabular-nums",
        active ? "bg-accent text-white" : "bg-neutral-soft text-ink-muted",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
