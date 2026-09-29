import { differenceInCalendarDays, format, formatDistanceToNowStrict } from "date-fns";
import { AGING_BUCKETS, type AgingBucketKey, CURRENCY, LOCALE } from "./constants";

/**
 * Every money value in the system is an integer count of minor units — the
 * peso's sentimo, carried under the schema's generic `Cents` name. This module
 * is the only place that turns one into a string, and the only place that
 * parses a string back. Nothing else should call `toFixed` on a currency value.
 *
 * There is deliberately no `currency` parameter. The books are kept in one
 * currency, and a parameter whose default was wrong at nine call sites in ten
 * is precisely how the previous version came to render pesos with a dollar
 * sign while looking multi-currency.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(fractionDigits: number, display: "symbol" | "code" = "symbol") {
  const key = `${fractionDigits}:${display}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: CURRENCY,
      currencyDisplay: display,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, found);
  }
  return found;
}

/**
 * The symbol ICU itself uses, derived rather than hand-written. The version
 * this replaces read `currency === "USD" ? "$" : ""`, which is how the compact
 * formatter silently dropped the symbol for every currency but one.
 */
export const CURRENCY_SYMBOL =
  formatter(2)
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? CURRENCY;

/** `formatCents(123456)` → `"₱1,234.56"` */
export function formatCents(cents: number): string {
  return formatter(2).format(cents / 100);
}

/** Whole pesos, for dense table columns where sentimos add noise. */
export function formatCentsWhole(cents: number): string {
  return formatter(0).format(Math.round(cents / 100));
}

/**
 * `"PHP 1,234.56"` — the ISO code in place of the symbol, for surfaces that
 * cannot render ₱. The PDF is the one that matters: jsPDF registers its
 * built-in faces as WinAnsi-encoded, and WinAnsi has no glyph for U+20B1.
 *
 * ICU separates the code from the number with a non-breaking space; it is
 * normalised here so layout and assertions get a predictable string.
 */
export function formatCentsCode(cents: number): string {
  return formatter(2, "code")
    .format(cents / 100)
    .replace(/\u00a0/g, " ");
}

/** Axis and tile labels: `"₱1.2M"`, `"₱84k"`, `"₱620"`. */
export function formatCentsCompact(cents: number): string {
  const pesos = cents / 100;
  const abs = Math.abs(pesos);
  const sign = pesos < 0 ? "-" : "";
  const symbol = CURRENCY_SYMBOL;

  if (abs >= 1_000_000)
    return `${sign}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

/**
 * Parses user input into minor units. Tolerates the peso sign, an ISO-code
 * prefix, thousands separators, and surrounding whitespace. Returns null when
 * the input is not a number, so callers can tell "empty" from "zero".
 *
 * `$` stays in the strip set: pasted legacy text and OCR output still carry it,
 * and tolerating a symbol we no longer emit costs nothing. Note this is not a
 * blanket `[^\d.-]` strip — that would turn `"12abc34"` into 123400 and lose
 * the empty-versus-zero distinction the tests pin.
 */
export function parseCents(input: string): number | null {
  const cleaned = input
    .replace(/^\s*php\s*/i, "")
    .replace(/[₱$,\s\u00a0]/g, "")
    .trim();
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Minor units as a plain editable decimal string, e.g. `"1234.56"`. No symbol. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `"14 Mar 2026"` — day-first avoids the US/ISO ambiguity in a finance tool. */
export function formatDate(date: Date | string): string {
  return format(new Date(date), "d MMM yyyy");
}

/** `"14 Mar"` — for axes and dense rows where the year is implied. */
export function formatDateShort(date: Date | string): string {
  return format(new Date(date), "d MMM");
}

export function formatDateTime(date: Date | string): string {
  return format(new Date(date), "d MMM yyyy, HH:mm");
}

/** `"2026-03-14"` — for `<input type="date">` and CSV columns. */
export function toDateInput(date: Date | string): string {
  return format(new Date(date), "yyyy-MM-dd");
}

/** `"3 hours ago"`, `"2 days ago"`. */
export function formatRelative(date: Date | string): string {
  return `${formatDistanceToNowStrict(new Date(date))} ago`;
}

/** Positive when overdue, negative when still in hand, 0 on the due date. */
export function daysOverdue(dueDate: Date | string, asOf: Date = new Date()): number {
  return differenceInCalendarDays(asOf, new Date(dueDate));
}

/**
 * Plain-language due-date state. Returns a `tone` so the caller does not
 * re-derive urgency from the number.
 */
export function describeDueDate(
  dueDate: Date | string,
  asOf: Date = new Date(),
): { label: string; tone: "neutral" | "warn" | "danger" } {
  const days = daysOverdue(dueDate, asOf);
  if (days > 0) return { label: `${days} ${days === 1 ? "day" : "days"} overdue`, tone: "danger" };
  if (days === 0) return { label: "Due today", tone: "warn" };
  const remaining = Math.abs(days);
  if (remaining <= 7) return { label: `Due in ${remaining} ${remaining === 1 ? "day" : "days"}`, tone: "warn" };
  return { label: `Due in ${remaining} days`, tone: "neutral" };
}

export function agingBucket(dueDate: Date | string, asOf: Date = new Date()): AgingBucketKey {
  const days = daysOverdue(dueDate, asOf);
  for (const bucket of AGING_BUCKETS) {
    const overMin = days >= bucket.minDays;
    const underMax = bucket.maxDays === null || days <= bucket.maxDays;
    if (overMin && underMax) return bucket.key;
  }
  return "current";
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** `"Marisol Okonkwo"` → `"MO"`. Falls back to the first character. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Truncates on a word boundary so labels do not break mid-word. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
