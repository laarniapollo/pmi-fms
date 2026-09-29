"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { buildQuery } from "@/lib/utils";
import { INVOICE_STATUS_META, INVOICE_STATUS_ORDER } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/button";

export interface VendorOption {
  id: string;
  name: string;
}

/**
 * Filter controls for the invoice list.
 *
 * All state lives in the URL, so a filtered view is shareable and the back
 * button undoes a filter. Selects apply immediately; the search box waits for
 * a pause in typing rather than firing a query per keystroke.
 */
export function InvoiceFilters({
  searchParams,
  vendors,
  showSource = true,
}: {
  searchParams: Record<string, string | undefined>;
  vendors: VendorOption[];
  showSource?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(searchParams.q ?? "");
  const initialQuery = useRef(searchParams.q ?? "");

  const apply = (updates: Record<string, string | undefined>) => {
    startTransition(() => {
      router.push(`${pathname}${buildQuery(searchParams, updates)}`, { scroll: false });
    });
  };

  // Debounce the free-text search. The ref guard stops the effect firing on
  // mount and clobbering a filter that arrived from a link.
  useEffect(() => {
    if (query === initialQuery.current) return;
    const timer = setTimeout(() => {
      initialQuery.current = query;
      apply({ q: query || undefined });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const active = [
    searchParams.q,
    searchParams.status,
    searchParams.vendor,
    searchParams.due,
    searchParams.source,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div className="relative min-w-48 flex-1 sm:max-w-64">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Invoice no., vendor, PO…"
          aria-label="Filter invoices"
          className="h-7 w-full rounded border border-line bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </div>

      <Select
        selectSize="sm"
        aria-label="Filter by status"
        value={searchParams.status ?? ""}
        onChange={(event) => apply({ status: event.target.value || undefined })}
        className="w-auto min-w-32"
      >
        <option value="">All statuses</option>
        {INVOICE_STATUS_ORDER.map((status) => (
          <option key={status} value={status}>
            {INVOICE_STATUS_META[status].label}
          </option>
        ))}
      </Select>

      <Select
        selectSize="sm"
        aria-label="Filter by vendor"
        value={searchParams.vendor ?? ""}
        onChange={(event) => apply({ vendor: event.target.value || undefined })}
        className="w-auto min-w-36 max-w-48"
      >
        <option value="">All vendors</option>
        {vendors.map((vendor) => (
          <option key={vendor.id} value={vendor.id}>
            {vendor.name}
          </option>
        ))}
      </Select>

      <Select
        selectSize="sm"
        aria-label="Filter by due date"
        value={searchParams.due ?? ""}
        onChange={(event) => apply({ due: event.target.value || undefined })}
        className="w-auto min-w-32"
      >
        <option value="">Any due date</option>
        <option value="overdue">Overdue</option>
        <option value="week">Due in 7 days</option>
        <option value="month">Due in 30 days</option>
      </Select>

      {showSource ? (
        <Select
          selectSize="sm"
          aria-label="Filter by source"
          value={searchParams.source ?? ""}
          onChange={(event) => apply({ source: event.target.value || undefined })}
          className="w-auto min-w-28"
        >
          <option value="">Any source</option>
          <option value="scanned">Scanned</option>
        </Select>
      ) : null}

      {pending ? <Spinner className="text-ink-subtle" /> : null}

      {active > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setQuery("");
            initialQuery.current = "";
            startTransition(() => router.push(pathname, { scroll: false }));
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear {active}
        </Button>
      ) : null}
    </div>
  );
}
