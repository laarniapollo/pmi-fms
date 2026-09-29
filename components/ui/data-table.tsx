import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn, buildQuery } from "@/lib/utils";

/**
 * The one table in the application.
 *
 * It is a server component: sorting and pagination are links that rewrite the
 * URL, so a sorted view is shareable, survives a refresh, and needs no client
 * JavaScript. The row link uses the stretched-anchor pattern — a real `<a>` in
 * the primary cell covering the row — which keeps the row keyboard-reachable
 * and middle-clickable, unlike an onClick handler on `<tr>`.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Set to make the header a sort control. Value goes into `?sort=`. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  /** Tailwind width class, e.g. `"w-32"`. Omit to size from content. */
  width?: string;
  /** Hides the column below the given breakpoint to protect density. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  cellClassName?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  getRowKey: (row: T) => string;
  /** Makes the whole row navigable. The link sits in the first cell. */
  rowHref?: (row: T) => string;
  /** Current query state, used to build sort links. */
  searchParams?: Record<string, string | undefined>;
  sort?: string;
  order?: "asc" | "desc";
  emptyState?: ReactNode;
  /** Renders under the last row — a totals line, for instance. */
  footer?: ReactNode;
  className?: string;
}

const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  rowHref,
  searchParams = {},
  sort,
  order = "desc",
  emptyState,
  footer,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className="border-t border-line">{emptyState}</div>;
  }

  return (
    // The table scrolls inside its own container so the page body never does.
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="border-y border-line bg-surface-sunken">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "col-head px-3 py-2 font-semibold",
                  ALIGN[column.align ?? "left"],
                  column.width,
                  column.hideBelow && HIDE_BELOW[column.hideBelow],
                )}
              >
                {column.sortKey ? (
                  <SortLink
                    label={column.header}
                    sortKey={column.sortKey}
                    activeSort={sort}
                    order={order}
                    searchParams={searchParams}
                    align={column.align ?? "left"}
                  />
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={getRowKey(row)}
                className={cn(
                  "border-b border-line last:border-b-0 transition-colors",
                  href && "relative hover:bg-surface-hover focus-within:bg-surface-hover",
                )}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 py-2 text-sm text-ink align-middle",
                      ALIGN[column.align ?? "left"],
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                      column.cellClassName,
                    )}
                  >
                    {index === 0 && href ? (
                      <>
                        {/* Stretched link: covers the row, stays a real anchor. */}
                        <Link
                          href={href}
                          className="absolute inset-0 z-10 rounded-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
                        >
                          <span className="sr-only">View details</span>
                        </Link>
                        <span className="relative z-20 pointer-events-none">
                          {column.render(row)}
                        </span>
                      </>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>

        {footer ? (
          <tfoot className="border-t border-line bg-surface-sunken">{footer}</tfoot>
        ) : null}
      </table>
    </div>
  );
}

function SortLink({
  label,
  sortKey,
  activeSort,
  order,
  searchParams,
  align,
}: {
  label: ReactNode;
  sortKey: string;
  activeSort?: string;
  order: "asc" | "desc";
  searchParams: Record<string, string | undefined>;
  align: "left" | "right" | "center";
}) {
  const isActive = activeSort === sortKey;
  // Clicking the active column flips direction; a new column starts descending,
  // which is what a reader wants first from amounts and dates alike.
  const nextOrder = isActive && order === "desc" ? "asc" : "desc";
  const href = buildQuery(searchParams, { sort: sortKey, order: nextOrder, page: undefined });

  const Icon = !isActive ? ChevronsUpDown : order === "asc" ? ArrowUp : ArrowDown;

  return (
    <Link
      href={href}
      scroll={false}
      aria-sort={isActive ? (order === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "group inline-flex items-center gap-1 transition-colors hover:text-ink",
        isActive && "text-ink",
        align === "right" && "flex-row-reverse",
      )}
    >
      {label}
      <Icon
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60",
        )}
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Filter bar above a table. Keeps the gap and wrapping consistent so every
 * list screen's controls sit on the same line.
 */
export function TableToolbar({
  children,
  className,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-line px-3 py-2",
        className,
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {trailing ? <div className="flex items-center gap-1.5">{trailing}</div> : null}
    </div>
  );
}

/** Right-aligned numeric cell. Tabular figures come from the base layer. */
export function Amount({
  children,
  muted = false,
  className,
}: {
  children: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tnum font-medium", muted ? "text-ink-muted" : "text-ink", className)}>
      {children}
    </span>
  );
}
