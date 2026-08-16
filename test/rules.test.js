import test from "node:test";
import assert from "node:assert/strict";
import { audit, createBaseline } from "../packages/core/dist/index.js";

test("site and page rules use normalized crawl evidence", () => {
  const snapshot = createBaseline({
    startUrl: "https://example.com/",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
    sitemap: {
      url: "https://example.com/sitemap.xml",
      urls: ["https://example.com/", "https://example.com/broken"],
      sitemapCount: 1,
      truncated: false,
    },
    options: { maxPages: 3 },
    pages: [
      {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        title: "Shared example title",
        description: "A shared description that is deliberately long enough for the normal range in this fixture.",
        canonical: "https://example.com/broken",
        h1Count: 1,
        lang: "not_a_language",
        wordCount: 300,
        contentHash: "same-content",
        internalLinks: ["https://example.com/broken"],
        jsonLd: [{ valid: false, error: "Unexpected token" }],
        openGraph: { title: "Title", description: "Description", image: "https://example.com/image.jpg" },
        twitter: { card: "summary", title: "Title", description: "Description", image: "https://example.com/image.jpg" },
      },
      {
        url: "https://example.com/other",
        finalUrl: "https://example.com/other",
        status: 200,
        title: "Shared example title",
        description: "A shared description that is deliberately long enough for the normal range in this fixture.",
        canonical: null,
        canonicalRaw: "http://[invalid",
        h1Count: 1,
        wordCount: 300,
        contentHash: "same-content",
      },
      {
        url: "https://example.com/broken",
        finalUrl: "https://example.com/broken",
        status: 500,
        title: "Broken destination",
        description: "A valid description for a broken destination page that still has parsed HTML metadata.",
        canonical: "https://example.com/broken",
        h1Count: 1,
        xRobotsTag: "noindex",
        wordCount: 300,
      },
    ],
  });
  const issues = audit(snapshot, {
    enabledRules: [
      "broken-internal-link",
      "canonical-target-error",
      "duplicate-title",
      "duplicate-description",
      "duplicate-content",
      "invalid-canonical",
      "invalid-language",
      "malformed-json-ld",
      "http-error",
      "x-robots-noindex",
      "noindex-in-sitemap",
    ],
  });
  const rules = new Set(issues.map((issue) => issue.ruleId));

  for (const expected of [
    "broken-internal-link",
    "canonical-target-error",
    "duplicate-title",
    "duplicate-description",
    "duplicate-content",
    "invalid-canonical",
    "invalid-language",
    "malformed-json-ld",
    "http-error",
    "x-robots-noindex",
    "noindex-in-sitemap",
  ]) assert.equal(rules.has(expected), true, expected);
  assert.equal(issues.every((issue) => issue.owner && issue.remediation && issue.documentationUrl && issue.fingerprint), true);
});

test("configured sitemap failures become a site-level issue", () => {
  const snapshot = createBaseline({
    startUrl: "https://example.com/",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
    sitemap: { url: "https://example.com/sitemap.xml", urls: [], sitemapCount: 0, truncated: false, error: "HTTP 503" },
    options: { maxPages: 1 },
    pages: [],
  });
  const [issue] = audit(snapshot, { enabledRules: ["sitemap-unavailable"] });
  assert.equal(issue.scope, "site");
  assert.equal(issue.severity, "error");
});
