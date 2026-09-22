import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserLaunchCommand, createLocalUiServer, serveCommand } from "../packages/cli/dist/server.js";
import { createLocalUiServer as createBundledLocalUiServer } from "../packages/cli/bundle/server.js";
import { decideFullScan, estimateScanSeconds, resolveLocalScanConfig } from "../packages/cli/dist/local-ui-scan-controller.js";
import { migrateSnapshot } from "../packages/core/dist/index.js";
import { writeHistorySnapshot, writeSnapshot } from "../packages/core/dist/node.js";

function siteFetch(input) {
  const url = new URL(String(input));
  if (url.pathname === "/robots.txt") {
    return Promise.resolve(new Response("User-agent: *\nAllow: /\n", { status: 200 }));
  }
  if (url.pathname.endsWith("sitemap.xml")) {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
  return Promise.resolve(new Response(
    '<!doctype html><html lang="en"><head><title>Example website</title><meta name="description" content="A useful local browser interface fixture for SEO Crawl Audit."><link rel="canonical" href="https://example.com/"></head><body><h1>Example</h1><p>Useful content for the local audit.</p></body></html>',
    { status: 200, headers: { "content-type": "text/html" } },
  ));
}

function sitemapFetch(count, counters = { robots: 0, sitemap: 0, pages: 0 }) {
  const xml = `<?xml version="1.0"?><urlset>${Array.from({ length: count }, (_, index) => `<url><loc>https://example.com/page-${index}</loc></url>`).join("")}</urlset>`;
  return {
    counters,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) { counters.robots += 1; return new Response("User-agent: *\nSitemap: https://example.com/sitemap.xml\n", { status: 200 }); }
      if (url.endsWith("/sitemap.xml")) { counters.sitemap += 1; return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } }); }
      counters.pages += 1;
      return new Response("<!doctype html><title>Page</title><h1>Page</h1>", { status: 200, headers: { "content-type": "text/html" } });
    },
  };
}

async function waitForCompletion(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await fetch(new URL("/api/state", url)).then((response) => response.json());
    if (["complete", "cancelled", "error"].includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("local UI scan did not finish");
}

test("local UI scan profiles resolve quick standard full and custom limits", () => {
  const url = "https://example.com/";
  assert.equal(resolveLocalScanConfig({ profile: "quick" }, url).maxPages, 100);
  assert.equal(resolveLocalScanConfig({ profile: "standard" }, url).maxPages, 1_000);
  assert.equal(resolveLocalScanConfig({ profile: "full" }, url).maxPages, 50_000);
  assert.equal(resolveLocalScanConfig({ profile: "custom", maxPages: 321 }, url).maxPages, 321);
  assert.throws(() => resolveLocalScanConfig({ profile: "custom", maxPages: 50_001 }, url), /between 1 and 50000/);
});

test("local UI lists history with opaque IDs and bounded pagination", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-local-history-"));
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [{ url: "https://example.com/", status: 200 }] });
  await writeHistorySnapshot(join(directory, ".seo-audit/history"), snapshot);
  await writeHistorySnapshot(join(directory, ".seo-audit/history"), snapshot);
  const server = await createLocalUiServer({ directory, port: 0 });
  context.after(() => server.close());
  const response = await fetch(new URL("/api/history?limit=1&offset=1", server.url));
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.total, 2);
  assert.equal(catalog.runs.length, 1);
  assert.match(catalog.runs[0].runId, /^[a-f0-9]{64}$/);
  assert.equal("name" in catalog.runs[0], false);
  assert.equal("digest" in catalog.runs[0], false);
  const firstPage = await fetch(new URL("/api/history?limit=1", server.url)).then((value) => value.json());
  assert.ok(firstPage.nextCursor);
  const secondPage = await fetch(new URL(`/api/history?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`, server.url));
  assert.equal(secondPage.status, 200);
  assert.notEqual((await secondPage.json()).runs[0].runId, firstPage.runs[0].runId);
  await writeHistorySnapshot(join(directory, ".seo-audit/history"), snapshot);
  const stale = await fetch(new URL(`/api/history?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`, server.url));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).reloadNeeded, true);
});

for (const [label, createServer] of [["source build", createLocalUiServer], ["packed bundle", createBundledLocalUiServer]]) test(`local UI compares two saved runs in a worker and restores the artifact (${label})`, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-local-comparison-"));
  const historyDirectory = join(directory, ".seo-audit/history");
  const before = migrateSnapshot({ schemaVersion: 1, generatedAt: "2026-01-01T00:00:00.000Z", startUrl: "https://example.com/", pages: [{ url: "https://example.com/", status: 200, title: "Before" }] });
  const after = migrateSnapshot({ schemaVersion: 1, generatedAt: "2026-01-02T00:00:00.000Z", startUrl: "https://example.com/", pages: [{ url: "https://example.com/", status: 200, title: "After" }] });
  await writeHistorySnapshot(historyDirectory, before);
  await writeHistorySnapshot(historyDirectory, after);
  const server = await createServer({ directory, port: 0 });
  context.after(() => server.close());
  const runs = (await fetch(new URL("/api/history", server.url)).then((response) => response.json())).runs;
  assert.equal(runs.length, 2);
  const start = await fetch(new URL("/api/history/compare", server.url), {
    method: "POST", headers: { "content-type": "application/json", origin: server.url.slice(0, -1) },
    body: JSON.stringify({ fromId: runs[1].runId, toId: runs[0].runId }),
  });
  assert.equal(start.status, 202);
  let status;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    status = await fetch(new URL("/api/history/comparison", server.url)).then((response) => response.json());
    if (status.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(status.status, "ready", status.message);
  const report = await fetch(new URL("/comparison", server.url));
  assert.equal(report.status, 200);
  assert.match(await report.text(), /SEO regression report/);
  assert.equal((await fetch(new URL("/report", server.url))).status, 404);
  const restarted = await createServer({ directory, port: 0 });
  context.after(() => restarted.close());
  assert.equal((await fetch(new URL("/api/history/comparison", restarted.url)).then((response) => response.json())).status, "ready");
  assert.equal((await fetch(new URL("/comparison", restarted.url))).status, 200);
});

test("custom large scans require confirmation and estimates respect the origin gate", () => {
  const config = resolveLocalScanConfig({ profile: "custom", maxPages: 6_000, concurrency: 10, delay: 1_000 }, "https://example.com/");
  const plan = { planVersion: 1, config, startUrl: config.url, origin: "https://example.com", robots: { url: "https://example.com/robots.txt", status: 200, sha256: null, error: null }, sitemap: null, candidateUrls: [config.url], candidateCount: null, mode: "links", identity: "fixture" };
  const decision = decideFullScan(plan, { profile: "custom" });
  assert.equal(decision.limit, 6_000);
  assert.ok(decision.confirmation);
  assert.equal(decision.confirmation.estimatedSeconds, 6_000);
  assert.equal(estimateScanSeconds(6_000, 1_000, 10), 6_000);
  assert.equal(decideFullScan(plan, { profile: "custom", confirmLargeScan: true }).confirmation, undefined);
});

test("local UI binds only to loopback and serves its application shell", async (context) => {
  await assert.rejects(createLocalUiServer({ host: "0.0.0.0", port: 0 }), /loopback/);
  const server = await createLocalUiServer({ port: 0, initialUrl: "https://example.com/" });
  context.after(() => server.close());

  const response = await fetch(server.url);
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Free, local-first site crawler/);
  assert.match(page, /rel="icon" href="data:image\/svg\+xml/);
  assert.match(page, /new EventSource\("\/api\/events"\)/);
  assert.match(page, /id="reportFrame"/);
  assert.match(page, /Compact overview preview/);
  assert.match(page, /Open full report/);
  assert.match(page, /\/report\?embed=1&v=/);
  assert.match(page, /reportFrame\.contentDocument/);
  assert.match(page, /id="googleEstimate"/);
  assert.match(page, /id="profile"/);
  assert.match(page, /id="historyBefore"/);
  assert.match(page, /id="historyAfter"/);
  assert.match(page, /Історія/);
  assert.match(page, /Full sitemap/);
  assert.match(page, /max="50000"/);
  assert.match(page, /id="updateMetrics"/);
  assert.match(page, /does not crawl pages again/);
  assert.doesNotMatch(page, /id="publicMetrics"/);
  assert.match(page, /Check site: query in Google/);
  assert.doesNotMatch(page, /Overview, Site Metrics, Issues, and local scan history/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  const state = await fetch(new URL("/api/state", server.url)).then((result) => result.json());
  assert.equal(state.url, "https://example.com/");

  const events = await fetch(new URL("/api/events", server.url));
  assert.equal(events.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = events.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /"status":"idle"/);
  await reader.cancel();
});

test("local UI full profile scans a discovered sitemap", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-full-"));
  const fixture = sitemapFetch(3);
  const server = await createLocalUiServer({ port: 0, directory, fetch: fixture.fetch });
  context.after(() => server.close());
  const response = await fetch(new URL("/api/scan", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/", profile: "full", concurrency: 2, delay: 0 }),
  });
  assert.equal(response.status, 202);
  const state = await waitForCompletion(server.url);
  assert.equal(state.status, "complete", state.message);
  assert.equal(state.summary.pages, 4);
  assert.equal(state.total, 4);
});

test("local UI full profile requires a sitemap", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-no-full-"));
  const server = await createLocalUiServer({ port: 0, directory, fetch: siteFetch });
  context.after(() => server.close());
  const response = await fetch(new URL("/api/scan", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/", profile: "full", delay: 0 }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).fullSitemapUnavailable, true);
});

test("local UI confirms a 46k sitemap without repeating preflight", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-large-"));
  const fixture = sitemapFetch(45_999);
  const server = await createLocalUiServer({ port: 0, directory, fetch: fixture.fetch });
  context.after(() => server.close());
  const post = (body) => fetch(new URL("/api/scan", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const input = { url: "https://example.com/", profile: "full", concurrency: 1, delay: 0 };
  const preflight = await post(input);
  assert.equal(preflight.status, 409);
  const warning = await preflight.json();
  assert.equal(warning.requiresLargeScanConfirmation, true);
  assert.equal(warning.candidateCount, 46_000);
  assert.ok(warning.estimatedSeconds > 0);
  assert.equal((await post({ ...input, confirmLargeScan: true })).status, 202);
  await fetch(new URL("/api/cancel", server.url), { method: "POST" });
  assert.equal((await waitForCompletion(server.url)).status, "cancelled");
  assert.equal(fixture.counters.robots, 1);
  assert.equal(fixture.counters.sitemap, 1);
});

test("local UI rejects an unbound or changed large-scan acknowledgement", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-large-binding-"));
  const fixture = sitemapFetch(5_001);
  const server = await createLocalUiServer({ port: 0, directory, fetch: fixture.fetch });
  context.after(() => server.close());
  const post = (body) => fetch(new URL("/api/scan", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const input = { url: "https://example.com/", profile: "full", concurrency: 1, delay: 0 };

  const unbound = await post({ ...input, confirmLargeScan: true });
  assert.equal(unbound.status, 409);
  assert.equal((await unbound.json()).requiresLargeScanConfirmation, true);
  assert.equal(fixture.counters.pages, 0);

  const changed = await post({ ...input, concurrency: 2, confirmLargeScan: true });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).requiresLargeScanConfirmation, true);
  assert.equal(fixture.counters.pages, 0);
  assert.equal(fixture.counters.robots, 2);
  assert.equal(fixture.counters.sitemap, 2);
});

test("local UI runs a scan and exposes the generated report", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-"));
  const server = await createLocalUiServer({ port: 0, directory, fetch: siteFetch });
  context.after(() => server.close());

  const started = await fetch(new URL("/api/scan", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/", maxPages: 1, concurrency: 1, delay: 0 }),
  });
  assert.equal(started.status, 202);
  const state = await waitForCompletion(server.url);
  assert.equal(state.status, "complete", state.message);
  assert.equal(state.summary.pages, 1);
  assert.equal(state.reportReady, true);

  const localReport = await fetch(new URL("/report", server.url));
  assert.doesNotMatch(await localReport.text(), /"id":"search.google-site-estimate"/);

  const metrics = await fetch(new URL("/api/metrics", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ googleEstimate: 19_300 }),
  });
  assert.equal(metrics.status, 200);

  const report = await fetch(new URL("/report", server.url));
  assert.equal(report.status, 200);
  const reportHtml = await report.text();
  assert.match(reportHtml, /Site Metrics/);
  assert.match(reportHtml, /id="history-chart"/);
  assert.match(reportHtml, /"id":"search.google-site-estimate"/);
  assert.match(reportHtml, /"value":19300/);
  assert.match(reportHtml, /google-site-search-manual/);
  assert.doesNotMatch(reportHtml, /seo-audit-embed-style/);
  const embeddedReport = await (await fetch(new URL("/report?embed=1", server.url))).text();
  assert.equal(embeddedReport, reportHtml);

  const refreshed = await fetch(new URL("/api/metrics", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(refreshed.status, 200);
  const refreshedHtml = await (await fetch(new URL("/report", server.url))).text();
  assert.match(refreshedHtml, /"value":19300/);
  assert.match(refreshedHtml, /google-site-search-manual/);
  await access(join(directory, ".seo-audit.json"));
  await access(join(directory, "seo-audit-report.html"));
});

test("public metrics require an existing snapshot", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-metrics-"));
  const server = await createLocalUiServer({ port: 0, directory, fetch: siteFetch });
  context.after(() => server.close());
  const response = await fetch(new URL("/api/metrics", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /run an SEO scan/);
});

test("restart rebuilds the saved report and summary without requests", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-restart-"));
  await writeSnapshot(join(directory, ".seo-audit.json"), migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [{ url: "https://example.com/", status: 200 }] }));
  const report = "<!doctype html><h1>Saved report with public metrics</h1>";
  await writeFile(join(directory, "seo-audit-report.html"), report);
  const server = await createLocalUiServer({ port: 0, directory, fetch: () => { throw new Error("unexpected network request"); } });
  context.after(() => server.close());
  const restored = await (await fetch(new URL("/report", server.url))).text();
  assert.match(restored, /SEO baseline audit/);
  assert.notEqual(restored, report);
  const state = await (await fetch(new URL("/api/state", server.url))).json();
  assert.equal(state.reportReady, true);
  assert.equal(state.summary.pages, 1);
  assert.ok(state.startedAt);
});

test("metrics update excludes concurrent scans and updates, then releases its lock", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-metrics-lock-"));
  const snapshotPath = join(directory, ".seo-audit.json");
  await writeSnapshot(snapshotPath, migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [{ url: "https://example.com/", status: 200 }] }));
  const before = await readFile(snapshotPath, "utf8");
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const server = await createLocalUiServer({ port: 0, directory, fetch: async () => { entered(); await gate; return new Response("{}", { status: 404 }); } });
  context.after(() => { release(); return server.close(); });
  const post = (path, body = {}) => fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const updating = post("/api/metrics");
  await started;
  assert.equal((await post("/api/metrics")).status, 409);
  assert.equal((await post("/api/scan", { url: "https://example.com/" })).status, 409);
  release();
  assert.equal((await updating).status, 200);
  assert.equal((await post("/api/metrics")).status, 200);
  assert.equal(await readFile(snapshotPath, "utf8"), before);
});

test("local UI requires confirmation before replacing another site's results", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-target-"));
  await writeSnapshot(join(directory, ".seo-audit.json"), migrateSnapshot({
    schemaVersion: 1,
    startUrl: "https://existing.example/",
    pages: [{ url: "https://existing.example/", status: 200 }],
  }));
  const server = await createLocalUiServer({ port: 0, directory, fetch: siteFetch });
  context.after(() => server.close());
  const request = (replaceExisting = false) => fetch(new URL("/api/scan", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/", maxPages: 1, concurrency: 1, delay: 0, publicMetrics: false, replaceExisting }),
  });

  const blocked = await request();
  assert.equal(blocked.status, 409);
  const warning = await blocked.json();
  assert.equal(warning.requiresConfirmation, true);
  assert.equal(warning.existingSiteUrl, "https://existing.example/");

  const confirmed = await request(true);
  assert.equal(confirmed.status, 202);
  assert.equal((await waitForCompletion(server.url)).status, "complete");
});

test("local UI rejects cross-origin scan requests", async (context) => {
  const server = await createLocalUiServer({ port: 0 });
  context.after(() => server.close());
  const response = await fetch(new URL("/api/scan", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ url: "https://example.com/" }),
  });
  assert.equal(response.status, 403);
});

test("serve opens the local URL with a platform-appropriate browser command", async () => {
  assert.deepEqual(browserLaunchCommand("http://127.0.0.1:4179/", "darwin"), {
    command: "open",
    args: ["http://127.0.0.1:4179/"],
  });
  assert.deepEqual(browserLaunchCommand("http://127.0.0.1:4179/", "win32"), {
    command: "cmd",
    args: ["/c", "start", "", "http://127.0.0.1:4179/"],
  });
  assert.deepEqual(browserLaunchCommand("http://127.0.0.1:4179/", "linux"), {
    command: "xdg-open",
    args: ["http://127.0.0.1:4179/"],
  });

  const controller = new AbortController();
  controller.abort();
  let openedUrl;
  const exitCode = await serveCommand(0, controller.signal, {
    launchBrowser: async (url) => { openedUrl = url; },
  });
  assert.equal(exitCode, 130);
  assert.match(openedUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
});
