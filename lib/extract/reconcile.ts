import { REVIEW_THRESHOLD, type ExtractedField, type ExtractedLineItem } from "./types";

/**
 * Cross-checks the money fields against each other and raises confidence when
 * they agree. Arithmetic that adds up is stronger evidence than any label.
 *
 * This is the one check in the pipeline that does not take the reader's word
 * for anything, which is why it survived the move from Tesseract to a language
 * model unchanged — and why it matters more now, not less. A model states its
 * confidence from how fluent the answer felt; it has no idea whether it read
 * the right glyph. The page's own arithmetic does.
 */
export function reconcileTotals(
  subtotal: ExtractedField<number>,
  tax: ExtractedField<number>,
  total: ExtractedField<number>,
  lineItems: ExtractedLineItem[],
): void {
  if (subtotal.value !== null && tax.value !== null && total.value !== null) {
    if (Math.abs(subtotal.value + tax.value - total.value) <= 2) {
      subtotal.confidence = round(Math.min(0.98, subtotal.confidence + 0.12));
      tax.confidence = round(Math.min(0.98, tax.confidence + 0.12));
      total.confidence = round(Math.min(0.99, total.confidence + 0.12));
      return;
    }

    /*
     * The three figures contradict each other, so at least one was misread.
     *
     * Recognition confidence cannot catch this on its own: it reports how sure
     * the engine is of the glyphs it saw, which is no help when it saw them
     * wrongly. A bold 9 read as a 0 comes back "read confidently" and is still
     * out by nine hundred thousand pesos — and the total is the figure an
     * approver actually acts on. Arithmetic knows better than the engine here,
     * so all three drop below the review threshold and a person is asked.
     */
    subtotal.confidence = doubt(subtotal.confidence);
    tax.confidence = doubt(tax.confidence);
    total.confidence = doubt(total.confidence);
    return;
  }

  // No tax line is common. Subtotal matching the total is still corroboration.
  if (subtotal.value !== null && total.value !== null && tax.value === null) {
    if (Math.abs(subtotal.value - total.value) <= 2) {
      subtotal.confidence = round(Math.min(0.96, subtotal.confidence + 0.08));
      total.confidence = round(Math.min(0.97, total.confidence + 0.08));
    }
  }

  if (lineItems.length > 0 && subtotal.value !== null) {
    const lineSum = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
    if (Math.abs(lineSum - subtotal.value) <= 2) {
      subtotal.confidence = round(Math.min(0.98, subtotal.confidence + 0.1));
    }
  }
}

/** Pushes a figure below the review threshold without ever raising it. */
function doubt(confidence: number): number {
  return round(Math.min(REVIEW_THRESHOLD - 0.05, confidence));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
