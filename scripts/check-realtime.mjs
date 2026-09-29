/**
 * Checks that live updates actually reach another person's open tab.
 *
 *   node scripts/check-realtime.mjs [baseUrl]
 *
 * Two browsers, two people: the clerk sits on an invoice while an approver
 * decides it elsewhere, and the clerk's tab should learn about it without a
 * refresh. Also confirms the actor does not get told about their own action.
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3010";
const PASSWORD = "Apollo!2026";
const ATTACHMENT = process.argv[3] ?? "/tmp/claude-1000/test-invoice.png";

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').waitFor();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
  return page;
}

const NUMBER = `RT-${Date.now().toString().slice(-8)}`;
console.log(`\nLive-update check against ${BASE}\nInvoice ${NUMBER}\n`);

// The clerk raises an invoice and submits it.
const clerk = await signIn("clerk@apollo-ap.com");
await clerk.goto(`${BASE}/invoices/new`, { waitUntil: "domcontentloaded" });
await clerk.locator("#invoice-vendor").waitFor();

const vendor = await clerk.locator("#invoice-vendor option:nth-child(3)").getAttribute("value");
await clerk.selectOption("#invoice-vendor", vendor);
await clerk.fill('input[name="invoiceNumber"]', NUMBER);
await clerk.fill('input[name="issueDate"]', "2026-08-01");
await clerk.fill('input[name="dueDate"]', "2026-09-01");
await clerk.fill('input[aria-label="Line 1 description"]', "Live update check");
await clerk.fill('input[aria-label="Line 1 quantity"]', "1");
await clerk.fill('input[aria-label="Line 1 unit price"]', "185000.00"); // one approval
await clerk.selectOption("#vat-type", "NON_VAT"); // keeps the total at the one-approval figure
await Promise.all([
  clerk.waitForURL(/created=1/, { timeout: 30000 }),
  clerk.click('button[type="submit"]:has-text("Save draft")'),
]);

const invoiceUrl = clerk.url().split("?")[0];

await Promise.all([
  clerk.waitForURL(/error=attachment/, { timeout: 30000 }),
  clerk.click('button:has-text("Submit for approval")'),
]);
await clerk.setInputFiles('input[type="file"]', ATTACHMENT);
await clerk.locator("text=Source").waitFor({ timeout: 30000 });
await Promise.all([
  clerk.waitForURL(/submitted=1/, { timeout: 30000 }),
  clerk.click('button:has-text("Submit for approval")'),
]);
console.log("  Clerk submitted the invoice and is sitting on the page.");

// Confirm the stream connected before relying on it.
const connected = await clerk
  .locator('[title="Live updates connected"]')
  .waitFor({ timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check(connected, "Clerk's tab reports a live connection");

// Nothing the clerk did should have produced a toast in their own tab.
const selfToast = await clerk
  .locator('[role="status"] >> text=approved')
  .first()
  .waitFor({ timeout: 3000 })
  .then(() => true)
  .catch(() => false);
check(!selfToast, "The actor is not notified about their own action");

// The approver decides it in a different browser context.
const approver = await signIn("approver@apollo-ap.com");
await approver.goto(invoiceUrl, { waitUntil: "domcontentloaded" });
await Promise.all([
  approver.waitForURL(/decided=approve/, { timeout: 30000 }),
  approver.click('button:has-text("Approve")'),
]);
console.log("  Approver approved it in a separate session.");

// The clerk's tab should hear about it with no interaction of its own.
const gotToast = await clerk
  .locator(`[role="status"] >> text=${NUMBER}`)
  .first()
  .waitFor({ timeout: 25000 })
  .then(() => true)
  .catch(() => false);
check(gotToast, "Clerk's tab was told, without a refresh");

// And the page content itself should have caught up.
const refreshed = await clerk
  .locator("text=Approved")
  .first()
  .waitFor({ timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check(refreshed, "Clerk's page content refreshed to the new status");

await clerk.screenshot({ path: "/tmp/claude-1000/shots/realtime.png", fullPage: false });

await browser.close();
console.log(failures === 0 ? "\nLive updates work across sessions.\n" : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
