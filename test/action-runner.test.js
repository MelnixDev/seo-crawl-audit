import test from "node:test";
import assert from "node:assert/strict";
import { runAction, thresholdBlocks } from "../packages/action/dist/runner.js";
import { migrateSnapshot } from "../packages/core/dist/index.js";

function snapshot({ description = null, budgets = {}, partial = false, status = 200 } = {}) {
  return migrateSnapshot({
    schemaVersion: 1,
    startUrl: "https://example.com/",
    robots: { url: "https://example.com/robots.txt", status: 200, sha256: "robots", error: null },
    options: { regressionBudgets: budgets },
    partial,
    truncated: partial,
    pages: [{
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status,
      title: "A stable example title",
      description,
      canonical: "https://example.com/",
      canonicalRaw: "https://example.com/",
      h1Count: 1,
      lang: "en",
      wordCount: 250,
      openGraph: { title: "Example", description: "Example", image: "https://example.com/image.jpg" },
      twitter: { card: "summary", title: "Example", description: "Example", image: "https://example.com/image.jpg" },
    }],
  });
}

function scanResult(current) {
  return {
    snapshot: current,
    startUrl: current.siteUrl,
    pages: current.pages,
    robots: current.robots,
    sitemap: current.sitemap,
    truncated: current.truncated,
    partial: current.partial,
    options: {},
  };
}

function adapters(current, baseline = null) {
  const state = { failed: [], outputs: {}, reports: [], json: [], annotations: [], summaries: [], info: [] };
  return {
    state,
    value: {
      async loadConfig() { return {}; },
      async readSnapshot() { if (!baseline) throw new Error("missing fixture baseline"); return baseline; },
      async writeReport(path, data) { state.reports.push({ path, data }); },
      async writeJson(path, data) { state.json.push({ path, data }); },
      resolvePath(path) { return `/workspace/${path}`; },
      async scan(_config, options) {
        await options.onEvent?.({ type: "progress", completed: 25, total: 50, page: current.pages[0] });
        return scanResult(current);
      },
      info(message) { state.info.push(message); },
      annotateError(issue) { state.annotations.push(issue); },
      setOutput(name, value) { state.outputs[name] = value; },
      setFailed(message) { state.failed.push(message); },
      async writeSummary(summary) { state.summaries.push(summary); },
    },
  };
}

test("Action threshold policy is deterministic", () => {
  assert.equal(thresholdBlocks("error", "error"), true);
  assert.equal(thresholdBlocks("warning", "error"), false);
  assert.equal(thresholdBlocks("warning", "warning"), true);
  assert.equal(thresholdBlocks("error", "none"), false);
});

test("runAction writes both outputs and fails at the configured threshold", async () => {
  const fixture = adapters(snapshot());
  const result = await runAction({ url: "https://example.com/", failOn: "warning", report: "audit.html" }, fixture.value);

  assert.equal(result.blocked, true);
  assert.deepEqual(fixture.state.outputs, {
    report: "/workspace/audit.html",
    summary: "/workspace/audit.html.json",
  });
  assert.equal(fixture.state.reports.length, 1);
  assert.equal(fixture.state.json.length, 1);
  assert.equal(fixture.state.failed.length, 1);
});

test("regression budgets block an Action even when fail-on is none", async () => {
  const previous = snapshot({ description: "A useful description that is long enough to represent an ordinary search result snippet.", budgets: { "missing-description": 0 } });
  const current = snapshot({ budgets: { "missing-description": 0 } });
  const fixture = adapters(current, previous);
  const result = await runAction({ baseline: "baseline.json", failOn: "none" }, fixture.value);

  assert.equal(result.blocked, true);
  assert.equal(result.complete, true);
  assert.equal(fixture.state.failed.length, 1);
});

test("runAction rejects invalid inputs before starting a scan", async () => {
  const fixture = adapters(snapshot());
  await assert.rejects(
    runAction({ url: "https://example.com/", failOn: "critical" }, fixture.value),
    /fail-on must be error, warning, or none/,
  );
});

test("runAction reads same-origin headers from the named environment variable", async () => {
  const current = snapshot();
  const fixture = adapters(current);
  const requests = [];
  fixture.value.environment = {
    SEO_AUDIT_SITE_HEADERS: JSON.stringify({ Authorization: "Bearer action-private" }),
  };
  fixture.value.fetch = async (input, init) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return new Response("ok");
  };
  fixture.value.scan = async (_config, options) => {
    await options.fetch("https://example.com/private");
    await options.fetch("https://external.example.net/redirect");
    return scanResult(current);
  };

  await runAction({
    url: "https://example.com/",
    headersEnv: "SEO_AUDIT_SITE_HEADERS",
    failOn: "none",
  }, fixture.value);

  assert.deepEqual(requests, [
    { url: "https://example.com/private", authorization: "Bearer action-private" },
    { url: "https://external.example.net/redirect", authorization: null },
  ]);
  assert.doesNotMatch(JSON.stringify(fixture.state), /action-private/);

  await assert.rejects(
    runAction({ url: "https://example.com/", headersEnv: "MISSING" }, fixture.value),
    /empty or missing/,
  );
});

test("runAction tolerates an absent default config and emits annotations and summary", async () => {
  const fixture = adapters(snapshot({ status: 500 }));
  fixture.value.loadConfig = async () => {
    throw new Error("ENOENT: config not found", { cause: { code: "ENOENT" } });
  };
  const result = await runAction({ url: "https://example.com/", failOn: "none" }, fixture.value);

  assert.equal(result.blocked, false);
  assert.ok(fixture.state.annotations.length > 0);
  assert.equal(fixture.state.summaries.length, 1);
  assert.match(fixture.state.info[0], /Scanned 25\/50/);
});

test("runAction rejects missing URL and propagates explicit config failures", async () => {
  const missingUrl = adapters(snapshot());
  await assert.rejects(runAction({}, missingUrl.value), /Provide the url input/);

  const invalidConfig = adapters(snapshot());
  invalidConfig.value.loadConfig = async () => { throw new Error("invalid explicit config"); };
  await assert.rejects(
    runAction({ config: "custom.json", url: "https://example.com/" }, invalidConfig.value),
    /invalid explicit config/,
  );
});
