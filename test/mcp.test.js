import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  checkTool,
  compareTool,
  issuesTool,
  planTool,
  reportTool,
  rulesTool,
  scanTool,
} from "../packages/mcp/dist/tools.js";
import { toolError, toolResult } from "../packages/mcp/dist/result.js";
import { assertRealWorkspacePath, workspacePath } from "../packages/mcp/dist/paths.js";
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

test("MCP results keep JSON in text for clients without structured-content support", () => {
  const success = toolResult({ mode: "links", candidateCount: null });
  assert.equal(success.structuredContent, undefined);
  assert.deepEqual(JSON.parse(success.content[0].text), { mode: "links", candidateCount: null });

  const failure = toolError(new Error("example failure"));
  assert.equal(failure.structuredContent, undefined);
  assert.deepEqual(JSON.parse(failure.content[0].text), { error: "example failure" });
});

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
  assert.equal(rendered.report, join("reports", "fresh-report.html"));
  assert.match(await readFile(join(root, "reports/fresh-report.html"), "utf8"), /SEO baseline audit/);

  const rules = await rulesTool();
  assert.ok(rules.rules.length >= 40);
  assert.match(rules.rules[0].documentationUrl, /docs\/rules\.md#/);
});

test("MCP artifact paths cannot escape the workspace", () => {
  const root = resolve("project");
  assert.equal(workspacePath(root, join("reports", "audit.html"), "fallback"), join(root, "reports", "audit.html"));
  assert.throws(() => workspacePath(root, join("..", "secret"), "fallback"), /inside the workspace/);
  assert.throws(() => workspacePath(root, resolve("secret"), "fallback"), /relative/);
});

test("MCP artifact paths reject symlinks that leave the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-audit-mcp-root-"));
  const outside = await mkdtemp(join(tmpdir(), "seo-audit-mcp-outside-"));
  await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(assertRealWorkspacePath(root, join(root, "linked/report.html")), /symlink/);
  await assert.rejects(reportTool({ root }, { snapshot: "linked/input.json" }), /symlink/);
});

test("MCP validates the authenticated checkpoint path after namespacing", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-audit-mcp-checkpoint-root-"));
  const outside = await mkdtemp(join(tmpdir(), "seo-audit-mcp-checkpoint-outside-"));
  const checkpoint = authenticatedCheckpointPath(join(root, "checkpoint.ndjson"), "SEO_AUDIT_MCP_HEADERS");
  await symlink(outside, checkpoint, process.platform === "win32" ? "junction" : "dir");
  process.env.SEO_AUDIT_MCP_HEADERS = "{}";
  try {
    await assert.rejects(scanTool({ root, fetch: siteFetch() }, {
      url: "https://example.com/",
      sitemap: "none",
      maxPages: 1,
      delay: 0,
      checkpoint: "checkpoint.ndjson",
      headersEnv: "SEO_AUDIT_MCP_HEADERS",
    }), /symlink/);
  } finally {
    delete process.env.SEO_AUDIT_MCP_HEADERS;
  }
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

test("MCP header validation never includes rejected secret values", () => {
  const secret = "private-value\ninvalid";
  process.env.SEO_AUDIT_MCP_INVALID_HEADERS = JSON.stringify({ Authorization: secret });
  try {
    assert.throws(
      () => headersFromEnvironment("SEO_AUDIT_MCP_INVALID_HEADERS"),
      (error) => error instanceof Error && /Authorization/.test(error.message) && !error.message.includes(secret),
    );
  } finally {
    delete process.env.SEO_AUDIT_MCP_INVALID_HEADERS;
  }
});

test("bundled stdio server negotiates MCP and advertises the complete tool set", async () => {
  const child = spawn(process.execPath, [join(process.cwd(), "packages/cli/bin/seo-audit.js"), "mcp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n");
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  assert.equal(stderr, "");
  const responses = stdout.trim().split("\n").map(JSON.parse);
  assert.equal(responses[0].result.serverInfo.version, "0.9.0");
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name).sort(), [
    "seo_audit_check",
    "seo_audit_compare",
    "seo_audit_issues",
    "seo_audit_plan",
    "seo_audit_report",
    "seo_audit_rules",
    "seo_audit_scan",
  ]);
});
