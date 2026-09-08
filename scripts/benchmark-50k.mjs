import { performance } from "node:perf_hooks";
import { audit, renderReport } from "../packages/core/dist/index.js";
import { createBaseline } from "../packages/core/dist/baseline.js";

const initialHeap = process.memoryUsage().heapUsed;
const pages = Array.from({ length: 50_000 }, (_, index) => ({
  url: `https://example.com/page-${index}`,
  finalUrl: `https://example.com/page-${index}`,
  status: 200,
  contentType: "text/html",
  title: null,
  description: `Unique description ${index}`,
  canonical: `https://example.com/page-${index}`,
  h1Count: 1,
  lang: "en",
  wordCount: 300,
  contentHash: `content-${index}`,
  openGraph: { title: "Title", description: "Description", image: "https://example.com/image.jpg" },
  twitter: { card: "summary", title: "Title", description: "Description", image: "https://example.com/image.jpg" },
}));
const started = performance.now();
const snapshot = createBaseline({
  startUrl: "https://example.com/",
  robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
  options: { maxPages: pages.length },
  pages,
});
const issues = audit(snapshot, { enabledRules: ["missing-title"] });
const report = renderReport({ startUrl: snapshot.siteUrl, pages: snapshot.pages, issues });
const heapGrowthMiB = Math.round((process.memoryUsage().heapUsed - initialHeap) / 1024 / 1024);
const durationMs = Math.round(performance.now() - started);
const result = { pages: pages.length, issues: issues.length, reportBytes: Buffer.byteLength(report), durationMs, heapGrowthMiB };
console.log(JSON.stringify(result, null, 2));
if (heapGrowthMiB >= 900) throw new Error(`50k benchmark used ${heapGrowthMiB} MiB; expected less than 900 MiB`);
if (durationMs >= 30_000) throw new Error(`50k benchmark took ${durationMs} ms; expected less than 30000 ms`);
