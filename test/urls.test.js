import test from "node:test";
import assert from "node:assert/strict";
import {
  isCrawlableUrl,
  isSameOrigin,
  normalizeUrl,
} from "../packages/core/dist/urls.js";

test("normalizes links, strips query strings by default, and preserves trailing slashes", () => {
  assert.equal(
    normalizeUrl("/docs/?utm_source=test#intro", "https://example.com/base"),
    "https://example.com/docs/",
  );
});

test("preserves a meaningful trailing slash by default", () => {
  assert.equal(
    normalizeUrl("https://example.com/docs/"),
    "https://example.com/docs/",
  );
  assert.equal(
    normalizeUrl("https://example.com/docs"),
    "https://example.com/docs",
  );
});

test("strips trailing slashes when configured", () => {
  assert.equal(
    normalizeUrl("https://example.com/docs/", undefined, { trailingSlash: "strip" }),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeUrl("/docs/?utm_source=test#intro", "https://example.com/base", { trailingSlash: "strip" }),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeUrl("https://example.com/", undefined, { trailingSlash: "strip" }),
    "https://example.com/",
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
