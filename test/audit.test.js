import test from "node:test";
import assert from "node:assert/strict";
import { auditBaseline } from "../src/audit.js";

test("turns current SEO problems into filterable audit issues", () => {
  const issues = auditBaseline({
    pages: [
      {
        url: "https://example.com/",
        status: 200,
        blockedByRobots: false,
        error: null,
        title: null,
        description: null,
        canonical: null,
        h1Count: 0,
        robots: "noindex,follow",
      },
    ],
  });

  assert.deepEqual(
    issues.map((issue) => [issue.severity, issue.rule]),
    [
      ["error", "missing-title"],
      ["warning", "missing-canonical"],
      ["warning", "missing-description"],
      ["warning", "missing-h1"],
      ["info", "noindex"],
    ],
  );
});
