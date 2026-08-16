import test from "node:test";
import assert from "node:assert/strict";
import { migrateSnapshot } from "../packages/core/dist/index.js";

test("migrates a v1 baseline to deterministic SnapshotV2", () => {
  const legacy = {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    source: {
      startUrl: "https://example.com/",
      maxPages: 100,
      requestDelay: 100,
      includeQuery: false,
      respectRobots: true,
      sitemap: "https://example.com/sitemap.xml",
    },
    robots: {
      url: "https://example.com/robots.txt",
      status: 200,
      sha256: "abc",
      error: null,
    },
    sitemap: {
      url: "https://example.com/sitemap.xml",
      sitemapCount: 1,
      truncated: false,
    },
    truncated: false,
    pages: [{
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      contentType: "text/html",
      blockedByRobots: false,
      error: null,
      title: "Example",
      description: "Description",
      canonical: "https://example.com/",
      robots: null,
      lang: "en",
      h1Count: 1,
      openGraph: { title: null, description: null, image: null },
    }],
  };

  const migrated = migrateSnapshot(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.siteUrl, "https://example.com/");
  assert.equal(migrated.config.delay, 100);
  assert.equal(migrated.pages[0].xRobotsTag, null);
  assert.deepEqual(migrated.pages[0].internalLinks, []);
  assert.equal(migrated.statistics.completed, 1);
  assert.match(migrated.configurationHash, /^[a-f0-9]{64}$/);
});
