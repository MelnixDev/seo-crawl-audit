import test from "node:test";
import assert from "node:assert/strict";
import { compareBaselines } from "../packages/core/dist/index.js";

function snapshot(page) {
  return {
    robots: {
      url: "https://example.com/robots.txt",
      status: 200,
      sha256: "same",
    },
    pages: [page],
  };
}

test("detects blocking SEO regressions", () => {
  const before = snapshot({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    blockedByRobots: false,
    error: null,
    title: "Original",
    description: "Description",
    canonical: "https://example.com/",
    robots: "index,follow",
    h1Count: 1,
  });
  const after = snapshot({
    ...before.pages[0],
    title: null,
    robots: "noindex,follow",
    canonical: null,
  });

  const rules = compareBaselines(before, after).map((issue) => issue.rule);
  assert.deepEqual(rules, [
    "canonical-removed",
    "new-noindex",
    "title-removed",
  ]);
});

test("reports metadata edits as warnings", () => {
  const before = snapshot({
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    blockedByRobots: false,
    error: null,
    title: "Original",
    description: "Description",
    canonical: null,
    robots: null,
    h1Count: 1,
  });
  const after = snapshot({
    ...before.pages[0],
    title: "Updated",
    description: null,
    h1Count: 0,
  });

  const issues = compareBaselines(before, after);
  assert.equal(issues.every((issue) => issue.severity === "warning"), true);
  assert.deepEqual(
    issues.map((issue) => issue.rule),
    ["description-removed", "h1-removed", "title-changed"],
  );
});

test("applies rule selection, severity overrides, and suppressions to regressions", () => {
  const page = {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    blockedByRobots: false,
    error: null,
    title: "Original title",
    description: "Description",
    canonical: "https://example.com/",
    robots: null,
    h1Count: 1,
  };
  const baseline = snapshot(page);
  const current = snapshot({ ...page, title: "Changed title" });

  const selected = compareBaselines(baseline, current, {
    enabledRules: ["title-changed"],
    severityOverrides: { "title-changed": "error" },
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].ruleId, "title-changed");
  assert.equal(selected[0].severity, "error");

  const suppressed = compareBaselines(baseline, current, {
    suppressions: [{
      rule: "title-changed",
      urlPattern: "/**",
      reason: "Expected content update",
      expiresAt: "2027-01-01",
    }],
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.deepEqual(suppressed, []);
});
