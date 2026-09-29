import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An empty screen is an invitation to act, not an apology. Every use supplies
 * a next step — either an action the reader can take, or a plain statement of
 * why there is nothing here and what would put something here.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: {
  icon?: ComponentType<LucideProps>;
  /** What is empty, in the reader's words: "No invoices match these filters". */
  title: string;
  /** How to change that. One sentence. */
  description?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  /** For empty cards and panels rather than whole pages. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-8" : "px-6 py-16",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "mb-3 flex items-center justify-center rounded-lg border border-line bg-surface-sunken",
            compact ? "h-8 w-8" : "h-10 w-10",
          )}
        >
          <Icon
            className={cn("text-ink-subtle", compact ? "h-4 w-4" : "h-5 w-5")}
            aria-hidden="true"
          />
        </div>
      ) : null}

      <h3 className={cn("font-semibold text-ink", compact ? "text-sm" : "text-base")}>{title}</h3>

      {description ? (
        <p className={cn("mt-1 max-w-sm text-ink-muted", compact ? "text-xs" : "text-sm")}>
          {description}
        </p>
      ) : null}

      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
