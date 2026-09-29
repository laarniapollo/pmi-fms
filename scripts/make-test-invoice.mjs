/**
 * Renders a realistic supplier invoice to PNG, for exercising the scanner.
 *
 *   node scripts/make-test-invoice.mjs [outPath]
 *
 * A generated document is not a substitute for a photographed one — it has no
 * skew, shadow, or JPEG noise — but it does prove the whole path works:
 * upload, rasterise, recognise, parse, and match a vendor already on file.
 *
 * There is deliberately no ₱ anywhere in the document. Three reasons: the faces
 * this renders in (Georgia, Times New Roman) have no glyph for U+20B1, so
 * Chromium would fall back per-glyph to a mismatched serif; Tesseract's bundled
 * `eng` model has no ₱ in its charset and would read noise; and Philippine
 * suppliers routinely print bare figures anyway. The parser scans for the
 * numeric shape rather than a currency prefix, so nothing is lost — and the
 * review screen supplies the symbol, which is what check-ocr asserts.
 */

import { chromium } from "playwright";

const OUT = process.argv[2] ?? "/tmp/claude-1000/test-invoice.png";

const HTML = `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    margin: 0; padding: 56px 64px; width: 900px; background: #fff; color: #111;
    font-size: 15px; line-height: 1.5;
  }
  .letterhead { font-size: 26px; font-weight: bold; letter-spacing: -0.3px; }
  .addr { color: #444; font-size: 13px; margin-top: 4px; }
  h1 { font-size: 20px; letter-spacing: 3px; margin: 36px 0 20px; font-weight: normal; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  .meta td { padding: 3px 0; font-size: 14px; }
  .meta td:first-child { color: #444; width: 170px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.items th {
    text-align: left; border-bottom: 2px solid #111; padding: 8px 6px; font-size: 13px;
  }
  table.items td { padding: 9px 6px; border-bottom: 1px solid #ccc; font-size: 14px; }
  .num { text-align: right; }
  .totals { width: 320px; margin-left: auto; margin-top: 18px; border-collapse: collapse; }
  .totals td { padding: 5px 6px; font-size: 14px; }
  .totals tr:last-child td { border-top: 2px solid #111; font-weight: bold; font-size: 16px; }
  .foot { margin-top: 40px; font-size: 12px; color: #555; border-top: 1px solid #ccc; padding-top: 12px; }
</style>

<div class="letterhead">Bayanihan Cloud Systems</div>
<div class="addr">Unit 18B, Ortigas Avenue Extension &middot; Taguig, Metro Manila 1630</div>
<div class="addr">ap@bayanihancloudsystems.com.ph &middot; (02) 8551 0142 &middot; TIN 214-885-037-000</div>

<h1>INVOICE</h1>

<table class="meta">
  <tr><td>Invoice Number:</td><td>BCS-2026-0184</td></tr>
  <tr><td>PO Number:</td><td>PO-48221</td></tr>
  <tr><td>Invoice Date:</td><td>14 March 2026</td></tr>
  <tr><td>Due Date:</td><td>13 April 2026</td></tr>
  <tr><td>Terms:</td><td>Net 30</td></tr>
</table>

<table class="items">
  <thead>
    <tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr>
  </thead>
  <tbody>
    <tr><td>Platform subscription — March</td><td class="num">1</td><td class="num">1,750,000.00</td><td class="num">1,750,000.00</td></tr>
    <tr><td>Additional user seats</td><td class="num">20</td><td class="num">26,500.00</td><td class="num">530,000.00</td></tr>
    <tr><td>Local data residency add-on</td><td class="num">1</td><td class="num">220,000.00</td><td class="num">220,000.00</td></tr>
  </tbody>
</table>

<table class="totals">
  <tr><td>Sub-total</td><td class="num">2,500,000.00</td></tr>
  <tr><td>VAT (12%)</td><td class="num">300,000.00</td></tr>
  <tr><td>Total Due</td><td class="num">2,800,000.00</td></tr>
</table>

<div class="foot">
  Remit to BDO Unibank, account ending 4417. Late payments accrue interest at 1.5% per month.
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.setContent(HTML, { waitUntil: "load" });
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();

console.log(`Wrote ${OUT}`);
console.log("Expected extraction:");
console.log("  invoiceNumber BCS-2026-0184 · poNumber PO-48221");
console.log("  issueDate 2026-03-14 · dueDate 2026-04-13");
console.log("  subtotal 2,500,000.00 · VAT 300,000.00 · total 2,800,000.00");
