"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { buildQuery } from "@/lib/utils";
import { VENDOR_STATUS_META, type VendorStatus } from "@/lib/constants";
import { Button, Spinner } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export function VendorFilters({
  searchParams,
  categories,
}: {
  searchParams: Record<string, string | undefined>;
  categories: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(searchParams.q ?? "");
  const applied = useRef(searchParams.q ?? "");

  const apply = (updates: Record<string, string | undefined>) => {
    startTransition(() => {
      router.push(`${pathname}${buildQuery(searchParams, updates)}`, { scroll: false });
    });
  };

  useEffect(() => {
    if (query === applied.current) return;
    const timer = setTimeout(() => {
      applied.current = query;
      apply({ q: query || undefined });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const activeCount = [searchParams.q, searchParams.status, searchParams.category].filter(
    Boolean,
  ).length;

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
          placeholder="Vendor name or email…"
          aria-label="Filter vendors"
          className="h-7 w-full rounded border border-line bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </div>

      <Select
        selectSize="sm"
        aria-label="Filter by category"
        value={searchParams.category ?? ""}
        onChange={(event) => apply({ category: event.target.value || undefined })}
        className="w-auto min-w-40"
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </Select>

      <Select
        selectSize="sm"
        aria-label="Filter by status"
        value={searchParams.status ?? ""}
        onChange={(event) => apply({ status: event.target.value || undefined })}
        className="w-auto min-w-32"
      >
        <option value="">All statuses</option>
        {(Object.keys(VENDOR_STATUS_META) as VendorStatus[]).map((status) => (
          <option key={status} value={status}>
            {VENDOR_STATUS_META[status].label}
          </option>
        ))}
      </Select>

      {pending ? <Spinner className="text-ink-subtle" /> : null}

      {activeCount > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setQuery("");
            applied.current = "";
            startTransition(() => router.push(pathname, { scroll: false }));
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear {activeCount}
        </Button>
      ) : null}
    </div>
  );
}
