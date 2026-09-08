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
try {
  const result = await scan(
    { url: "https://example.com/", maxPages: pageCount, concurrency: 10, delay: 0 },
    {
      fetch,
      checkpointStore: createFileCheckpointStore(checkpointPath),
      retainCheckpoint: true,
    },
  );
  const issues = audit(result.snapshot, { enabledRules: ["missing-twitter-metadata"] });
  const report = renderReport({ startUrl: result.snapshot.siteUrl, pages: result.snapshot.pages, issues });
  const heapGrowthMiB = Math.round((process.memoryUsage().heapUsed - initialHeap) / 1024 / 1024);
  const durationMs = Math.round(performance.now() - started);
  const checkpointBytes = (await stat(checkpointPath)).size;
  const summary = { pages: result.snapshot.pages.length, issues: issues.length, checkpointBytes, reportBytes: Buffer.byteLength(report), durationMs, heapGrowthMiB };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.pages !== pageCount) throw new Error(`50k benchmark scanned ${summary.pages} pages`);
  if (heapGrowthMiB >= 900) throw new Error(`50k benchmark used ${heapGrowthMiB} MiB; expected less than 900 MiB`);
  if (durationMs >= 30_000) throw new Error(`50k benchmark took ${durationMs} ms; expected less than 30000 ms`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
