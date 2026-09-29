"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { formatCents, formatCentsCompact } from "@/lib/format";
import { GRID, SERIES_ACCENT } from "./palette";

export interface SpendDatum {
  key: string;
  label: string;
  /** Short axis form, e.g. "Mar". */
  axisLabel: string;
  cents: number;
  count: number;
  /** The month still in progress — drawn hatched, not solid. */
  partial?: boolean;
}

/**
 * Monthly settled spend — one series, so no legend: the card title names it.
 *
 * The in-progress month is hatched rather than solid, because drawing a
 * part-month at full weight invites the reader to compare it with complete
 * months and conclude spend has collapsed.
 */
export function SpendColumns({ data }: { data: SpendDatum[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const max = Math.max(...data.map((datum) => datum.cents), 1);
  const complete = data.filter((datum) => !datum.partial);
  const average =
    complete.length > 0
      ? complete.reduce((sum, datum) => sum + datum.cents, 0) / complete.length
      : 0;

  const active = data.find((datum) => datum.key === hovered);
  const CHART_HEIGHT = 132;

  return (
    <div className="px-4 pb-3 pt-4">
      <div className="relative">
        {/* Mean line — the reference a month is actually judged against. */}
        {average > 0 ? (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed"
            style={{ bottom: `${(average / max) * CHART_HEIGHT + 20}px`, borderColor: GRID }}
          >
            <span className="absolute right-0 -top-4 bg-surface pl-1 text-2xs text-ink-subtle">
              avg {formatCentsCompact(average)}
            </span>
          </div>
        ) : null}

        <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
          {data.map((datum) => {
            const height = (datum.cents / max) * CHART_HEIGHT;
            const isHovered = hovered === datum.key;

            return (
              <button
                key={datum.key}
                type="button"
                onMouseEnter={() => setHovered(datum.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(datum.key)}
                onBlur={() => setHovered(null)}
                aria-label={`${datum.label}: ${formatCents(datum.cents)} across ${datum.count} invoices${datum.partial ? ", month in progress" : ""}`}
                className="group relative flex flex-1 items-end justify-center rounded-sm"
                style={{ height: CHART_HEIGHT }}
              >
                <span
                  className={cn(
                    "w-full rounded-t-[3px] transition-opacity",
                    isHovered ? "opacity-100" : "opacity-85",
                  )}
                  style={{
                    height: Math.max(height, datum.cents > 0 ? 2 : 0),
                    backgroundColor: datum.partial ? "transparent" : SERIES_ACCENT,
                    ...(datum.partial
                      ? {
                          backgroundImage: `repeating-linear-gradient(45deg, ${SERIES_ACCENT} 0 2px, transparent 2px 5px)`,
                          border: `1px solid ${SERIES_ACCENT}66`,
                        }
                      : {}),
                  }}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-1.5 flex gap-1 border-t border-line pt-1.5">
          {data.map((datum) => (
            <span
              key={datum.key}
              className={cn(
                "flex-1 text-center text-2xs tabular-nums transition-colors",
                hovered === datum.key ? "font-medium text-ink" : "text-ink-subtle",
              )}
            >
              {datum.axisLabel}
            </span>
          ))}
        </div>
      </div>

      {/* Readout rather than a floating tooltip: fixed position, no occlusion. */}
      <div className="mt-2 flex h-8 items-center justify-between border-t border-line pt-2">
        {active ? (
          <>
            <span className="text-xs text-ink-muted">
              {active.label}
              {active.partial ? " · in progress" : ""}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-2xs tabular-nums text-ink-subtle">
                {active.count} {active.count === 1 ? "invoice" : "invoices"}
              </span>
              <span className="text-sm font-medium tabular-nums text-ink">
                {formatCents(active.cents)}
              </span>
            </span>
          </>
        ) : (
          <span className="text-2xs text-ink-subtle">
            Hover or tab through a column for the month&rsquo;s total.
          </span>
        )}
      </div>
    </div>
  );
}
