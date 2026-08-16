import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import {
  discoverSitemapUrl,
  loadSitemapUrls,
} from "../packages/core/dist/index.js";

test("loads page URLs from a sitemap index", async (context) => {
  let requestSlots = 0;
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/xml" });

    if (request.url === "/sitemap.xml") {
      response.end(`
        <sitemapindex>
          <sitemap><loc>/pages.xml?part=1&amp;lang=uk</loc></sitemap>
        </sitemapindex>
      `);
      return;
    }

    response.end(`
      <urlset>
        <url><loc>/first?utm_source=sitemap</loc></url>
        <url><loc>/second/</loc></url>
        <url><loc>https://external.example/ignored</loc></url>
      </urlset>
    `);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const result = await loadSitemapUrls(`${origin}/sitemap.xml`, {
    siteOrigin: origin,
    maxUrls: 10,
    timeout: 5_000,
    userAgent: "seo-crawl-audit/test",
    includeQuery: false,
    requestGate: async () => {
      requestSlots += 1;
    },
  });

  assert.equal(result.sitemapCount, 2);
  assert.deepEqual(result.urls, [`${origin}/first`, `${origin}/second`]);
  assert.equal(requestSlots, 2);
});

test("discovers a sitemap declared in robots.txt", async (context) => {
  let requestSlots = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nSitemap: /custom-sitemap.xml\n");
      return;
    }

    response.writeHead(200, { "content-type": "application/xml" });
    response.end("<urlset></urlset>");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const result = await discoverSitemapUrl(origin, {
    timeout: 5_000,
    userAgent: "seo-crawl-audit/test",
    requestGate: async () => {
      requestSlots += 1;
    },
  });

  assert.equal(result, `${origin}/custom-sitemap.xml`);
  assert.equal(requestSlots, 1);
});

test("loads a gzip sitemap with XML validation", async (context) => {
  let origin;
  const server = createServer((request, response) => {
    if (request.url === "/sitemap.xml.gz") {
      response.writeHead(200, { "content-type": "application/gzip" });
      response.end(gzipSync(`<?xml version="1.0"?><urlset><url><loc>${origin}/one</loc></url></urlset>`));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  origin = `http://127.0.0.1:${server.address().port}`;

  const result = await loadSitemapUrls(`${origin}/sitemap.xml.gz`, {
    siteOrigin: origin,
    timeout: 1_000,
    userAgent: "test",
    requestGate: async () => {},
  });
  assert.deepEqual(result.urls, [`${origin}/one`]);
});
