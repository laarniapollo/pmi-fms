/**
 * End-to-end check of the scanning path, in a real browser.
 *
 *   node scripts/check-scan.mjs [baseUrl] [imagePath]
 *
 * The extraction module has unit tests and they run offline with no key; this
 * exercises everything they cannot — that the route authenticates and reaches
 * the model, that the reply fills the form on the same page as the dropzone,
 * that the API key stays on the server, and that typing into the form before
 * uploading raises a confirmation rather than silently discarding the work.
 *
 * It needs a real `GEMINI_API_KEY` on the server, so it cannot gate CI on its
 * own. With scanning unconfigured it checks the "not set up" path instead and
 * exits cleanly, because a server without a key is a supported state, not a
 * broken one.
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3002";
const IMAGE = process.argv[3] ?? "/tmp/claude-1000/test-invoice.png";
/** Optional: a document printing no VAT line, to exercise the computed path. */
const NO_VAT_IMAGE = process.argv[4];
const PASSWORD = "Apollo!2026";
const SHOTS = "/tmp/claude-1000/shots";

// The document prints bare figures with no currency mark — see the note in
// make-test-invoice.mjs. The peso sign here comes from the form, which formats
// through lib/format. That the two meet is the point of the check.
const EXPECTED_FIELDS = [
  ["invoice number", 'input[name="invoiceNumber"]', "BCS-2026-0184"],
  ["PO number", 'input[name="poNumber"]', "PO-48221"],
  ["issue date", 'input[name="issueDate"]', "2026-03-14"],
  ["due date", 'input[name="dueDate"]', "2026-04-13"],
];

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();

/*
 * The assertion that used to say "zero external requests" is inverted, not
 * dropped. Scanning now does reach Google — but only from the server. The
 * browser must still make no external request, and that is a stronger property
 * than it sounds: it is what fails loudly if anyone ever "simplifies" this by
 * moving the API key into a client component.
 */
const external = [];
const errors = [];
page.on("request", (request) => {
  const url = request.url();
  if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
    external.push(url);
  }
});
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
page.on("console", (message) => {
  if (message.type() === "error" && !/Failed to load resource/.test(message.text())) {
    errors.push(message.text().slice(0, 200));
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', "clerk@apollo-ap.com");
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 }),
  page.click('button[type="submit"]'),
]);

console.log("Signed in as the clerk. Opening /invoices/new…\n");
// No `?mode=scan`. The parameter is gone, and so is the tab it selected.
await page.goto(`${BASE}/invoices/new`, { waitUntil: "domcontentloaded" });
await page.locator("h1").first().waitFor();

// --- the one-page requirement, pinned ------------------------------------
console.log("One page:");
const hasForm = await page.locator('input[name="invoiceNumber"]').isVisible();
check(hasForm, "the invoice form is on the same page as the upload band");

const notConfigured = await page.locator("text=Scanning is not set up").isVisible();

if (notConfigured) {
  check(hasForm, "the form is still usable with no key configured");
  console.log("\nScanning is not configured on this server, so the read path was skipped.");
  console.log("Set GEMINI_API_KEY and GEMINI_MODEL to exercise it.");
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

const hasDropzone = await page.locator('input[type="file"]').count();
check(hasDropzone > 0, "the dropzone is present");

/*
 * Wait for hydration before touching anything.
 *
 * The server-rendered form accepts typing before React has attached to it, and
 * a script can win that race in a way no person would. Typing that early is
 * not a fair test — it also hides real regressions behind a timing artefact.
 * React stamps `__reactFiber$…` onto DOM nodes as it hydrates them, which is
 * the signal, and it needs nothing added to the application.
 */
await page.waitForFunction(
  () => {
    const form = document.querySelector("form");
    return Boolean(form) && Object.keys(form).some((key) => key.startsWith("__react"));
  },
  null,
  { timeout: 30000 },
);

// --- typing first must not be discarded silently -------------------------
console.log("\nExisting input:");
await page.fill('input[name="invoiceNumber"]', "TYPED-BY-HAND");
await uploadFixture();

const confirmVisible = await page
  .locator("text=Replace what you have filled in?")
  .waitFor({ timeout: 120000 })
  .then(() => true)
  .catch(() => false);
check(confirmVisible, "uploading over typed input asks before replacing it");

if (confirmVisible) {
  await page.click("button:has-text('Keep what I typed')");
  const kept = await page.inputValue('input[name="invoiceNumber"]');
  check(kept === "TYPED-BY-HAND", "'Keep what I typed' leaves the typed value alone", kept);
}

// --- a clean read fills the form in place --------------------------------
console.log("\nReading the document:");
// Back to a dropzone, and back to a form that matches its mount snapshot, so
// the next upload takes the silent path the common case uses.
await page.locator("button:has-text('Replace')").first().click();
await page.locator("text=Drop an invoice here").waitFor({ timeout: 10000 });
await page.fill('input[name="invoiceNumber"]', "");

const started = Date.now();
await uploadFixture();

/*
 * Waits on the input's live `value` property, not on an attribute selector.
 * `input[name="x"]:not([value=""])` looks right and is useless here: the field
 * is uncontrolled, so with no default it carries no `value` attribute at all
 * and the selector matches instantly — reporting a pass before the scan has
 * even been sent.
 */
const filled = await page
  .waitForFunction(
    () => {
      const el = document.querySelector('input[name="invoiceNumber"]');
      return el instanceof HTMLInputElement && el.value.trim() !== "";
    },
    null,
    { timeout: 120000 },
  )
  .then(() => true)
  .catch(() => false);

if (!check(filled, "the fields filled in from the document")) {
  await page.screenshot({ path: `${SHOTS}/scan-failed.png`, fullPage: true });
  await browser.close();
  process.exit(1);
}
console.log(`        read in ${((Date.now() - started) / 1000).toFixed(1)}s`);

for (const [label, selector, expected] of EXPECTED_FIELDS) {
  const actual = await page.inputValue(selector);
  check(actual === expected, label, `expected ${expected}, got ${actual || "(blank)"}`);
}

const vendor = await page.inputValue("#invoice-vendor");
check(vendor !== "", "the vendor was matched to one on file");

const body = await page.locator("body").innerText();
check(body.includes("₱2,800,000.00"), "the total came out at ₱2,800,000.00");

// The VAT box is an input, so its figure is a property rather than page text.
const vat = await page.inputValue("#tax-input");
check(vat === "300000.00", "the VAT printed on the document was used", `got ${vat || "(blank)"}`);
check(!body.includes("Computed"), "VAT read from the document is not labelled Computed");

// A printed VAT line is evidence of a VATable sale, so the type is never left
// for the clerk to pick on this fixture.
const vatType = await page.inputValue("#vat-type");
check(vatType === "VATABLE", "the VAT type was determined as VATable", `got ${vatType || "(blank)"}`);

// --- the collapsed band --------------------------------------------------
console.log("\nThe band:");
check(body.includes("read "), "the band reports how many fields were read");

const toggle = page.locator("button:has-text('Show document')");
check((await toggle.count()) > 0, "a 'Show document' toggle is offered");
if ((await toggle.count()) > 0) {
  await toggle.first().click();
  const shown = await page
    .locator("img[alt^='Uploaded document'], object[aria-label^='Uploaded document']")
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(shown, "'Show document' reveals the document");
}

// --- a document with no VAT line gets a visibly computed figure ----------
console.log("\nVAT when the document prints none:");
if (NO_VAT_IMAGE) {
  await page.locator("button:has-text('Replace')").first().click();
  await page.locator("text=Drop an invoice here").waitFor({ timeout: 10000 });
  await uploadFixture(NO_VAT_IMAGE);

  // With no VAT line and no VAT marker, the type is left for the person to
  // choose; picking VATable is what brings in the computed 12%. Wait for the
  // read to land first — the form remounts when it does, and would drop a
  // choice made before it.
  await page.locator("text=/read \\d+ of \\d+ fields/").waitFor({ timeout: 120000 }).catch(() => {});
  if (!(await page.inputValue("#vat-type"))) {
    check(true, "a document with no VAT marker leaves the VAT type for the clerk");
    await page.selectOption("#vat-type", "VATABLE");
  }

  const computed = await page
    .locator("text=Computed")
    .waitFor({ timeout: 120000 })
    .then(() => true)
    .catch(() => false);
  check(computed, "a document with no VAT line is labelled Computed");

  if (computed) {
    // Typing into the box hands ownership over, so the label must go: leaving
    // it up would describe a figure the person entered as one we worked out.
    await page.fill("#tax-input", "1234.00");
    const stillLabelled = await page.locator("text=Computed").isVisible().catch(() => false);
    check(!stillLabelled, "the Computed label disappears once VAT is typed into");
  }
} else {
  console.log("  SKIP  pass a no-VAT fixture as the 4th argument to check this");
}

// --- the key never reaches the browser -----------------------------------
console.log("\nWhere the document goes:");
if (external.length > 0) {
  failures += 1;
  console.log(`  FAIL  the browser made ${external.length} external request(s) — only the server`);
  console.log("        should talk to the model, or the API key is client-side:");
  for (const url of [...new Set(external)].slice(0, 5)) console.log(`        ${url}`);
} else {
  console.log("  PASS  the browser made no external request — only the server called the model");
}

check(errors.length === 0, "no console errors", errors.slice(0, 2).join(" | "));

await page.screenshot({ path: `${SHOTS}/scan-filled.png`, fullPage: true });
await browser.close();

console.log(failures === 0 ? "\nScanning works end to end." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Setting the input before React has hydrated fires a change event into a
 * component with no handler attached yet, and the scan silently never starts.
 * Retry until something actually happens rather than assuming one attempt took.
 *
 * The signal is the dropzone *going away*, not the "Reading…" text appearing.
 * Waiting on "Reading…" races the scan itself: a fast read is over inside the
 * timeout, the locator never matches, and the retry uploads the same document
 * a second time — two billed model calls for one action. The dropzone is gone
 * for the whole of both the scanning and the finished states, so it cannot be
 * missed by being too quick.
 */
async function uploadFixture(image = IMAGE) {
  for (let attempt = 0; attempt < 6; attempt++) {
    // Clearing first matters: re-setting the same file leaves `files`
    // unchanged and the browser fires no second change event, so every retry
    // after the first would be a no-op.
    await page.setInputFiles('input[type="file"]', []);
    await page.waitForTimeout(400);
    await page.setInputFiles('input[type="file"]', image);

    const moved = await page
      .locator("text=Drop an invoice here")
      .waitFor({ state: "hidden", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (moved) return true;
  }
  return false;
}
