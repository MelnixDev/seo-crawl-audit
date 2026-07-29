import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { crawlSite } from "../src/crawler.js";

test("crawls same-origin HTML pages and respects robots.txt", async (context) => {
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
