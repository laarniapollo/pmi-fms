import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TabItem {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}

/**
 * URL-driven tabs. Each tab is a link, so a tab selection is shareable and the
 * back button behaves. The active marker is a 2px underline rather than a
 * filled pill, which keeps the accent budget for actions.
 */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={cn("flex items-center gap-0.5 border-b border-line", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            item.active
              ? "border-accent text-ink"
              : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
          )}
        >
          {item.label}
          {typeof item.count === "number" ? (
            <span
              className={cn(
                "rounded px-1 py-0.5 text-2xs tabular-nums",
                item.active ? "bg-accent-soft text-accent" : "bg-neutral-soft text-ink-muted",
              )}
            >
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/** Page title block. Used by every screen so headings stay on one grid. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("mb-4", className)}>
      {breadcrumb ? <div className="mb-1.5">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1.5 text-xs text-ink-muted">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span className="text-ink-subtle" aria-hidden="true">
                /
              </span>
            ) : null}
            {item.href ? (
              <Link href={item.href} className="transition-colors hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span className="text-ink">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
