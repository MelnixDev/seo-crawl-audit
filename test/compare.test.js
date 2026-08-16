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
