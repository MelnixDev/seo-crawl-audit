import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfig,
  validateConfig,
} from "../packages/core/dist/index.js";

test("resolves CLI over config file over baseline over safe defaults", () => {
  const result = resolveConfig(
    { schemaVersion: 1, concurrency: 9 },
    { delay: 250, concurrency: 4 },
    { maxPages: 500, delay: 500 },
  );

  assert.equal(result.concurrency, 9);
  assert.equal(result.delay, 250);
  assert.equal(result.maxPages, 500);
  assert.equal(result.timeout, 10_000);
  assert.equal(result.respectRobots, true);
});

test("validates suppressions and report branding", () => {
  const config = validateConfig({
    suppressions: [{
      rule: "missing-description",
      urlPattern: "/legal/**",
      reason: "Description intentionally omitted",
      expiresAt: "2027-01-01",
    }],
    report: { agencyName: "Example", primaryColor: "#3157d5" },
  });

  assert.equal(config.suppressions[0].rule, "missing-description");
  assert.equal(config.report.primaryColor, "#3157d5");
  assert.throws(
    () => validateConfig({ suppressions: [{ rule: "x", urlPattern: "*", reason: "x", expiresAt: "tomorrow" }] }),
    /YYYY-MM-DD/,
  );
});
