import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCheckpointStore } from "../packages/core/dist/node.js";

const identity = {
  schemaVersion: 2,
  pageSchemaVersion: 1,
  siteUrl: "https://example.com/",
  sitemapUrl: "https://example.com/sitemap.xml",
  includeQuery: false,
  respectRobots: true,
  timeout: 10_000,
  maxRedirects: 10,
  maxResponseBytes: 5 * 1024 * 1024,
  userAgent: "seo-crawl-audit/test",
};

function page(url) {
  return { url, status: 200, error: null };
}

test("file checkpoint store serializes appends and ignores an interrupted tail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-node-adapter-"));
  const path = join(directory, "checkpoint.ndjson");
  const store = createFileCheckpointStore(path);
  assert.equal(await store.load(identity), null);
  await Promise.all([
    store.append(identity, page("https://example.com/a")),
    store.append(identity, page("https://example.com/b")),
  ]);
  await store.flush();
  await writeFile(path, `${await readFile(path, "utf8")}{"type":"page","page":`, "utf8");

  const resumed = await createFileCheckpointStore(path).load(identity);
  assert.deepEqual(resumed.pages.map((candidate) => candidate.url).sort(), [
    "https://example.com/a",
    "https://example.com/b",
  ]);
});

test("file checkpoint store reads compatible v1 headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-node-v1-"));
  const path = join(directory, "checkpoint.ndjson");
  await writeFile(path, `${JSON.stringify({
    type: "seo-audit-checkpoint",
    schemaVersion: 1,
    source: {
      startUrl: identity.siteUrl,
      sitemap: identity.sitemapUrl,
      includeQuery: false,
      respectRobots: true,
    },
  })}\n${JSON.stringify({ type: "page", page: page("https://example.com/legacy") })}\n`, "utf8");

  const resumed = await createFileCheckpointStore(path).load(identity);
  assert.equal(resumed.pages[0].url, "https://example.com/legacy");
});
