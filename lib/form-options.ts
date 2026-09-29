/**
 * Chart-of-accounts and cost-centre pick lists.
 *
 * Hard-coded because this build has no ledger integration; in a real
 * deployment these would come from the accounting system. They live here
 * rather than in the seed so the running application and the seeded history
 * offer the same codes — a seeded invoice coded to an account the form cannot
 * produce would be a small lie about where the data came from.
 */

export const GL_ACCOUNTS = [
  "6010 · Software & Subscriptions",
  "6120 · Professional Fees",
  "6200 · Facilities & Rent",
  "6310 · Freight & Logistics",
  "6400 · Marketing & Advertising",
  "6510 · Equipment",
  "6600 · Travel & Entertainment",
  "6700 · Utilities",
  "6800 · Insurance",
  "6900 · General & Administrative",
] as const;

export const COST_CENTERS = [
  "CC-100 Operations",
  "CC-200 Engineering",
  "CC-300 Sales",
  "CC-400 Finance",
  "CC-500 People",
  "CC-600 Facilities",
] as const;
