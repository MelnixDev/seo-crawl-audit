import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCheckpointStore, inspectFileCheckpoint } from "../packages/core/dist/node.js";

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

test("file checkpoint store rejects corruption before the final record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-node-corrupt-"));
  const path = join(directory, "checkpoint.ndjson");
  const store = createFileCheckpointStore(path);
  await store.load(identity);
  await store.append(identity, page("https://example.com/valid"));
  await store.flush();
  const [header, record] = (await readFile(path, "utf8")).split("\n");
  await writeFile(path, `${header}\n{"type":"page"\n${record}\n`, "utf8");

  await assert.rejects(
    createFileCheckpointStore(path).load(identity),
    /corrupt checkpoint record 2/,
  );
});

test("checkpoint inspection is read-only and reports resumable pages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-node-inspect-"));
  const path = join(directory, "checkpoint.ndjson");
  assert.equal((await inspectFileCheckpoint(path)).status, "missing");
  const store = createFileCheckpointStore(path);
  await store.load(identity);
  await store.append(identity, page("https://example.com/saved"));
  await store.flush();
  const inspected = await inspectFileCheckpoint(path);
  assert.equal(inspected.status, "ready");
  assert.equal(inspected.siteUrl, identity.siteUrl);
  assert.equal(inspected.completedPages, 1);
  assert.equal(inspected.resumable, true);
  assert.ok(inspected.updatedAt);
});

test("file checkpoint store clears its current journal only when finalized", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-node-finalize-"));
  const path = join(directory, "checkpoint.ndjson");
  const store = createFileCheckpointStore(path);
  await store.load(identity);
  await store.append(identity, page("https://example.com/saved"));
  await store.clearCurrent();
  await assert.rejects(access(path), { code: "ENOENT" });
  await store.clearCurrent();
});
