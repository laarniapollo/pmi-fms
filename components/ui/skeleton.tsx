import { cn } from "@/lib/utils";

/** Placeholder block. Sized by the caller to match the content it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-neutral-soft", className)} />;
}

/** Loading state for a DataTable. Matches its row height so nothing shifts. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full" aria-busy="true" aria-label="Loading results">
      <div className="flex gap-3 border-y border-line bg-surface-sunken px-3 py-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3 border-b border-line px-3 py-2.5">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cn("h-3 flex-1", colIndex === 0 && "max-w-32", colIndex === columns - 1 && "max-w-20")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-flat" aria-busy="true">
      <Skeleton className="h-3 w-28" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    </div>
  );
}
