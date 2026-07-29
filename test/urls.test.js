import test from "node:test";
import assert from "node:assert/strict";
import {
  isCrawlableUrl,
  isSameOrigin,
  normalizeUrl,
} from "../src/urls.js";

test("normalizes links and strips query strings by default", () => {
  assert.equal(
    normalizeUrl("/docs/?utm_source=test#intro", "https://example.com/base"),
    "https://example.com/docs",
  );
});

test("keeps query strings when requested", () => {
  assert.equal(
    normalizeUrl("/search?q=seo#top", "https://example.com", {
      includeQuery: true,
    }),
    "https://example.com/search?q=seo",
  );
});

test("filters unsupported protocols and crawlable assets", () => {
  assert.equal(normalizeUrl("mailto:hi@example.com"), null);
  assert.equal(isCrawlableUrl("https://example.com/report.pdf"), false);
  assert.equal(isCrawlableUrl("https://example.com/about"), true);
  assert.equal(
    isSameOrigin("https://example.com/about", "https://example.com"),
    true,
  );
});
