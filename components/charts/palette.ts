/**
 * Chart colour, decided once.
 *
 * The design brief mandates a neutral hierarchy with one reserved high-chroma
 * accent, which rules out a multi-hue categorical palette. Rather than fight
 * that, every chart here carries a *single* series, so no categorical set is
 * ever needed and emerald keeps its one meaning: settled.
 *
 * Where a chart does encode an ordered scale — invoice ageing — it uses a
 * single-hue sequential ramp that darkens monotonically with severity, with
 * the terminal bucket promoted to the reserved danger colour. That is a status
 * colour used as a status colour: "over 90 days" is a genuine critical state,
 * and it ships with a text label, never colour alone.
 */

/**
 * Slate ramp, light → dark. Lightness decreases monotonically at every step.
 *
 * The first step is not the lightest slate available: it has to stay legible
 * against the #F4F5F7 track it is drawn on. A ramp that starts too pale makes
 * the largest bucket — usually the biggest bar on the chart — disappear.
 */
export const AGING_RAMP = ["#C3CAD3", "#A5AEB9", "#8792A0", "#68727F"] as const;

/** Terminal ageing bucket. Reserved danger token, matched to --color-danger. */
export const AGING_CRITICAL = "#B42318";

/** The single series colour for settled figures. Matches --color-accent. */
export const SERIES_ACCENT = "#168A48";

/** Recessive furniture: grid lines and axis rules. Matches --color-line. */
export const GRID = "#E2E6EA";

/** Returns the fill for an ageing bucket at `index` of `total`. */
export function agingFill(index: number, total: number): string {
  if (index === total - 1) return AGING_CRITICAL;
  return AGING_RAMP[Math.min(index, AGING_RAMP.length - 1)]!;
}
