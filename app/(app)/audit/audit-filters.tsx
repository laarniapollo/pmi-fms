"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { buildQuery } from "@/lib/utils";
import { AUDIT_ACTION_LABEL, type AuditAction } from "@/lib/constants";
import { Button, Spinner } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/**
 * Audit filters. Everything lives in the URL, so "show me what Daniel approved
 * last week" is a link an auditor can keep or send to someone else.
 */
export function AuditFilters({
  searchParams,
  actors,
  actions,
}: {
  searchParams: Record<string, string | undefined>;
  actors: Array<{ id: string; name: string }>;
  actions: Array<{ value: string; count: number }>;
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

  const activeCount = [
    searchParams.q,
    searchParams.actor,
    searchParams.action,
    searchParams.entity,
    searchParams.from,
    searchParams.to,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div className="relative min-w-48 flex-1 sm:max-w-56">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the trail…"
          aria-label="Search the audit log"
          className="h-7 w-full rounded border border-line bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </div>

      <Select
        selectSize="sm"
        aria-label="Filter by person"
        value={searchParams.actor ?? ""}
        onChange={(event) => apply({ actor: event.target.value || undefined })}
        className="w-auto min-w-36"
      >
        <option value="">Anyone</option>
        {actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </Select>

      <Select
        selectSize="sm"
        aria-label="Filter by action"
        value={searchParams.action ?? ""}
        onChange={(event) => apply({ action: event.target.value || undefined })}
        className="w-auto min-w-40"
      >
        <option value="">Any action</option>
        {actions.map((action) => (
          <option key={action.value} value={action.value}>
            {AUDIT_ACTION_LABEL[action.value as AuditAction] ?? action.value} ({action.count})
          </option>
        ))}
      </Select>

      <Select
        selectSize="sm"
        aria-label="Filter by record type"
        value={searchParams.entity ?? ""}
        onChange={(event) => apply({ entity: event.target.value || undefined })}
        className="w-auto min-w-32"
      >
        <option value="">Any record</option>
        {["Invoice", "Payment", "PaymentBatch", "Vendor", "User", "Session", "Settings"].map(
          (entity) => (
            <option key={entity} value={entity}>
              {entity === "PaymentBatch" ? "Payment run" : entity}
            </option>
          ),
        )}
      </Select>

      <div className="flex items-center gap-1">
        <Input
          inputSize="sm"
          type="date"
          aria-label="From date"
          value={searchParams.from ?? ""}
          onChange={(event) => apply({ from: event.target.value || undefined })}
          className="w-36"
        />
        <span className="text-2xs text-ink-subtle">to</span>
        <Input
          inputSize="sm"
          type="date"
          aria-label="To date"
          value={searchParams.to ?? ""}
          onChange={(event) => apply({ to: event.target.value || undefined })}
          className="w-36"
        />
      </div>

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
