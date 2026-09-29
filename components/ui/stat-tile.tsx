import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A headline figure. Deliberately not a chart: one number, its unit, and the
 * one comparison that makes it mean something.
 *
 * `tone` colours the *figure*, not the tile. A tile with a coloured background
 * would spend the accent budget on furniture.
 */
export function StatTile({
  label,
  value,
  detail,
  tone = "default",
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  /** The comparison: "12 overdue", "across 40 vendors". */
  detail?: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger";
  href?: string;
  icon?: ReactNode;
}) {
  const valueTone = {
    default: "text-ink",
    accent: "text-accent",
    warn: "text-warn",
    danger: "text-danger",
  }[tone];

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="col-head">{label}</p>
        {icon ? <span className="text-ink-subtle">{icon}</span> : null}
      </div>

      <p className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", valueTone)}>
        {value}
      </p>

      {detail ? (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
          {detail}
          {href ? (
            <ArrowRight
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          ) : null}
        </p>
      ) : null}
    </>
  );

  const className =
    "group block rounded-lg border border-line bg-surface px-3.5 py-3 shadow-flat transition-colors";

  if (href) {
    return (
      <Link href={href} className={cn(className, "hover:border-line-strong hover:bg-surface-hover")}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}
