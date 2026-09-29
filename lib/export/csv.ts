/**
 * CSV writing, by hand.
 *
 * The entire specification a spreadsheet needs is: quote a field when it holds
 * a comma, quote, or newline, and double any quote inside it. That is a dozen
 * lines, so it does not warrant a dependency.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeField(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return "";
  const text = String(input);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv<T>(rows: readonly T[], columns: Array<CsvColumn<T>>): string {
  const lines = [columns.map((column) => escapeField(column.header)).join(",")];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeField(column.value(row))).join(","));
  }

  // CRLF, which is what Excel expects. A BOM makes it open UTF-8 correctly
  // rather than mangling any accented vendor name in the file.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** `invoices-2026-08-05.csv` */
export function timestampedName(prefix: string, extension = "csv"): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** Money as a plain decimal — no symbol, no separators, so it sums in a sheet. */
export function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** ISO date, which every spreadsheet parses unambiguously. */
export function csvDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : "";
}
