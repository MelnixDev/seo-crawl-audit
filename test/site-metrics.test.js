import test from "node:test";
import assert from "node:assert/strict";
import { buildSiteMetrics, migrateSnapshot } from "../packages/core/dist/index.js";

test("builds deterministic local site metrics from a snapshot", () => {
  const snapshot = migrateSnapshot({
    schemaVersion: 1,
    generatedAt: "2026-09-05T10:00:00.000Z",
    startUrl: "https://example.com/",
    durationMs: 400,
    sitemap: { url: "https://example.com/sitemap.xml", urls: ["https://example.com/", "https://example.com/product"], sitemapCount: 1, truncated: false },
    pages: [
      {
        url: "https://example.com/", finalUrl: "https://example.com/", status: 200, contentType: "text/html", depth: 0, responseBytes: 1_024,
        internalLinks: ["https://example.com/product"], externalLinks: ["https://outside.example/"], images: [{ src: "https://example.com/image.jpg", alt: "Image" }],
      },
      {
        url: "https://example.com/product", finalUrl: "https://example.com/product", status: 200, contentType: "text/html", depth: 1, responseBytes: 2_048,
        robots: "noindex", images: [{ src: "https://example.com/image.jpg", alt: "Image" }], jsonLd: [{ valid: true, value: { "@type": "Product", name: "Example" } }],
      },
    ],
  });
  const metrics = buildSiteMetrics(snapshot);
  const values = Object.fromEntries(metrics.metrics.map((metric) => [metric.id, metric.value]));
  assert.equal(metrics.schemaVersion, 1);
  assert.equal(values["pages.sitemap"], 2);
  assert.equal(values["pages.indexable"], 1);
  assert.equal(values["pages.noindex"], 1);
  assert.equal(values["assets.images"], 1);
  assert.equal(values["commerce.products"], 1);
  assert.equal(values["crawl.max-depth"], 1);
  assert.equal(values["crawl.transfer"], 3_072);
  assert.equal(values["crawl.average-time"], 200);
});
