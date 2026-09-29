/**
 * Walks the whole accounts-payable path across two people in two browsers.
 *
 *   node scripts/check-workflow.mjs [baseUrl]
 *
 * This is the check that matters: a clerk enters an invoice, cannot approve
 * their own work, an approver signs it off, a payment is scheduled and sent,
 * and every step lands in the audit trail. Unit tests assert the rules; this
 * asserts the rules are actually wired to the buttons.
 *
 * Three invoices, because the approval policy has three things worth proving:
 *
 *   A  the ordinary path, one approval, through to a completed payment
 *   B  above ₱3,000,000 — the owner-authorisation warning, and the fact that
 *      nothing about the owner's decision is recorded
 *   C  ₱480 — the floor. Nothing clears itself; there is no auto-approve band
 *
 * The sequential-chain behaviour this script used to cover — a two-step chain
 * advancing, and one person being refused a second signature — no longer has a
 * subject here, because no invoice under the shipped ladder needs two
 * signatures. It moved to lib/approvals/decide-step.test.ts, where it is
 * tested directly rather than through the buttons.
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3010";
const PASSWORD = "Apollo!2026";
const ATTACHMENT = process.argv[3] ?? "/tmp/claude-1000/test-invoice.png";

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
};

/**
 * Waits for text to appear, and reports whether it did.
 *
 * Reading `innerText` straight after `waitForURL` races the render: a server
 * action redirect is a client-side RSC navigation, so the URL changes before
 * React has painted the new content. Waiting on the text itself is both the
 * synchronisation and the assertion.
 */
async function hasText(page, text, timeout = 15000) {
  return page
    .locator(`text=${text}`)
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
}

const browser = await chromium.launch();

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').waitFor();
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
  return { context, page };
}

// Numbers no seeded invoice uses, so the run is repeatable.
const RUN = Date.now().toString().slice(-8);
const INVOICE_NUMBER = `E2E-${RUN}`;
const ESCALATED_NUMBER = `E2E-${RUN}-OWN`;
const FLOOR_NUMBER = `E2E-${RUN}-MIN`;

const UNIT_PRICE = "415000.00";
const QUANTITY = "3";
const VAT_AMOUNT = "149400.00"; // 12% of 1,245,000.00
const EXPECTED_TOTAL = "₱1,394,400.00";
const EXPECTED_TOTAL_PLAIN = "1394400.00";

// Above the ₱3,000,000 owner-authorisation line.
const ESCALATED_UNIT = "3500000.00";
const ESCALATED_VAT = "420000.00";
const ESCALATED_TOTAL = "₱3,920,000.00";

// Under the old ladder this would have approved itself.
const FLOOR_UNIT = "480.00";
const FLOOR_TOTAL = "₱480.00";

console.log(`\nWorkflow check against ${BASE}`);
console.log(`Invoice ${INVOICE_NUMBER} · ${EXPECTED_TOTAL}\n`);

/**
 * Enters a draft invoice as the signed-in clerk and returns its URL.
 *
 * `vat` is keyed by hand rather than computed: the tax on a supplier's invoice
 * is whatever the supplier billed, and three of the twelve suppliers are not
 * VAT-registered at all. With no `vat` the invoice is entered as non-VAT; with
 * one it is VATable, and the supplier TIN comes from the vendor on file.
 */
async function enterInvoice(page, { number, quantity, unitPrice, vat }) {
  await page.goto(`${BASE}/invoices/new`, { waitUntil: "domcontentloaded" });
  await page.locator("#invoice-vendor").waitFor();

  const vendorValue = await page.locator("#invoice-vendor option:nth-child(2)").getAttribute("value");
  await page.selectOption("#invoice-vendor", vendorValue);
  await page.fill('input[name="invoiceNumber"]', number);
  await page.fill('input[name="issueDate"]', "2026-08-01");
  await page.fill('input[name="dueDate"]', "2026-09-01");
  await page.fill('input[aria-label="Line 1 description"]', "End-to-end check line");
  await page.fill('input[aria-label="Line 1 quantity"]', quantity);
  await page.fill('input[aria-label="Line 1 unit price"]', unitPrice);
  await page.selectOption("#vat-type", vat ? "VATABLE" : "NON_VAT");
  if (vat) await page.fill("#tax-input", vat);

  await Promise.all([
    page.waitForURL(/\/invoices\/[^/]+\?created=1/, { timeout: 30000 }),
    page.click('button[type="submit"]:has-text("Save draft")'),
  ]);
  return page.url().split("?")[0];
}

/** Attaches the source document and submits for approval. */
async function attachAndSubmit(page) {
  await page.setInputFiles('input[type="file"]', ATTACHMENT);
  await page.locator("text=Source").waitFor({ timeout: 30000 });
  await Promise.all([
    page.waitForURL(/submitted=1/, { timeout: 30000 }),
    page.click('button:has-text("Submit for approval")'),
  ]);
}

// --- 1. The clerk enters an invoice ----------------------------------------

console.log("1. Clerk enters an invoice");
const clerk = await signIn("clerk@apollo-ap.com");
const invoiceUrl = await enterInvoice(clerk.page, {
  number: INVOICE_NUMBER,
  quantity: QUANTITY,
  unitPrice: UNIT_PRICE,
  vat: VAT_AMOUNT,
});
const invoiceId = invoiceUrl.split("/").pop();
check(Boolean(invoiceId), "Draft saved", invoiceId);

let body = await clerk.page.locator("body").innerText();
check(body.includes(EXPECTED_TOTAL), "Total computed on the server", EXPECTED_TOTAL);
check(body.includes("Draft"), "Starts as a draft");

// --- 2. Attaching the source document is required before submitting ---------

console.log("\n2. Attachment control");
await Promise.all([
  clerk.page.waitForURL(/error=attachment/, { timeout: 30000 }),
  clerk.page.click('button:has-text("Submit for approval")'),
]);
check(
  await hasText(clerk.page, "Attach the supplier"),
  "Submitting without a document is refused",
  "requireAttachmentOnSubmit",
);

await attachAndSubmit(clerk.page);
check(true, "Document attached and marked as the source");

// --- 3. Submit for approval -------------------------------------------------

console.log("\n3. Clerk submits it for approval");
check(await hasText(clerk.page, "Pending approval"), "Moved to pending approval");
check(
  await hasText(clerk.page, "One approval required"),
  "Routed to one approval",
  "under the ₱3,000,000 line",
);
body = await clerk.page.locator("body").innerText();
check(
  !body.includes("the owner must authorise it personally"),
  "No owner-authorisation warning below the line",
);

// --- 3. The clerk cannot approve their own invoice --------------------------

console.log("\n4. Separation of duties");
check(
  (await clerk.page.locator('button:has-text("Approve")').count()) === 0,
  "Clerk sees no Approve button on their own invoice",
);
check(
  body.includes("somebody else has to approve it"),
  "The absence is explained rather than left a mystery",
);

await clerk.page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
check(
  clerk.page.url().includes("/dashboard"),
  "Clerk is redirected away from the approvals queue",
  new URL(clerk.page.url()).pathname,
);

// --- 4. The approver signs it off -------------------------------------------

console.log("\n5. Approver signs off");
const approver = await signIn("approver@apollo-ap.com");
await approver.page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
await approver.page.locator("h1").waitFor();

const inQueue = await approver.page.locator(`text=${INVOICE_NUMBER}`).count();
check(inQueue > 0, "Invoice appears in the approver's queue");

await approver.page.goto(invoiceUrl, { waitUntil: "domcontentloaded" });
await Promise.all([
  approver.page.waitForURL(/decided=approve/, { timeout: 30000 }),
  approver.page.click('button:has-text("Approve")'),
]);

check(
  await hasText(approver.page, "ready to schedule for payment"),
  "Fully approved on one signature",
);
check(await hasText(approver.page, "Approved"), "Status is Approved");

// --- 5. It leaves the queue it was decided from -----------------------------

console.log("\n6. Decided work leaves the queue");
await approver.page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
await approver.page.locator("h1").waitFor();
check(
  (await approver.page.locator(`text=${INVOICE_NUMBER}`).count()) === 0,
  "Invoice leaves the queue of the approver who signed it",
);

// The payment steps below were written for a second signer; the approver who
// signed can schedule the payment just as well.
const director = approver;

// --- 6. Schedule and send the payment ---------------------------------------

console.log("\n7. Payment");
// The approver's page is on the queue after step 6, not the invoice.
await director.page.goto(invoiceUrl, { waitUntil: "domcontentloaded" });
// The trigger and the dialog's submit button share their label; the dialog's
// is a submit bound to the form, so type is what tells them apart.
await director.page
  .locator('button[type="button"]:has-text("Schedule payment")')
  .waitFor({ timeout: 30000 });
await director.page.click('button:has-text("Schedule payment")');
await director.page.locator('select[name="method"]').waitFor();
await Promise.all([
  director.page.waitForURL(/\/payments\/[^/]+\?scheduled=1/, { timeout: 30000 }),
  director.page.click('button[type="submit"]:has-text("Schedule payment")'),
]);

const paymentUrl = director.page.url().split("?")[0];
check(await hasText(director.page, "Scheduled"), "Payment scheduled");
check(await hasText(director.page, EXPECTED_TOTAL), "Payment carries the invoice amount");

await Promise.all([
  director.page.waitForURL(/executed=1/, { timeout: 30000 }),
  director.page.click('button:has-text("Send payment")'),
]);

check(await hasText(director.page, "Completed"), "Payment completed");
body = await director.page.locator("body").innerText();
check(/[A-Z]+\d{9}/.test(body), "A payment reference was assigned");

await director.page.goto(invoiceUrl, { waitUntil: "domcontentloaded" });
check(await hasText(director.page, "Paid"), "Invoice is marked paid");

// --- 7. The auditor can see the whole story ---------------------------------

console.log("\n8. Audit trail");
const auditor = await signIn("auditor@apollo-ap.com");
await auditor.page.goto(`${BASE}/audit?q=${INVOICE_NUMBER}`, { waitUntil: "domcontentloaded" });
await auditor.page.locator("h1").waitFor();
await auditor.page.waitForTimeout(600);

body = await auditor.page.locator("body").innerText();
for (const step of [
  "Created invoice",
  "Submitted for approval",
  "Approved invoice",
  "Scheduled payment",
]) {
  check(body.includes(step), `Audit records "${step}"`);
}

check(
  (await auditor.page.locator('button:has-text("Approve")').count()) === 0,
  "Auditor has no write actions",
);

// The payment audit rows reference the payment, not the invoice number.
await auditor.page.goto(`${BASE}${new URL(paymentUrl).pathname}`, { waitUntil: "domcontentloaded" });
check(auditor.page.url().includes("/payments/"), "Auditor can read a payment record");

// --- 8. Export reflects the new invoice -------------------------------------

console.log("\n9. Export");
const csv = await auditor.context.request.get(`${BASE}/api/export/invoices?q=${INVOICE_NUMBER}`);
const text = await csv.text();
check(csv.status() === 200, "CSV export succeeds");
check(text.includes(INVOICE_NUMBER), "Export contains the invoice");
check(text.includes(EXPECTED_TOTAL_PLAIN), "Export carries the total as a plain decimal");

// --- 9. Above ₱3,000,000 the owner must authorise it personally ------------

console.log("\n10. Owner authorisation above ₱3,000,000");
const escalatedUrl = await enterInvoice(clerk.page, {
  number: ESCALATED_NUMBER,
  quantity: "1",
  unitPrice: ESCALATED_UNIT,
  vat: ESCALATED_VAT,
});
await attachAndSubmit(clerk.page);

body = await clerk.page.locator("body").innerText();
check(body.includes(ESCALATED_TOTAL), "Escalated invoice totals correctly", ESCALATED_TOTAL);
check(
  body.includes("One approval required"),
  "Still one approval — the owner signs outside the system, so the chain does not grow",
);
check(
  body.includes("the owner must authorise it personally"),
  "The requirement is stated on the invoice before anyone reaches Approve",
);

await approver.page.goto(`${BASE}/approvals`, { waitUntil: "domcontentloaded" });
await approver.page.locator("h1").waitFor();
check(
  await hasText(approver.page, "Owner authorisation"),
  "The queue flags it before the click, not after",
);

await approver.page.goto(escalatedUrl, { waitUntil: "domcontentloaded" });
await approver.page.click('button:has-text("Approve")');
check(
  await hasText(approver.page, "owner-authorisation line"),
  "Approving opens a confirmation rather than signing straight through",
);

await Promise.all([
  approver.page.waitForURL(/decided=approve/, { timeout: 30000 }),
  approver.page.click('dialog[open] button:has-text("Approve")'),
]);
check(await hasText(approver.page, "Approved"), "Confirming approves it");

// Nothing about the owner's decision is recorded — the approver's signature is
// the only one on file. A future change that starts recording it should fail
// here, and be a deliberate decision rather than a quiet one.
await auditor.page.goto(`${BASE}/audit?q=${ESCALATED_NUMBER}`, { waitUntil: "domcontentloaded" });
await auditor.page.locator("h1").waitFor();
await auditor.page.waitForTimeout(600);
body = await auditor.page.locator("body").innerText();
check(body.includes("Approved invoice"), "The approval itself is audited");
check(
  !/authorised by/i.test(body) && !/owner (approval|signature|authorisation) (obtained|recorded)/i.test(body),
  "No record of who authorised it, or when — by design",
);

// --- 10. The floor: nothing approves itself ---------------------------------

console.log("\n11. The approval floor");
await enterInvoice(clerk.page, {
  number: FLOOR_NUMBER,
  quantity: "1",
  unitPrice: FLOOR_UNIT,
  vat: "",
});
await attachAndSubmit(clerk.page);

body = await clerk.page.locator("body").innerText();
check(body.includes(FLOOR_TOTAL), "Smallest invoice totals correctly", FLOOR_TOTAL);
check(body.includes("Pending approval"), "A ₱480 invoice still waits for a person");
check(
  !body.includes("Below the approval threshold"),
  "There is no auto-approve band to fall into",
);
await browser.close();

console.log(
  failures === 0
    ? "\nThe whole workflow holds end to end.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
