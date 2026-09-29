export interface VendorOption {
  id: string;
  name: string;
}

/**
 * Matches a read vendor name to one on file by token overlap.
 *
 * Letterheads do not arrive clean — a trading name, a legal suffix, or a
 * misread word ("Bayanihan Cloud Systerns") — so exact matching finds nothing
 * useful. Requiring *more* than half the tokens to line up is loose enough to
 * survive that and tight enough not to pick a stranger.
 *
 * The strictness of that boundary is deliberate, and it costs something: a
 * two-word supplier with one word misread scores exactly 0.5 and is rejected.
 * That is the right way to fail. Accepting 0.5 would also accept "Manila
 * Logistics" as "Northwind Logistics" — two different companies that happen to
 * share a word — and filing an invoice against the wrong supplier is how the
 * wrong bank account gets paid.
 *
 * This is the fallback, not the primary matcher: the model is given the vendor
 * list and usually returns an id directly. It earns its keep when the model
 * declines to match, and it is the only path that never trusts a generated id.
 */
export function matchVendor<T extends VendorOption>(
  name: string | null,
  vendors: readonly T[],
): T | null {
  if (!name) return null;

  const tokens = normalise(name);
  if (tokens.length === 0) return null;

  let best: { vendor: T; score: number } | null = null;

  for (const vendor of vendors) {
    const candidate = normalise(vendor.name);
    if (candidate.length === 0) continue;

    const shared = candidate.filter((token) => tokens.includes(token)).length;
    const score = shared / Math.max(candidate.length, tokens.length);

    if (score > (best?.score ?? 0)) best = { vendor, score };
  }

  return best && best.score > 0.5 ? best.vendor : null;
}

function normalise(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["the", "and", "inc", "llc", "ltd", "llp"].includes(token));
}
