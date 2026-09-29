/**
 * Conditional class names. Deliberately not `clsx` + `tailwind-merge`: this
 * codebase composes classes through variant maps rather than by overriding
 * them, so conflict resolution is never needed and a 12-line helper does the
 * whole job.
 */
export function cn(...parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

/** Stable pseudo-random integer from a string. Used for deterministic seeding. */
export function hashToInt(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Clamp for pagination maths and progress widths. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `groupBy(invoices, i => i.status)` → `Map<status, Invoice[]>` */
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

/**
 * Serialises a partial set of search params onto the current ones, dropping
 * empty values and resetting to page 1 whenever a filter changes. Every list
 * screen shares this so filter, sort, and pagination stay consistent.
 */
export function buildQuery(
  current: URLSearchParams | Record<string, string | undefined>,
  updates: Record<string, string | number | undefined | null>,
): string {
  const params =
    current instanceof URLSearchParams
      ? new URLSearchParams(current)
      : new URLSearchParams(
          Object.entries(current).filter((entry): entry is [string, string] => Boolean(entry[1])),
        );

  let touchedFilter = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === "") params.delete(key);
    else params.set(key, String(value));
    if (key !== "page") touchedFilter = true;
  }

  if (touchedFilter && !("page" in updates)) params.delete("page");

  const query = params.toString();
  return query ? `?${query}` : "";
}
