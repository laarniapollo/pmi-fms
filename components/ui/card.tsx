import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Soft elevated surface. Structure comes from the 1px stroke; the shadow is
 * barely there on purpose — see `--shadow-flat` in globals.css.
 */
export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-line bg-surface shadow-flat overflow-hidden",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned control: a filter, a link, an overflow menu. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-line px-4 py-2.5",
        className,
      )}
    >
      {children ?? (
        <div className="min-w-0">
          {title ? <h2 className="text-sm font-semibold text-ink truncate">{title}</h2> : null}
          {description ? (
            <p className="mt-0.5 text-xs text-ink-muted truncate">{description}</p>
          ) : null}
        </div>
      )}
      {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
  /** Tables and lists supply their own padding — turn this off for them. */
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn(padded && "p-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line bg-surface-sunken px-4 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Label-over-value pair, the unit that detail screens are built from. Keeps
 * every field aligned on the same baseline grid without per-screen spacing.
 */
export function Field({
  label,
  children,
  className,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** For identifiers — see the type split documented in globals.css. */
  mono?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="col-head">{label}</dt>
      <dd className={cn("mt-1 text-sm text-ink", mono && "ident")}>{children}</dd>
    </div>
  );
}

export function FieldGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  return <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4", cols, className)}>{children}</dl>;
}
