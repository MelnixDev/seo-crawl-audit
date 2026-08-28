import test from "node:test";
import assert from "node:assert/strict";
import { groupIssuesByTemplate } from "../packages/core/dist/index.js";

function issue(url, ruleId, severity = "warning") {
  return {
    fingerprint: `${ruleId}-${url}`,
    ruleId,
    rule: ruleId,
    severity,
    scope: "page",
    url,
    message: ruleId,
    evidence: {},
    owner: "developer",
    remediation: "Fix",
    documentationUrl: "https://example.com/docs",
  };
}

test("groups repeated findings by deterministic URL templates", () => {
  const groups = groupIssuesByTemplate([
    issue("https://example.com/products/red-shoe", "missing-title", "error"),
    issue("https://example.com/products/blue-shirt", "missing-title", "error"),
    issue("https://example.com/products/blue-shirt", "missing-description"),
    issue("https://example.com/orders/123", "missing-h1"),
    issue("https://example.com/orders/456", "missing-h1"),
  ]);
  assert.deepEqual(groups.map(({ template, issueCount, affectedPages }) => ({ template, issueCount, affectedPages })), [
    { template: "/products/:slug", issueCount: 3, affectedPages: 2 },
    { template: "/orders/:id", issueCount: 2, affectedPages: 2 },
  ]);
  assert.deepEqual(groups[0].severities, { error: 2, warning: 1, info: 0 });
  assert.deepEqual(groups[0].representativeUrls, [
    "https://example.com/products/blue-shirt",
    "https://example.com/products/red-shoe",
  ]);
});

test("keeps unrelated top-level routes distinct and ignores invalid URLs", () => {
  const groups = groupIssuesByTemplate([
    issue("https://example.com/about", "missing-title"),
    issue("https://example.com/contact", "missing-title"),
    issue("not-a-url", "missing-title"),
  ]);
  assert.deepEqual(groups.map((group) => group.template), ["/about", "/contact"]);
});
