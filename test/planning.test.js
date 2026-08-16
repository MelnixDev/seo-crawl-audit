import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { planScan, scan } from "../packages/core/dist/index.js";

test("planScan reads robots and sitemap once without fetching HTML pages", async (context) => {
  const requests = [];
  let origin;
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/robots.txt") {
      return response.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
    }
    if (request.url === "/sitemap.xml") {
      response.setHeader("content-type", "application/xml");
      return response.end(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/b</loc></url><url><loc>${origin}/a</loc></url></urlset>`);
    }
    response.end("<title>unexpected</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  origin = `http://127.0.0.1:${server.address().port}`;

  const plan = await planScan({ url: origin, delay: 0 });
  assert.deepEqual(requests, ["/robots.txt", "/sitemap.xml"]);
  assert.equal(plan.mode, "sitemap");
  assert.equal(plan.candidateCount, 3);
  assert.deepEqual(plan.candidateUrls, [`${origin}/`, `${origin}/a`, `${origin}/b`]);

  const result = await scan(plan, { limit: 3 });
  assert.equal(result.pages.length, 3);
  assert.equal(requests.filter((url) => url === "/robots.txt").length, 1);
  assert.equal(requests.filter((url) => url === "/sitemap.xml").length, 1);
});
