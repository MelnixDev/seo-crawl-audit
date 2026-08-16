import test from "node:test";
import assert from "node:assert/strict";
import { auditBaseline, createBaseline, diff } from "../packages/core/dist/index.js";

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
  }, {
    enabledRules: [
      "missing-title",
      "missing-canonical",
      "missing-description",
      "missing-h1",
      "noindex",
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

function baseline(title, description = "A sufficiently detailed description for this example page and search result.") {
  return createBaseline({
    startUrl: "https://example.com/legal/terms",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
    options: { maxPages: 1 },
    pages: [{
      url: "https://example.com/legal/terms",
      finalUrl: "https://example.com/legal/terms",
      status: 200,
      title,
      description,
      canonical: "https://example.com/legal/terms",
      h1Count: 1,
      wordCount: 300,
    }],
  });
}

test("suppression applies until its expiry and then exposes the issue again", () => {
  const snapshot = baseline("A useful page title", null);
  const ruleSet = {
    enabledRules: ["missing-description"],
    suppressions: [{
      rule: "missing-description",
      urlPattern: "/legal/**",
      reason: "Description intentionally omitted",
      expiresAt: "2027-01-01",
    }],
  };

  assert.equal(auditBaseline(snapshot, { ...ruleSet, now: "2026-12-31" }).length, 0);
  assert.equal(auditBaseline(snapshot, { ...ruleSet, now: "2027-01-02" }).length, 1);
});

test("diff classifies new, unchanged, and resolved issues by stable fingerprint", () => {
  const previous = baseline("Original title", null);
  const current = baseline(null, "A sufficiently detailed description for this example page and search result.");
  const result = diff(previous, current, {
    enabledRules: ["missing-title", "missing-description"],
  });

  assert.equal(result.newIssues.some((issue) => issue.rule === "missing-title"), true);
  assert.equal(result.resolvedIssues.some((issue) => issue.rule === "missing-description"), true);
  assert.equal(result.newIssues.every((issue) => /^[a-f0-9]{24}$/.test(issue.fingerprint)), true);
  assert.equal(result.complete, true);
});

test("partial diff does not invent missing or resolved issues for unchecked pages", () => {
  const previous = createBaseline({
    startUrl: "https://example.com/",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
    pages: [
      { ...baseline("Home").pages[0], url: "https://example.com/", finalUrl: "https://example.com/", description: null },
      { ...baseline(null).pages[0], url: "https://example.com/unchecked", finalUrl: "https://example.com/unchecked" },
    ],
  });
  const current = createBaseline({
    startUrl: "https://example.com/",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "same", error: null },
    pages: [{
      ...baseline("Home").pages[0],
      url: "https://example.com/",
      finalUrl: "https://example.com/",
    }],
    partial: true,
    truncated: true,
  });

  const result = diff(previous, current);
  assert.equal(result.complete, false);
  assert.equal(result.newIssues.some((issue) => issue.ruleId === "page-missing"), false);
  assert.equal(result.resolvedIssues.some((issue) => issue.url === "https://example.com/unchecked"), false);
  assert.equal(result.resolvedIssues.some((issue) => issue.ruleId === "missing-description"), true);
});
