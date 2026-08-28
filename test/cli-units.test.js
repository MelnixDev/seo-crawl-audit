import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanConfig } from "../packages/cli/dist/args.js";
import { main } from "../packages/cli/dist/cli.js";
import { headersFromEnvironment } from "../packages/cli/dist/commands.js";
import { printIssues, summarizeIssues } from "../packages/cli/dist/report.js";
import { health, printHealth, printProgress } from "../packages/cli/dist/ui.js";
import { migrateSnapshot } from "../packages/core/dist/index.js";

function captureConsole(context) {
  const messages = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => { messages.push(values.join(" ")); };
  console.error = (...values) => { messages.push(values.join(" ")); };
  context.after(() => { console.log = originalLog; console.error = originalError; });
  return messages;
}

test("CLI dispatcher covers help and invalid input paths", async (context) => {
  const messages = captureConsole(context);
  assert.equal(await main([]), 0);
  assert.equal(await main(["--unknown"]), 2);
  assert.equal(await main(["unknown-command"]), 2);
  assert.equal(await main(["scan", "https://example.com/", "extra"]), 2);
  assert.equal(await main(["--config", "/definitely/missing/config.json", "--version"]), 2);
  assert.match(messages.join("\n"), /Local-first SEO crawler/);
  assert.match(messages.join("\n"), /Unknown command/);
  assert.match(messages.join("\n"), /Unexpected argument/);
});

test("report command renders an existing baseline in JSON mode", async (context) => {
  const messages = captureConsole(context);
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-report-command-"));
  const baselinePath = join(directory, "baseline.json");
  const reportPath = join(directory, "report.html");
  const snapshot = migrateSnapshot({
    schemaVersion: 1,
    startUrl: "https://example.com/",
    pages: [{ url: "https://example.com/", status: 200 }],
  });
  await writeFile(baselinePath, JSON.stringify(snapshot));

  assert.equal(await main(["report", baselinePath, "--report", reportPath, "--json"]), 0);
  assert.match(await readFile(reportPath, "utf8"), /SEO baseline audit/);
  assert.match(messages.at(-1), /"command": "report"/);
});

test("CLI config mapping validates conflicts and explicit policies", () => {
  assert.throws(
    () => scanConfig("https://example.com/", { sitemap: "https://example.com/sitemap.xml", "no-sitemap": true }),
    /cannot be used together/,
  );
  const config = scanConfig("https://example.com/", {
    pages: "12",
    concurrency: "2",
    delay: "0",
    timeout: "500",
    "include-query": true,
    "ignore-robots": true,
    "no-sitemap": true,
  });
  assert.equal(config.maxPages, 12);
  assert.equal(config.delay, 0);
  assert.equal(config.sitemap, "none");
  assert.equal(config.includeQuery, true);
  assert.equal(config.respectRobots, false);
  assert.throws(() => scanConfig("https://example.com/", { pages: "0" }), /positive integer/);
});

test("preview request headers are read from JSON environment variables", (context) => {
  process.env.SEO_AUDIT_TEST_HEADERS = JSON.stringify({ Authorization: "Bearer secret", "X-Preview": "yes" });
  context.after(() => { delete process.env.SEO_AUDIT_TEST_HEADERS; });
  assert.deepEqual(headersFromEnvironment("SEO_AUDIT_TEST_HEADERS"), {
    Authorization: "Bearer secret",
    "X-Preview": "yes",
  });
  assert.throws(() => headersFromEnvironment("SEO_AUDIT_MISSING_HEADERS"), /empty or missing/);
});

test("CLI presentation summarizes all severities and health evidence", (context) => {
  const messages = captureConsole(context);
  const issues = ["error", "warning", "info"].map((severity, index) => ({
    severity,
    rule: `rule-${index}`,
    url: `https://example.com/${index}`,
    message: "Finding",
    before: index === 0 ? "before" : undefined,
    after: index === 0 ? "after" : undefined,
  }));
  assert.deepEqual(summarizeIssues(issues), { error: 1, warning: 1, info: 1 });
  printIssues([]);
  printIssues(issues);
  const summary = health([{
    url: "https://example.com/",
    status: 500,
    error: "failed",
    blockedByRobots: false,
    title: null,
    description: null,
    canonical: null,
    h1Count: 0,
    robots: "noindex",
  }]);
  assert.deepEqual(summary, {
    unavailable: 1,
    missingTitle: 1,
    missingDescription: 1,
    missingCanonical: 1,
    missingH1: 1,
    noindex: 1,
  });
  printHealth(summary);
  printProgress(0, 0);
  printProgress(100, 100, true);
  assert.match(messages.join("\n"), /No SEO regressions/);
  assert.match(messages.join("\n"), /before:/);
  assert.match(messages.join("\n"), /Current health/);
});
