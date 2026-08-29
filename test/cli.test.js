import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseScanMenuSelection } from "../packages/cli/dist/cli.js";

test("scan creates a baseline and check fails on a new noindex", async (context) => {
  let noindex = false;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <html>
        <head>
          <title>Stable title</title>
          <meta name="robots" content="${noindex ? "noindex,follow" : "index,follow"}">
          <link rel="canonical" href="/">
        </head>
        <body><h1>Home</h1></body>
      </html>
    `);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const directory = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
  const baseline = join(directory, "baseline.json");
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;
  const originalLog = console.log;
  console.log = () => {};
  context.after(() => {
    console.log = originalLog;
  });

  const scanExitCode = await main([
    "scan",
    url,
    "--output",
    baseline,
    "--max-pages",
    "5",
    "--delay",
    "0",
  ]);
  assert.equal((await readdir(join(directory, ".seo-audit/history"))).length, 1);
  noindex = true;
  const checkExitCode = await main([
    "check",
    url,
    "--baseline",
    baseline,
    "--max-pages",
    "5",
    "--delay",
    "0",
  ]);

  assert.equal(scanExitCode, 0);
  assert.equal(checkExitCode, 1);
});

test("--version prints the package version", async (context) => {
  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(message);
  context.after(() => {
    console.log = originalLog;
  });

  assert.equal(await main(["--version"]), 0);
  assert.deepEqual(messages, ["0.7.1"]);
});

test("--delay rejects negative values before crawling", async (context) => {
  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(message);
  context.after(() => {
    console.error = originalError;
  });

  assert.equal(
    await main(["scan", "https://example.com/", "--delay=-1"]),
    2,
  );
  assert.match(messages[0], /--delay must be a non-negative integer/);
});

test("parses interactive scan menu choices and custom limits", () => {
  assert.deepEqual(parseScanMenuSelection("", 500), {
    mode: "fixed",
    target: 100,
  });
  assert.deepEqual(parseScanMenuSelection("all", 500), {
    mode: "all",
    target: 500,
  });
  assert.deepEqual(parseScanMenuSelection("3", 500), {
    mode: "step",
    target: 500,
  });
  assert.deepEqual(parseScanMenuSelection("250", 500), {
    mode: "fixed",
    target: 250,
  });
  assert.equal(parseScanMenuSelection("invalid", 500), null);
});

test("--all scans every URL from a discovered sitemap", async (context) => {
  let origin;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`User-agent: *\nSitemap: ${origin}/sitemap.xml\n`);
      return;
    }

    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`
        <urlset>
          <url><loc>${origin}/</loc></url>
          <url><loc>${origin}/first</loc></url>
          <url><loc>${origin}/second</loc></url>
        </urlset>
      `);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <title>${request.url}</title>
      <meta name="description" content="Description">
      <link rel="canonical" href="${request.url}">
      <h1>Page</h1>
    `);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-all-test-"));
  const baselinePath = join(directory, "baseline.json");
  const originalLog = console.log;
  console.log = () => {};
  context.after(() => {
    console.log = originalLog;
  });

  const exitCode = await main([
    origin,
    "--all",
    "--output",
    baselinePath,
    "--delay",
    "0",
  ]);
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));

  assert.equal(exitCode, 0);
  assert.equal(baseline.pages.length, 3);
  assert.equal(baseline.truncated, false);
  assert.equal(baseline.source.requestDelay, 0);
});

test("compare reports regressions between production and preview without exposing headers", async (context) => {
  const createSite = (preview) => createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (preview && request.headers.authorization !== "Bearer staging-secret") {
      response.writeHead(401);
      response.end("Unauthorized");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<html><head><title>Stable title</title><meta name="description" content="A sufficiently useful description for the comparison fixture page."><meta name="robots" content="${preview ? "noindex" : "index,follow"}"><link rel="canonical" href="/"></head><body><h1>Page</h1></body></html>`);
  });
  const production = createSite(false);
  const preview = createSite(true);
  production.listen(0, "127.0.0.1");
  preview.listen(0, "127.0.0.1");
  await Promise.all([once(production, "listening"), once(preview, "listening")]);
  context.after(() => { production.close(); preview.close(); });
  const productionAddress = production.address();
  const previewAddress = preview.address();
  const productionUrl = `http://127.0.0.1:${productionAddress.port}/`;
  const previewUrl = `http://127.0.0.1:${previewAddress.port}/`;
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-compare-test-"));
  const reportPath = join(directory, "compare.html");
  process.env.SEO_AUDIT_PREVIEW_HEADERS = JSON.stringify({ Authorization: "Bearer staging-secret" });
  context.after(() => { delete process.env.SEO_AUDIT_PREVIEW_HEADERS; });
  const originalLog = console.log;
  console.log = () => {};
  context.after(() => { console.log = originalLog; });

  const exitCode = await main([
    "compare",
    "--production", productionUrl,
    "--preview", previewUrl,
    "--preview-headers-env", "SEO_AUDIT_PREVIEW_HEADERS",
    "--no-sitemap",
    "--pages", "1",
    "--delay", "0",
    "--report", reportPath,
  ]);
  const report = await readFile(reportPath, "utf8");
  assert.equal(exitCode, 1);
  assert.match(report, /new-noindex/);
  assert.match(report, /preview/);
  assert.doesNotMatch(report, /staging-secret/);
});
