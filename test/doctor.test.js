import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/dist/cli.js";
import { runDoctor } from "../packages/cli/dist/doctor.js";

function status(result, id) {
  return result.checks.find((check) => check.id === id)?.status;
}

test("doctor validates runtime, config, storage, homepage, robots, and sitemap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-doctor-"));
  await writeFile(join(directory, "seo-audit.config.json"), JSON.stringify({
    url: "https://example.com/",
    delay: 0,
  }));
  const requests = [];
  const fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === "/") {
      return new Response("<h1>Home</h1>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n", { status: 200 });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response("<?xml version=\"1.0\"?><urlset><url><loc>https://example.com/</loc></url></urlset>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  const result = await runDoctor({ directory, fetch, runtimeVersion: "24.1.0" });
  assert.equal(result.healthy, true);
  assert.deepEqual(Object.fromEntries(result.checks.map((check) => [check.id, check.status])), {
    runtime: "pass",
    config: "pass",
    target: "pass",
    storage: "pass",
    homepage: "pass",
    robots: "pass",
    sitemap: "pass",
  });
  assert.deepEqual(requests, ["/", "/robots.txt", "/sitemap.xml"]);
});

test("doctor reports local failures and skips all network work in offline mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-doctor-offline-"));
  await writeFile(join(directory, "broken.json"), "{not json");
  let requests = 0;
  const result = await runDoctor({
    directory,
    url: "https://example.com/",
    configPath: "broken.json",
    runtimeVersion: "18.20.0",
    offline: true,
    fetch: async () => {
      requests += 1;
      return new Response();
    },
  });

  assert.equal(result.healthy, false);
  assert.equal(status(result, "runtime"), "fail");
  assert.equal(status(result, "config"), "fail");
  assert.equal(status(result, "target"), "pass");
  assert.equal(status(result, "homepage"), "skipped");
  assert.equal(status(result, "robots"), "skipped");
  assert.equal(status(result, "sitemap"), "skipped");
  assert.equal(requests, 0);
});

test("doctor gives actionable diagnostics for protected or non-HTML sites", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-doctor-protected-"));
  const protectedResult = await runDoctor({
    directory,
    url: "https://example.com/",
    runtimeVersion: "20.19.0",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/") return new Response("Unauthorized", { status: 401, headers: { "content-type": "text/html" } });
      return new Response("Denied", { status: 403 });
    },
  });
  assert.equal(status(protectedResult, "homepage"), "fail");
  assert.equal(status(protectedResult, "robots"), "fail");
  assert.match(protectedResult.checks.find((check) => check.id === "homepage")?.remediation ?? "", /authenticated request headers/);

  const nonHtmlResult = await runDoctor({
    directory,
    url: "https://example.com/feed.json",
    offline: false,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/feed.json") return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
      return new Response("Not found", { status: 404 });
    },
  });
  assert.equal(status(nonHtmlResult, "homepage"), "warning");
  assert.equal(status(nonHtmlResult, "sitemap"), "warning");
  assert.equal(nonHtmlResult.healthy, true);
});

test("CLI doctor supports config URLs, offline checks, and JSON output", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-doctor-cli-"));
  await writeFile(join(directory, "seo-audit.config.json"), JSON.stringify({ url: "https://example.com/" }));
  const messages = [];
  const originalLog = console.log;
  console.log = (...values) => { messages.push(values.join(" ")); };
  context.after(() => { console.log = originalLog; });

  assert.equal(await main(["doctor", "--directory", directory, "--offline", "--json"]), 0);
  const output = JSON.parse(messages.at(-1));
  assert.equal(output.command, "doctor");
  assert.equal(output.url, "https://example.com/");
  assert.equal(output.offline, true);
  assert.equal(output.summary.skipped, 3);
});

test("CLI doctor distinguishes diagnostic failure from invalid CLI syntax", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-doctor-errors-"));
  const messages = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => { messages.push(values.join(" ")); };
  console.error = (...values) => { messages.push(values.join(" ")); };
  context.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  assert.equal(await main(["doctor", "not-a-url", "--directory", directory, "--offline"]), 1);
  assert.equal(await main(["doctor", "https://example.com/", "extra", "--offline"]), 2);
  assert.match(messages.join("\n"), /No target URL|not a full HTTP\(S\) URL/);
  assert.match(messages.join("\n"), /Unexpected argument/);
});
