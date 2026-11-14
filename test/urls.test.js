import test from "node:test";
import assert from "node:assert/strict";
import {
  isCrawlableUrl,
  isSameOrigin,
  normalizeUrl,
} from "../packages/core/dist/urls.js";

test("normalizes links and strips query strings by default", () => {
  assert.equal(
    normalizeUrl("/docs/?utm_source=test#intro", "https://example.com/base"),
    "https://example.com/docs/",
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

test("trailing slash stripping is an explicit compatibility policy", () => {
  assert.equal(normalizeUrl("/docs/?page=2#section", "https://example.com", { includeQuery: true, trailingSlash: "strip" }), "https://example.com/docs?page=2");
  assert.equal(normalizeUrl("https://example.com///", undefined, { trailingSlash: "strip" }), "https://example.com/");
  assert.equal(normalizeUrl("https://example.com/docs///", undefined, { trailingSlash: "preserve" }), "https://example.com/docs///");
});

test('preserves encoded path separators rather than collapsing resources',()=>{
 assert.equal(normalizeUrl('https://example.com/a%2Fb/'),'https://example.com/a%2Fb/');
 assert.equal(normalizeUrl('https://example.com/a%2Fb/',undefined,{trailingSlash:'strip'}),'https://example.com/a%2Fb');
});
