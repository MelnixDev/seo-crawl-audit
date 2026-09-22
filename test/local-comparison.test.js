import assert from "node:assert/strict";
import test from "node:test";
import { audit, migrateSnapshot } from "../packages/core/dist/index.js";
import { buildLocalComparison } from "../packages/core/dist/local-comparison.js";

const url = "https://example.com/";
function snapshot({ title = null, error = null, status = 200, partial = false, overrides = {} } = {}) {
  const value = migrateSnapshot({ schemaVersion: 1, startUrl: url, generatedAt: "2026-09-01T00:00:00.000Z", pages: [{
    url, status, error, contentType: error ? null : "text/html", title,
    description: "A clear description for the page.", h1Count: 1,
  }] });
  return { ...value, partial, config: { ...value.config, severityOverrides: overrides } };
}

test("comparison cannot claim a metadata repair after a failed request", () => {
  const previous = snapshot();
  const current = snapshot({ error: "timeout", status: null });
  const result = buildLocalComparison(previous, current, { evaluatedAt: "2026-09-23T00:00:00.000Z" });
  assert.equal(result.diff.resolvedIssues.some((issue) => issue.ruleId === "missing-title"), false);
  assert.equal(result.summary.unverified.some((issue) => issue.ruleId === "missing-title"), true);
});

test("comparison uses current policy for both snapshots and keeps stored inputs untouched", () => {
  const previous = snapshot({ overrides: { "missing-title": "error" } });
  const current = snapshot({ title: "Clear page title", overrides: {} });
  const result = buildLocalComparison(previous, current, { evaluatedAt: "2026-09-23T00:00:00.000Z" });
  const expected = audit({ ...previous, config: { ...previous.config, severityOverrides: {} } }, { now: "2026-09-23T00:00:00.000Z" });
  assert.equal(result.summary.beforeFindings.error, expected.filter((issue) => issue.severity === "error").length);
  assert.equal(previous.config.severityOverrides["missing-title"], "error");
  assert.equal(result.summary.coverage.common, 1);
  assert.equal(result.summary.lifecycle.resolved > 0, true);
  assert.equal(result.summary.warnings.includes("evaluation-policy-changed"), true);
  assert.equal(result.summary.evaluationPolicy.source, "after");
  assert.equal(result.summary.lifecycleBySeverity.error.resolved >= 0, true);
  assert.equal(Array.isArray(result.summary.budgetExceeded), true);
});

test("partial current coverage never resolves unchecked findings", () => {
  const previous = snapshot();
  const current = { ...snapshot({ title: "Now titled", partial: true }), pages: [] };
  const result = buildLocalComparison(previous, current, { evaluatedAt: "2026-09-23T00:00:00.000Z" });
  assert.equal(result.summary.coverage.complete, false);
  assert.equal(result.summary.coverage.onlyBefore, 1);
  assert.equal(result.diff.resolvedIssues.length, 0);
  assert.equal(result.summary.warnings.includes("incomplete-after"), true);
});
