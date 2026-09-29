/**
 * Screenshots the app for visual review and reports console errors.
 *
 *   node scripts/shoot.mjs [baseUrl] [outDir] [width]
 *
 * Signs in as each demo role so role-dependent screens are captured the way
 * that role actually sees them. Exits nonzero if any screen threw.
 */

import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "/tmp/claude-1000/shots";
const WIDTH = Number(process.argv[4] ?? 1440);
const PASSWORD = "Apollo!2026";

const ADMIN = "admin@apollo-ap.com";
const APPROVER = "approver@apollo-ap.com";
const CLERK = "clerk@apollo-ap.com";
const AUDITOR = "auditor@apollo-ap.com";

/**
 * Each shot: { name, as, path, then? }. `then` runs after navigation, for
 * screens that need a click to reach (a detail page needs a row to exist).
 */
const SHOTS = [
  { name: "login", as: null, path: "/login" },
  { name: "signup", as: null, path: "/signup" },
  { name: "404", as: null, path: "/nothing-here" },
  { name: "dashboard-admin", as: ADMIN, path: "/dashboard" },
  { name: "dashboard-clerk", as: CLERK, path: "/dashboard" },
  { name: "dashboard-auditor", as: AUDITOR, path: "/dashboard" },
  { name: "invoices", as: ADMIN, path: "/invoices" },
  { name: "invoices-filtered", as: ADMIN, path: "/invoices?status=PENDING_APPROVAL&due=overdue" },
  { name: "invoices-empty", as: ADMIN, path: "/invoices?q=zzzznomatch" },
  {
    name: "invoice-detail",
    as: APPROVER,
    path: "/invoices",
    then: async (page) => {
      await page.locator("tbody tr a").first().click();
      await page.waitForURL(/\/invoices\/[^/]+$/, { timeout: 15000 });
    },
  },
  // The dropzone and the form are one page now, so this is the only shot.
  { name: "invoice-new", as: CLERK, path: "/invoices/new" },
  { name: "approvals", as: APPROVER, path: "/approvals" },
  { name: "approvals-empty", as: CLERK, path: "/dashboard" },
  { name: "payments", as: APPROVER, path: "/payments" },
  { name: "payment-runs", as: APPROVER, path: "/payments?tab=batches" },
  { name: "vendors", as: ADMIN, path: "/vendors" },
  { name: "audit", as: AUDITOR, path: "/audit" },
  { name: "audit-filtered", as: AUDITOR, path: "/audit?action=INVOICE_APPROVED" },
  { name: "archive", as: ADMIN, path: "/archive" },
  {
    name: "vendor-detail",
    as: ADMIN,
    path: "/vendors",
    then: async (page) => {
      await page.locator("tbody tr a").first().click();
      await page.waitForURL(/\/vendors\/[^/]+$/, { timeout: 15000 });
    },
  },
  {
    name: "payment-detail",
    as: APPROVER,
    path: "/payments",
    then: async (page) => {
      await page.locator("tbody tr a").first().click();
      await page.waitForURL(/\/payments\/[^/]+$/, { timeout: 15000 });
    },
  },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

/** One context per role, reused across that role's shots. */
const contexts = new Map();

async function contextFor(email) {
  if (contexts.has(email)) return contexts.get(email);

  const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
  if (email) {
    const page = await context.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="email"]').waitFor({ timeout: 20000 });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.close();
  }
  contexts.set(email, context);
  return context;
}

for (const shot of SHOTS) {
  const context = await contextFor(shot.as);
  const page = await context.newPage();

  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => problems.push(String(error).slice(0, 200)));

  try {
    // Not `networkidle`: Next prefetches sidebar routes continuously, so the
    // network never goes quiet and the wait times out on a page that rendered
    // perfectly well. Wait for the heading instead.
    await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ timeout: 20000 });
    if (shot.then) await shot.then(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true });

    if (problems.length > 0) {
      failures += 1;
      console.log(`  FAIL  ${shot.name.padEnd(20)} ${problems.length} console error(s)`);
      for (const problem of problems.slice(0, 3)) console.log(`          ${problem}`);
    } else {
      console.log(`  ok    ${shot.name.padEnd(20)} ${new URL(page.url()).pathname}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${shot.name.padEnd(20)} ${String(error).split("\n")[0].slice(0, 120)}`);
  }

  await page.close();
}

for (const context of contexts.values()) await context.close();
await browser.close();

console.log(
  failures === 0 ? `\nAll ${SHOTS.length} screens captured cleanly.` : `\n${failures} screen(s) had problems.`,
);
process.exit(failures === 0 ? 0 : 1);
