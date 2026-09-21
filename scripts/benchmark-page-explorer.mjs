import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { migrateSnapshot, renderReport } from "../packages/core/dist/index.js";

const count = 50_000;
const directory = await mkdtemp(join(tmpdir(), "seo-page-explorer-"));
const reportPath = join(directory, "report.html");
const pages = Array.from({ length: count }, (_, index) => ({
  url: `https://example.com/page-${String(index).padStart(5, "0")}`,
  status: 200,
  title: index === count - 1 ? "=Benchmark formula title" : `Benchmark page ${index}`,
  description: `Benchmark description ${index}`,
  canonical: `https://example.com/page-${String(index).padStart(5, "0")}`,
  h1Count: 1,
  lang: "en",
  wordCount: 200,
  depth: index % 8,
  responseBytes: 2_048 + index,
  internalLinks: [`https://example.com/page-${String((index + 1) % count).padStart(5, "0")}`],
}));
const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages });
const issues = snapshot.pages.map((page, index) => ({
  fingerprint: `benchmark-${index}`,
  ruleId: "missing-twitter-metadata",
  rule: "Missing Twitter metadata",
  severity: "info",
  scope: "page",
  owner: "content",
  url: page.url,
  message: "Twitter metadata is missing",
  evidence: {},
  remediation: "Add Twitter metadata when social previews matter.",
  documentationUrl: "https://example.com/docs",
}));

let browser;
try {
  await writeFile(reportPath, renderReport({ pages: snapshot.pages, pageDetails: snapshot.pages, issues }), "utf8");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const loadStarted = performance.now();
  await page.goto(pathToFileURL(reportPath).href, { waitUntil: "load", timeout: 60_000 });
  const loadMs = Math.round(performance.now() - loadStarted);
  await page.click('[data-view="pages"]');
  const interaction = await page.evaluate(() => {
    const input = document.querySelector("#page-search");
    input.value = "Benchmark page 1";
    const filterStarted = performance.now();
    renderPages();
    const filterMs = performance.now() - filterStarted;
    const matchedRows = document.querySelectorAll("#pages-body tr").length;
    document.querySelector('[data-page-sort="depth"]').click();
    document.querySelector("#page-next").click();
    const paginatedRows = document.querySelectorAll("#pages-body tr").length;
    input.value = "page-49999";
    renderPages();
    const trigger = document.querySelector("#pages-body .page-url-button");
    const detailStarted = performance.now();
    trigger.click();
    const detailMs = performance.now() - detailStarted;
    return {
      filterMs: Math.round(filterMs),
      detailMs: Math.round(detailMs),
      matchedRows,
      paginatedRows,
      renderedRows: document.querySelectorAll("#pages-body tr").length,
      dialogOpen: !document.querySelector("#page-dialog").hidden,
      detailHasRemediation: document.querySelector("#page-dialog-content").textContent.includes("Add Twitter metadata"),
    };
  });
  await page.keyboard.press("Escape");
  const focusReturned = await page.evaluate(() => document.activeElement?.classList.contains("page-url-button"));
  await page.click("#pages-body .issue-pill.info");
  const exactIssueNavigation = await page.evaluate(() => ({
    visibleView: !document.querySelector("#issues-view").hidden,
    count: document.querySelectorAll("#issues tr").length,
    urls: [...document.querySelectorAll("#issues tr td:nth-child(4)")].map((cell) => cell.textContent),
  }));
  await page.selectOption("#language", "uk");
  const localized = await page.evaluate(() => ({
    pageTitle: document.querySelector("#page-th-title").textContent,
    pageIssues: document.querySelector("#page-th-issues").textContent,
  }));
  await page.click('[data-view="pages"]');
  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-pages-csv");
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString("utf8");
  const summary = { browser: await browser.version(), platform: `${process.platform}-${process.arch}`, node: process.version, pages: count, issues: count, loadMs, ...interaction };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.matchedRows !== 100 || summary.paginatedRows !== 100 || summary.renderedRows !== 1) throw new Error("Page Explorer rendered rows outside the active pagination/filter window");
  if (!summary.dialogOpen) throw new Error("Page Explorer details did not open");
  if (!summary.detailHasRemediation) throw new Error("Page Explorer details omitted issue remediation");
  if (!focusReturned) throw new Error("Page Explorer did not restore focus after closing details");
  if (!exactIssueNavigation.visibleView || exactIssueNavigation.count !== 1 || exactIssueNavigation.urls[0] !== "https://example.com/page-49999") throw new Error("Pages to Issues navigation was not exact");
  if (localized.pageTitle !== "Заголовок" || localized.pageIssues !== "Проблеми") throw new Error("Page Explorer headers were not localized");
  if (!csv.startsWith("\uFEFF") || !csv.includes("\n") || csv.includes("\\n")) throw new Error("Page Explorer CSV encoding or newlines are invalid");
  if (!csv.includes("\"'=Benchmark formula title\"")) throw new Error("Page Explorer CSV did not protect a formula-like value");
  if (summary.filterMs > 500) throw new Error(`Page Explorer filtering took ${summary.filterMs} ms`);
  if (summary.detailMs > 200) throw new Error(`Page Explorer details took ${summary.detailMs} ms`);
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
