import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkTool,
  compareTool,
  issuesTool,
  planTool,
  reportTool,
  rulesTool,
  scanTool,
} from "../packages/mcp/dist/tools.js";
import { workspacePath } from "../packages/mcp/dist/paths.js";
import { authenticatedCheckpointPath, headersFromEnvironment } from "../packages/mcp/dist/request-headers.js";

function siteFetch({ noindex = false, h1 = true } = {}) {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { status: 200 });
    if (url.endsWith("/")) {
      return new Response(`<!doctype html><html lang="en"><head><title>Example home page</title><meta name="description" content="A useful example description long enough for the audit fixture to accept."><link rel="canonical" href="https://example.com/">${noindex ? '<meta name="robots" content="noindex">' : ""}</head><body>${h1 ? "<h1>Example</h1>" : ""}<p>${"Useful content ".repeat(30)}</p></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("not found", { status: 404 });
  };
}

test("MCP tools plan, scan, inspect, compare, and render local artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-audit-mcp-"));
  const context = { root, fetch: siteFetch() };
  const config = { url: "https://example.com/", sitemap: "none", maxPages: 1, delay: 0 };

  const planned = await planTool(context, config);
  assert.equal(planned.mode, "links");
  assert.equal(planned.candidateCount, null);

  const scanned = await scanTool(context, { ...config, output: "baseline.json", report: "baseline.html" });
  assert.equal(scanned.pages, 1);
  assert.equal(scanned.partial, false);
  await access(join(root, "baseline.json"));
  await access(join(root, "baseline.html"));

  const listed = await issuesTool(context, { snapshot: "baseline.json", severity: "info", limit: 1 });
  assert.equal(listed.limit, 1);
  assert.equal(Array.isArray(listed.issues), true);

  const checked = await checkTool({ root, fetch: siteFetch({ noindex: true, h1: false }) }, {
    ...config,
    baseline: "baseline.json",
    output: "current.json",
    report: "check.html",
  });
  assert.equal(checked.complete, true);
  assert.ok(checked.lifecycle.new > 0);

  const compared = await compareTool(context, { production: "baseline.json", preview: "current.json", report: "compare.html" });
  assert.equal(compared.complete, true);
  assert.ok(compared.new > 0);

  const lifecycle = await issuesTool(context, { snapshot: "current.json", baseline: "baseline.json", lifecycle: "new", limit: 100 });
  assert.equal(lifecycle.total, new Set(lifecycle.issues.map((issue) => issue.fingerprint)).size);
  assert.equal(lifecycle.issues.every((issue) => issue.lifecycle === "new"), true);

  const rendered = await reportTool(context, { snapshot: "current.json", output: "reports/fresh-report.html" });
  assert.equal(rendered.report, "reports/fresh-report.html");
  assert.match(await readFile(join(root, "reports/fresh-report.html"), "utf8"), /SEO baseline audit/);

  const rules = await rulesTool();
  assert.ok(rules.rules.length >= 40);
  assert.match(rules.rules[0].documentationUrl, /docs\/rules\.md#/);
});

test("MCP artifact paths cannot escape the workspace", () => {
  assert.equal(workspacePath("/tmp/project", "reports/audit.html", "fallback"), "/tmp/project/reports/audit.html");
  assert.throws(() => workspacePath("/tmp/project", "../secret", "fallback"), /inside the workspace/);
  assert.throws(() => workspacePath("/tmp/project", "/tmp/secret", "fallback"), /relative/);
});

test("MCP authenticated requests stay same-origin and never return secret values", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-audit-mcp-auth-"));
  const secret = "mcp-private-value";
  process.env.SEO_AUDIT_MCP_TEST_HEADERS = JSON.stringify({ Authorization: `Bearer ${secret}` });
  const seen = [];
  const fetch = async (input, init) => {
    seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return new Response("User-agent: *\nAllow: /\n", { status: 200 });
  };
  try {
    const result = await planTool({ root, fetch }, { url: "https://example.com/", sitemap: "none", headersEnv: "SEO_AUDIT_MCP_TEST_HEADERS" });
    assert.equal(seen[0].authorization, `Bearer ${secret}`);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.match(authenticatedCheckpointPath("/tmp/checkpoint.ndjson", "SEO_AUDIT_MCP_TEST_HEADERS"), /\.auth-[a-f0-9]{12}\.ndjson$/);
    assert.equal(headersFromEnvironment(undefined).Authorization, undefined);
  } finally {
    delete process.env.SEO_AUDIT_MCP_TEST_HEADERS;
  }
});
