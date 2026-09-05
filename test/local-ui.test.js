import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserLaunchCommand, createLocalUiServer, serveCommand } from "../packages/cli/dist/server.js";

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

async function waitForCompletion(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await fetch(new URL("/api/state", url)).then((response) => response.json());
    if (["complete", "cancelled", "error"].includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("local UI scan did not finish");
}

test("local UI binds only to loopback and serves its application shell", async (context) => {
  await assert.rejects(createLocalUiServer({ host: "0.0.0.0", port: 0 }), /loopback/);
  const server = await createLocalUiServer({ port: 0, initialUrl: "https://example.com/" });
  context.after(() => server.close());

  const response = await fetch(server.url);
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Free, local-first site crawler/);
  assert.match(page, /new EventSource\("\/api\/events"\)/);
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

test("local UI runs a scan and exposes the generated report", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-local-ui-"));
  const server = await createLocalUiServer({ port: 0, directory, fetch: siteFetch });
  context.after(() => server.close());

  const started = await fetch(new URL("/api/scan", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/", maxPages: 1, concurrency: 1, delay: 0, publicMetrics: false }),
  });
  assert.equal(started.status, 202);
  const state = await waitForCompletion(server.url);
  assert.equal(state.status, "complete", state.message);
  assert.equal(state.summary.pages, 1);
  assert.equal(state.reportReady, true);

  const report = await fetch(new URL("/report", server.url));
  assert.equal(report.status, 200);
  assert.match(await report.text(), /Site Metrics/);
  await access(join(directory, ".seo-audit.json"));
  await access(join(directory, "seo-audit-report.html"));
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
