import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createLocalUiServer } from "../packages/cli/dist/server.js";
import { migrateSnapshot } from "../packages/core/dist/index.js";
import { writeHistorySnapshot } from "../packages/core/dist/node.js";

const directory = await mkdtemp(join(tmpdir(), "seo-comparison-browser-"));
let server;
let browser;
try {
  const history = join(directory, ".seo-audit/history");
  for (const [date, title] of [["2026-09-01T00:00:00.000Z", null], ["2026-09-27T00:00:00.000Z", "A clear page title"]]) {
    const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", generatedAt: date, pages: [{ url: "https://example.com/", status: 200, contentType: "text/html", title, h1Count: 1 }] });
    await writeHistorySnapshot(history, snapshot);
  }
  server = await createLocalUiServer({ directory, port: 0 });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => document.querySelectorAll("#historyBefore option").length === 2);
  await page.waitForFunction(() => document.querySelectorAll(".trend-chart circle").length === 2);
  assert.match(await page.locator(".trend-panel h3").textContent(), /Local issue trends/);
  assert.equal(await page.locator("#historyAfter option").count(), 2);
  await page.locator("#historyCompare").click();
  await page.locator("#historyOpen:visible").waitFor({ timeout: 15_000 });
  await page.locator("#historyFrame:visible").waitFor();
  assert.match(await page.locator("#historyStatus").textContent(), /Comparison ready/);
  await page.locator("#historyLanguage").selectOption("uk");
  assert.equal(await page.locator("#historyTitle").textContent(), "Історія");
  assert.equal(await page.locator("#historyCompare").textContent(), "Порівняти");
  assert.equal(await page.locator(".trend-panel h3").textContent(), "Локальні тренди проблем");
  const report = await page.request.get(new URL("/comparison", server.url).href);
  assert.match(await report.text(), /Порівняння локальних запусків/);
  assert.deepEqual(errors, []);
  console.log("Local comparison and trends browser QA passed (EN/UK, chart, picker, worker, report, no page errors).");
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
