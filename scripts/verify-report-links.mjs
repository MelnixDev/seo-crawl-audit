import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { migrateSnapshot, renderReport } from "../packages/core/dist/index.js";

const directory = await mkdtemp(join(tmpdir(), "seo-links-browser-"));
let browser;
try {
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [
    { url: "https://example.com/", status: 200, internalLinks: ["https://example.com/products/1", "https://example.com/old", "https://example.com/unknown"] },
    { url: "https://example.com/products/1", status: 404, depth: 4 },
    { url: "https://example.com/products/2", status: 200, depth: 2 },
    { url: "https://example.com/old", status: 200, finalUrl: "https://example.com/new" },
  ] });
  const reportPath = join(directory, "report.html");
  await writeFile(reportPath, renderReport({ pages: snapshot.pages, pageDetails: snapshot.pages, partial: true }));
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(reportPath).href);
  await page.click('[data-view="pages"]');
  await page.selectOption("#page-architecture", "broken");
  assert.equal(await page.locator("#pages-body tr").count(), 1);
  await page.click("#pages-body .page-url-button");
  const broken = page.locator(".detail-section").filter({ has: page.locator("h3", { hasText: "Links to errors" }) });
  assert.equal(await broken.locator("li").count(), 1);
  await broken.locator("button.page-url-button").click();
  assert.match(await page.locator("#page-dialog-content").innerText(), /404/);
  const incoming = page.locator(".detail-section").filter({ has: page.locator("h3", { hasText: "Observed inlinks" }) });
  assert.equal(await incoming.locator("li").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#pages-body .page-url-button").evaluate((element) => element === document.activeElement), true);
  await page.selectOption("#page-architecture", "redirects");
  assert.equal(await page.locator("#pages-body tr").count(), 1);
  await page.selectOption("#page-architecture", "deep");
  assert.match(await page.locator("#pages-body").innerText(), /products\/1/);
  await page.selectOption("#page-architecture", "zero");
  assert.equal(await page.locator("#pages-body tr").count(), 2);
  await page.selectOption("#page-architecture", "");
  await page.fill("#page-template-filter", "/products/:id");
  await page.waitForFunction(() => document.querySelectorAll("#pages-body tr").length === 2);
  await page.selectOption("#language", "uk");
  assert.equal(await page.locator("#page-th-incoming").textContent(), "Виявлені вхідні посилання");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-pages-csv");
  const download = await downloadPromise;
  let csv = "";
  for await (const chunk of await download.createReadStream()) csv += chunk.toString();
  assert.equal(csv.split("\n").length, 3);
  assert.match(csv, /Виявлені вхідні посилання/);
  assert.match(csv, /products\/:id/);
  assert.deepEqual(errors, []);
  console.log("Observed sources, target navigation, filters, templates, EN/UK, focus and CSV passed.");
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
