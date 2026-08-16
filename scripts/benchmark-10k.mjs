import { performance } from "node:perf_hooks";
import { audit } from "../packages/core/dist/index.js";
import { createBaseline } from "../packages/core/dist/baseline.js";

const pages = Array.from({ length: 10_000 }, (_, index) => ({
  url: `https://example.com/page-${index}`,
  finalUrl: `https://example.com/page-${index}`,
  status: 200,
  title: `Unique title ${index}`,
  description: `A unique description with enough detail for page ${index} and a repeatable local benchmark.`,
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
const issues = audit(snapshot, { enabledRules: ["page-unreachable"] });
console.log(JSON.stringify({
  pages: snapshot.pages.length,
  issues: issues.length,
  durationMs: Math.round(performance.now() - started),
  heapMiB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
}, null, 2));
