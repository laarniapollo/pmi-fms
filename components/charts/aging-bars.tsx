import { formatCents, formatCentsCompact } from "@/lib/format";
import { agingFill } from "./palette";

export interface AgingDatum {
  key: string;
  label: string;
  cents: number;
  count: number;
}

/**
 * Invoice ageing as horizontal bars.
 *
 * Horizontal because the category labels are words ("Over 90 days") — rotated
 * x-axis text is the tell of a chart that should have been turned on its side.
 * Every bar is directly labelled, so the chart needs no hover to be read and
 * no legend: a single ordered scale, named by its title.
 */
export function AgingBars({ data }: { data: AgingDatum[] }) {
  const max = Math.max(...data.map((datum) => datum.cents), 1);
  const total = data.reduce((sum, datum) => sum + datum.cents, 0);

  if (total === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        Nothing outstanding. Every open invoice has been paid.
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      <ul className="space-y-2.5">
        {data.map((datum, index) => {
          const width = (datum.cents / max) * 100;

          return (
            <li key={datum.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-ink-muted">{datum.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-2xs tabular-nums text-ink-subtle">
                    {datum.count} {datum.count === 1 ? "invoice" : "invoices"}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-ink">
                    {formatCentsCompact(datum.cents)}
                  </span>
                </span>
              </div>

              <div className="mt-1 h-2 w-full overflow-hidden rounded-sm bg-canvas">
                <div
                  className="h-full rounded-sm transition-[width] duration-500"
                  style={{ width: `${Math.max(width, datum.cents > 0 ? 1.5 : 0)}%`, backgroundColor: agingFill(index, data.length) }}
                  role="img"
                  aria-label={`${datum.label}: ${formatCents(datum.cents)} across ${datum.count} invoices`}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-line pt-2 text-2xs text-ink-subtle">
        Anything past 90 days is flagged in red and should be escalated.
      </p>
    </div>
  );
}
