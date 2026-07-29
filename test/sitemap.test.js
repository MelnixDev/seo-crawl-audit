import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  discoverSitemapUrl,
  loadSitemapUrls,
} from "../src/sitemap.js";

test("loads page URLs from a sitemap index", async (context) => {
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
    userAgent: "seo-regression-guard/test",
    includeQuery: false,
  });

  assert.equal(result.sitemapCount, 2);
  assert.deepEqual(result.urls, [`${origin}/first`, `${origin}/second`]);
});

test("discovers a sitemap declared in robots.txt", async (context) => {
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
    userAgent: "seo-regression-guard/test",
  });

  assert.equal(result, `${origin}/custom-sitemap.xml`);
});
