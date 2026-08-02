import test from "node:test";
import assert from "node:assert/strict";
import { renderHtmlReport } from "../src/html-report.js";

test("renders a self-contained filterable report and escapes embedded data", () => {
  const html = renderHtmlReport({
    mode: "scan",
    startUrl: "https://example.com/",
    generatedAt: "2026-07-30T00:00:00.000Z",
    pages: [{ url: "https://example.com/" }],
    issues: [
      {
        severity: "warning",
        rule: "missing-description",
        url: "https://example.com/?value=</script><script>alert(1)</script>",
        message: "Missing description",
        before: undefined,
        after: null,
      },
    ],
  });

  assert.match(html, /id="search"/);
  assert.match(html, /id="severity"/);
  assert.match(html, /id="rule"/);
  assert.match(html, /id="page-size"/);
  assert.match(html, /id="previous"/);
  assert.match(html, /id="next"/);
  assert.match(html, /id="clear-filters"/);
  assert.match(html, /No SEO issues found/);
  assert.match(html, /No matching issues/);
  assert.match(html, /report\.issues\.length === 1 \? "issue" : "issues"/);
  assert.match(html, /SEO baseline audit/);
  assert.doesNotMatch(
    html,
    /<\/script><script>alert\(1\)<\/script>/,
  );
  assert.match(html, /\\u003c\/script\\u003e/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("marks an in-progress scan as partial and shows its target", () => {
  const html = renderHtmlReport({
    mode: "scan",
    startUrl: "https://example.com/",
    generatedAt: "2026-07-30T00:00:00.000Z",
    pages: [{ url: "https://example.com/" }],
    issues: [],
    partial: true,
    targetPages: 100,
  });

  assert.match(html, /Partial SEO scan report/);
  assert.match(html, /Partial results/);
  assert.match(html, /1 \/ 100/);
  assert.match(html, /Run the same scan command again to resume/);
  assert.match(html, /What was found/);
  assert.doesNotMatch(html, /<th>Before<\/th>/);
});
