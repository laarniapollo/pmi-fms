/**
 * Whether a form has been typed into since it was rendered.
 *
 * Written against `FormData` rather than React state on purpose. `InvoiceForm`
 * mixes controlled fields with uncontrolled `defaultValue` ones, so a dirty
 * flag held in state would have to be threaded through every input in the file;
 * a snapshot of the form's own data covers both kinds at once and needs no
 * changes inside the form at all.
 *
 * The comparison is against a snapshot taken at mount, not against emptiness.
 * That distinction matters: the issue date is pre-filled with today, and a
 * naive "is anything non-empty" check would report every untouched form as
 * edited and put a confirmation dialog in front of the common case.
 */

export type FormSnapshot = ReadonlyMap<string, string>;

/**
 * Joins repeated field names so a changed repeat still reads as a change. The
 * unit separator is used because no form value will contain one.
 */
const REPEAT_SEPARATOR = "\u001f";

export function snapshotForm(data: FormData): FormSnapshot {
  const snapshot = new Map<string, string>();

  for (const [name, value] of data.entries()) {
    // File inputs carry the uploaded document, which is not something the
    // person typed and is replaced by the scan in any case.
    if (typeof value !== "string") continue;

    const existing = snapshot.get(name);
    snapshot.set(name, existing === undefined ? value : `${existing}${REPEAT_SEPARATOR}${value}`);
  }

  return snapshot;
}

export function hasEdits(before: FormSnapshot, current: FormData): boolean {
  const after = snapshotForm(current);
  if (after.size !== before.size) return true;

  for (const [name, value] of after) {
    if (before.get(name) !== value) return true;
  }

  return false;
}
