import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { audit, renderReport, scan } from "../packages/core/dist/index.js";
import { createFileCheckpointStore } from "../packages/core/dist/node.js";

const pageCount = 50_000;
const directory = await mkdtemp(join(tmpdir(), "seo-audit-50k-"));
const checkpointPath = join(directory, "pages.ndjson");
const sitemap = `<?xml version="1.0"?><urlset>${Array.from(
  { length: pageCount - 1 },
  (_, index) => `<url><loc>https://example.com/page-${index}</loc></url>`,
).join("")}</urlset>`;
const fetch = async (input) => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) {
    return new Response("User-agent: *\nSitemap: https://example.com/sitemap.xml\n", { status: 200 });
  }
  if (url.endsWith("/sitemap.xml")) {
    return new Response(sitemap, { status: 200, headers: { "content-type": "application/xml" } });
  }
  const pathname = new URL(url).pathname;
  return new Response(
    `<!doctype html><html lang="en"><head><title>Page ${pathname}</title><meta name="description" content="A unique benchmark description for ${pathname}."><link rel="canonical" href="${url}"></head><body><h1>Page</h1><p>${"Useful benchmark content ".repeat(20)}</p></body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
};

const initialHeap = process.memoryUsage().heapUsed;
const started = performance.now();
let peakHeap = initialHeap;
const sampleMemory = () => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); };
const phaseMemory = {};
const recordPhase = (name) => {
  sampleMemory();
  const memory = process.memoryUsage();
  phaseMemory[name] = {
    heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024),
    rssMiB: Math.round(memory.rss / 1024 / 1024),
  };
};
const sampler = setInterval(sampleMemory, 10);
sampler.unref();
try {
  recordPhase("beforeCrawl");
  const crawlStarted = performance.now();
  const result = await scan(
    { url: "https://example.com/", maxPages: pageCount, concurrency: 10, delay: 0 },
    {
      fetch,
      checkpointStore: createFileCheckpointStore(checkpointPath),
      retainCheckpoint: true,
    },
  );
  recordPhase("afterCrawl");
  const crawlMs = Math.round(performance.now() - crawlStarted);
  const auditStarted = performance.now();
  const issues = audit(result.snapshot, { enabledRules: ["missing-twitter-metadata"] });
  recordPhase("afterAudit");
  const auditMs = Math.round(performance.now() - auditStarted);
  const reportStarted = performance.now();
  const report = renderReport({ startUrl: result.snapshot.siteUrl, pages: result.snapshot.pages, pageDetails: result.snapshot.pages, issues });
  recordPhase("afterReport");
  const reportMs = Math.round(performance.now() - reportStarted);
  const initialHeapMiB = Math.round(initialHeap / 1024 / 1024);
  const sampledPeakHeapMiB = Math.round(peakHeap / 1024 / 1024);
  const sampledPeakHeapGrowthMiB = Math.round((peakHeap - initialHeap) / 1024 / 1024);
  const peakRssMiB = Math.round(process.resourceUsage().maxRSS / 1024);
  const durationMs = Math.round(performance.now() - started);
  const checkpointBytes = (await stat(checkpointPath)).size;
  const summary = { pages: result.snapshot.pages.length, issues: issues.length, checkpointBytes, reportBytes: Buffer.byteLength(report), crawlMs, auditMs, reportMs, durationMs, initialHeapMiB, sampledPeakHeapMiB, sampledPeakHeapGrowthMiB, peakRssMiB, phaseMemory, samplingNote: "Heap is sampled every 10 ms plus phase boundaries; synchronous transient peaks may be missed. peakRssMiB comes from process.resourceUsage()." };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.pages !== pageCount) throw new Error(`50k benchmark scanned ${summary.pages} pages`);
  if (sampledPeakHeapMiB >= 900) throw new Error(`50k benchmark sampled ${sampledPeakHeapMiB} MiB absolute heap; expected less than 900 MiB`);
} finally {
  clearInterval(sampler);
  await rm(directory, { recursive: true, force: true });
}
