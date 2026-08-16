import test from "node:test";
import assert from "node:assert/strict";
import { audit, createBaseline } from "../packages/core/dist/index.js";

test("normalizes and audits a 10k-page snapshot within a bounded memory envelope", { timeout: 30_000 }, () => {
  const before = process.memoryUsage().heapUsed;
  const pages = Array.from({ length: 10_000 }, (_, index) => ({
    url: `https://example.com/page-${String(10_000 - index).padStart(5, "0")}`,
    finalUrl: `https://example.com/page-${String(10_000 - index).padStart(5, "0")}`,
    status: 200,
    contentType: "text/html",
    title: `Useful unique page title ${index}`,
    description: `A sufficiently detailed and unique description for performance fixture page ${index}, with useful context.`,
    canonical: `https://example.com/page-${String(10_000 - index).padStart(5, "0")}`,
    h1Count: 1,
    lang: "en",
    wordCount: 300,
    contentHash: `content-${index}`,
    openGraph: { title: "Title", description: "Description", image: "https://example.com/image.jpg" },
    twitter: { card: "summary", title: "Title", description: "Description", image: "https://example.com/image.jpg" },
  }));
  const snapshot = createBaseline({
    startUrl: "https://example.com/",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
    options: { maxPages: 10_000 },
    pages,
  });
  const issues = audit(snapshot, { enabledRules: ["page-unreachable"] });
  const memoryDelta = process.memoryUsage().heapUsed - before;

  assert.equal(snapshot.pages.length, 10_000);
  assert.equal(snapshot.pages[0].url, "https://example.com/page-00001");
  assert.equal(issues.length, 0);
  assert.ok(memoryDelta < 300 * 1024 * 1024, `heap grew by ${Math.round(memoryDelta / 1024 / 1024)} MiB`);
});
