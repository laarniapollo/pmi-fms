import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn, buildQuery, clamp } from "@/lib/utils";
import { PAGE_SIZES } from "@/lib/constants";

/**
 * Page controls for every list. Shows the true total, not just the page, so a
 * reader can tell whether a filter did anything before paging through it.
 */
export function Pagination({
  page,
  pageSize,
  total,
  searchParams,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | undefined>;
  className?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = clamp(page, 1, pageCount);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2",
        className,
      )}
    >
      <p className="text-xs text-ink-muted tabular-nums">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            <span className="font-medium text-ink">
              {first}–{last}
            </span>{" "}
            of <span className="font-medium text-ink">{total.toLocaleString()}</span>
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-1.5 sm:flex">
          <span className="text-xs text-ink-subtle">Rows</span>
          {PAGE_SIZES.map((size) => (
            <Link
              key={size}
              href={buildQuery(searchParams, { size, page: undefined })}
              scroll={false}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs tabular-nums transition-colors",
                size === pageSize
                  ? "bg-neutral-soft font-medium text-ink"
                  : "text-ink-muted hover:bg-surface-hover hover:text-ink",
              )}
            >
              {size}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <PageArrow
            direction="prev"
            disabled={current <= 1}
            href={buildQuery(searchParams, { page: current - 1 })}
          />
          <span className="px-1.5 text-xs text-ink-muted tabular-nums">
            Page <span className="font-medium text-ink">{current}</span> of {pageCount}
          </span>
          <PageArrow
            direction="next"
            disabled={current >= pageCount}
            href={buildQuery(searchParams, { page: current + 1 })}
          />
        </div>
      </div>
    </div>
  );
}

function PageArrow({
  direction,
  disabled,
  href,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  href: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const label = direction === "prev" ? "Previous page" : "Next page";
  const shared = "inline-flex h-7 w-7 items-center justify-center rounded border transition-colors";

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className={cn(shared, "cursor-not-allowed border-line bg-surface text-ink-subtle opacity-50")}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }

  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className={cn(shared, "border-line bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink")}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

/**
 * Reads pagination and sort state out of the URL, applying the defaults every
 * list screen shares. Returns Prisma-ready `skip`/`take` so no page does the
 * arithmetic itself.
 */
export function readListParams(
  searchParams: Record<string, string | undefined>,
  options: { defaultSort: string; defaultOrder?: "asc" | "desc"; allowedSorts: string[] },
): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sort: string;
  order: "asc" | "desc";
} {
  const rawSize = Number(searchParams.size);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawSize) ? rawSize : PAGE_SIZES[0];

  const rawPage = Number(searchParams.page);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const requestedSort = searchParams.sort ?? "";
  const sort = options.allowedSorts.includes(requestedSort) ? requestedSort : options.defaultSort;
  const order = searchParams.order === "asc" ? "asc" : searchParams.order === "desc" ? "desc" : (options.defaultOrder ?? "desc");

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, order };
}
