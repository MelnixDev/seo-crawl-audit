import { performance } from "node:perf_hooks";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildLocalComparison, migrateSnapshot, renderReport } from "../packages/core/dist/index.js";

const count = Number(process.argv.find((value, index) => index > 1 && !value.startsWith("--")) ?? 50_000);
const browserMode = process.argv.includes("--browser");
if (!Number.isSafeInteger(count) || count < 1 || count > 50_000) throw new Error("page count must be 1–50,000");

let peakHeap = process.memoryUsage().heapUsed;
let peakRss = process.memoryUsage().rss;
const sample = () => {
  const memory = process.memoryUsage();
  peakHeap = Math.max(peakHeap, memory.heapUsed);
  peakRss = Math.max(peakRss, memory.rss);
};
const interval = setInterval(sample, 20);
const started = performance.now();
const pages = Array.from({ length: count }, (_, index) => ({
  url: `https://example.com/page/${index}/`, status: 200, contentType: "text/html",
  title: `Example page number ${index}`, description: `A useful description for example page number ${index}, with enough words to avoid short descriptions.`,
  h1Count: 1, wordCount: 150, canonical: `https://example.com/page/${index}/`,
}));
const before = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", generatedAt: "2026-09-01T00:00:00.000Z", pages });
const after = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", generatedAt: "2026-09-27T00:00:00.000Z", pages: pages.map((page, index) => index % 10 === 0 ? { ...page, title: null } : page) });
sample();
const normalizedMs = performance.now() - started;
const { diff, summary } = buildLocalComparison(before, after, { evaluatedAt: "2026-09-27T00:00:00.000Z" });
sample();
const comparedMs = performance.now() - started - normalizedMs;
const html = renderReport({ mode: "check", startUrl: after.siteUrl, pages: after.pages,
  ...(after.pages.length <= 5_000 ? { pageDetails: after.pages } : {}),
  issues: diff.newIssues, newIssues: diff.newIssues, ongoingIssues: diff.ongoingIssues,
  resolvedIssues: diff.resolvedIssues, unchangedIssues: diff.unchangedIssues,
  comparison: { kind: "local", summary } });
sample();
const renderedMs = performance.now() - started - normalizedMs - comparedMs;
clearInterval(interval);
const mib = (bytes) => Math.round(bytes / 1024 / 1024);
console.log(JSON.stringify({ pagesPerRun: count, newIssues: summary.lifecycle.new, unverified: summary.unverified.length,
  normalizedMs: Math.round(normalizedMs), comparedMs: Math.round(comparedMs), renderedMs: Math.round(renderedMs),
  htmlMiB: mib(Buffer.byteLength(html)), sampledPeakHeapMiB: mib(peakHeap), sampledPeakRssMiB: mib(peakRss) }, null, 2));
if (mib(peakHeap) >= 900 || mib(Buffer.byteLength(html)) > 100) process.exitCode = 1;

if (browserMode) {
  const { chromium } = await import("playwright");
  const directory = await mkdtemp(join(tmpdir(), "seo-comparison-browser-"));
  let browser;
  try {
    const reportPath = join(directory, "comparison.html");
    await writeFile(reportPath, html, "utf8");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ acceptDownloads: true });
    const loadStarted = performance.now();
    await page.goto(pathToFileURL(reportPath).href, { waitUntil: "load", timeout: 120_000 });
    const loadMs = Math.round(performance.now() - loadStarted);
    await page.click('[data-view="issues"]');
    const interaction = await page.evaluate(() => {
      const search = document.querySelector("#search");
      search.value = "page/49990/";
      const started = performance.now();
      render();
      return { filterMs: Math.round(performance.now() - started), issueRows: document.querySelectorAll("#issues tr").length };
    });
    await page.selectOption("#language", "uk");
    await page.click('[data-view="pages"]');
    const detail = await page.evaluate(() => {
      const search = document.querySelector("#page-search");
      search.value = "page/49990/";
      renderPages();
      const started = performance.now();
      document.querySelector("#pages-body .page-url-button").click();
      return { detailMs: Math.round(performance.now() - started), open: !document.querySelector("#page-dialog").hidden };
    });
    console.log(JSON.stringify({ browser: await browser.version(), platform: `${process.platform}-${process.arch}`, node: process.version, loadMs, ...interaction, ...detail }, null, 2));
    if (interaction.filterMs >= 500 || detail.detailMs >= 200 || !detail.open || interaction.issueRows < 1) process.exitCode = 1;
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
