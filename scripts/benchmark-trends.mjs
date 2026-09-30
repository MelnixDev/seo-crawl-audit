import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { migrateSnapshot } from "../packages/core/dist/index.js";
import { calculateTrendSummary, writeHistorySnapshot } from "../packages/core/dist/node.js";

const runs = Number(process.argv[2] ?? 100);
const pages = Number(process.argv[3] ?? 1000);
if (!Number.isInteger(runs) || runs < 1 || runs > 100 || !Number.isInteger(pages) || pages < 1 || pages > 50_000) {
  throw new Error("usage: node scripts/benchmark-trends.mjs [runs 1..100] [pages 1..50000]");
}
const directory = await mkdtemp(join(tmpdir(), "seo-trend-benchmark-"));
try {
  for (let run = 0; run < runs; run++) {
    const generatedAt = new Date(Date.UTC(2026, 0, 1 + run)).toISOString();
    const snapshot = migrateSnapshot({ schemaVersion: 1, generatedAt, startUrl: "https://example.com/",
      pages: Array.from({ length: pages }, (_, index) => ({ url: `https://example.com/item/${index}/`, status: 200,
        contentType: "text/html", title: run % 2 ? `Product ${index}` : null, h1Count: 1 })) });
    await writeHistorySnapshot(directory, snapshot);
  }
  let heap = process.memoryUsage().heapUsed;
  let rss = process.memoryUsage().rss;
  const start = performance.now();
  const timer = setInterval(() => { const sample = process.memoryUsage(); heap = Math.max(heap, sample.heapUsed); rss = Math.max(rss, sample.rss); }, 10);
  try {
    const result = await calculateTrendSummary(directory, { limit: runs <= 20 ? 20 : runs <= 50 ? 50 : 100 });
    const mib = (bytes) => Number((bytes / 1024 / 1024).toFixed(1));
    console.log(JSON.stringify({ runs, pagesPerRun: pages, points: result.points.length,
      elapsedMs: Math.round(performance.now() - start), sampledPeakHeapMiB: mib(heap), sampledPeakRssMiB: mib(rss),
      node: process.version, platform: process.platform, note: "sampling may miss synchronous peaks" }, null, 2));
  } finally { clearInterval(timer); }
} finally { await rm(directory, { recursive: true, force: true }); }
