import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { crawlSite } from "../packages/core/dist/index.js";

test("crawls same-origin HTML pages and respects robots.txt", async (context) => {
  let requestSlots = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /private\n");
      return;
    }

    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`
        <title>Home</title>
        <link rel="canonical" href="/">
        <a href="/about">About</a>
        <a href="/private">Private</a>
        <a href="https://external.example/">External</a>
      `);
      return;
    }

    if (request.url === "/about") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>About</title><h1>About</h1>");
      return;
    }

    response.writeHead(404, { "content-type": "text/html" });
    response.end("<title>Not found</title>");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const address = server.address();
  const startUrl = `http://127.0.0.1:${address.port}/`;
  const scan = await crawlSite(startUrl, {
    maxPages: 10,
    concurrency: 2,
    requestDelay: 0,
    requestGate: async () => {
      requestSlots += 1;
    },
  });

  assert.equal(scan.pages.length, 3);
  assert.equal(scan.pages.find((page) => page.url.endsWith("/")).title, "Home");
  assert.equal(
    scan.pages.find((page) => page.url.endsWith("/about")).h1Count,
    1,
  );
  assert.equal(
    scan.pages.find((page) => page.url.endsWith("/private")).blockedByRobots,
    true,
  );
  assert.equal(requestSlots, 3);
});

test("reuses cached page results without requesting those URLs again", async (context) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>Fresh</title><h1>Fresh</h1>");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const address = server.address();
  const startUrl = `http://127.0.0.1:${address.port}/`;
  const aboutUrl = new URL("/about", startUrl).href;
  const scan = await crawlSite(startUrl, {
    maxPages: 2,
    concurrency: 1,
    requestDelay: 0,
    cachedPages: [
      {
        url: startUrl,
        finalUrl: startUrl,
        status: 200,
        contentType: "text/html",
        blockedByRobots: false,
        error: null,
        title: "Cached",
        description: null,
        canonical: null,
        robots: null,
        lang: null,
        h1Count: 1,
        openGraph: { title: null, description: null, image: null },
        links: [aboutUrl],
      },
    ],
  });

  assert.equal(scan.pages.length, 2);
  assert.equal(scan.pages[0].title, "Cached");
  assert.equal(requests.filter((url) => url === "/").length, 0);
  assert.equal(requests.filter((url) => url === "/about").length, 1);
});

test("retries 429 responses and emits a retry event", async (context) => {
  let pageRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") return response.end("");
    pageRequests += 1;
    if (pageRequests === 1) {
      response.writeHead(429, { "retry-after": "0" });
      return response.end("busy");
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>Retry works</title><h1>OK</h1>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const events = [];

  const result = await crawlSite(origin, {
    maxPages: 1,
    requestDelay: 0,
    retries: 1,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.pages[0].status, 200);
  assert.equal(pageRequests, 2);
  assert.equal(events.some((event) => event.type === "retry"), true);
});

test("tracks redirect loops and returns a deterministic page error", async (context) => {
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") return response.end("");
    response.writeHead(302, { location: request.url === "/" ? "/next" : "/" });
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const result = await crawlSite(origin, { maxPages: 1, requestDelay: 0 });
  assert.match(result.pages[0].error, /redirect loop/);
  assert.equal(result.pages[0].redirectChain.length, 2);
});

test("stops gracefully after AbortSignal cancellation and marks the snapshot partial", async (context) => {
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") return response.end("");
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<title>${request.url}</title><h1>Page</h1>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();

  const result = await crawlSite(origin, {
    maxPages: 3,
    concurrency: 1,
    requestDelay: 0,
    sitemapData: { url: `${origin}/sitemap.xml`, urls: [`${origin}/two`, `${origin}/three`], sitemapCount: 1, truncated: false },
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "progress" && event.completed === 1) controller.abort("test stop");
    },
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.snapshot.partial, true);
  assert.equal(result.snapshot.statistics.partial, true);
});

test("link discovery uses bounded concurrency and deterministic frontier ordering", async (context) => {
  let active = 0;
  let peak = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") return response.end("");
    if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      return response.end(Array.from({ length: 6 }, (_, index) => `<a href="/page-${6 - index}">Page</a>`).join(""));
    }
    active += 1;
    peak = Math.max(peak, active);
    setTimeout(() => {
      active -= 1;
      response.setHeader("content-type", "text/html");
      response.end(`<title>${request.url}</title><h1>Page</h1>`);
    }, 20);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const concurrent = await crawlSite(origin, { maxPages: 7, concurrency: 5, requestDelay: 0 });
  const sequential = await crawlSite(origin, { maxPages: 7, concurrency: 1, requestDelay: 0 });
  assert.ok(peak > 1 && peak <= 5, `expected peak concurrency between 2 and 5, got ${peak}`);
  assert.deepEqual(
    concurrent.pages.map((page) => page.url),
    sequential.pages.map((page) => page.url),
  );
});
