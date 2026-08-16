import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planScan, scan } from "../packages/core/dist/index.js";
import { createFileCheckpointStore } from "../packages/core/dist/node.js";

test("scan returns an empty partial result when cancelled during planning", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop before robots"));
  const events = [];
  let flushed = false;
  const checkpointStore = {
    async load() { return null; },
    async append() {},
    async clear() {},
    async flush() { flushed = true; },
  };
  const result = await scan({ url: "https://example.com/" }, {
    signal: controller.signal,
    checkpointStore,
    async fetch() { throw new Error("fetch must not start after cancellation"); },
    onEvent(event) { events.push(event.type); },
  });

  assert.equal(result.partial, true);
  assert.equal(result.snapshot.partial, true);
  assert.equal(result.pages.length, 0);
  assert.equal(flushed, true);
  assert.equal(events.at(-1), "cancelled");
});

test("scan returns partial data and resumes successful pages through the checkpoint store", async (context) => {
  const requests = new Map();
  let origin;
  const server = createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) ?? 0) + 1);
    if (request.url === "/robots.txt") return response.end("");
    if (request.url === "/sitemap.xml") {
      response.setHeader("content-type", "application/xml");
      return response.end(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/second</loc></url></urlset>`);
    }
    response.setHeader("content-type", "text/html");
    response.end(`<title>${request.url}</title><h1>Page</h1>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), "seo-scan-api-"));
  const store = createFileCheckpointStore(join(directory, "checkpoint.ndjson"));
  const plan = await planScan({ url: origin, sitemap: `${origin}/sitemap.xml`, delay: 0, concurrency: 1 });
  const controller = new AbortController();

  const partial = await scan(plan, {
    checkpointStore: store,
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "page" && event.completed === 1) controller.abort();
    },
  });
  assert.equal(partial.partial, true);
  assert.equal(partial.pages.length, 1);
  const firstPagePath = new URL(partial.pages[0].url).pathname;
  const beforeResume = requests.get(firstPagePath);

  const completed = await scan(plan, { checkpointStore: createFileCheckpointStore(store.path) });
  assert.equal(completed.partial, false);
  assert.equal(completed.pages.length, 2);
  assert.equal(requests.get(firstPagePath), beforeResume);
});
