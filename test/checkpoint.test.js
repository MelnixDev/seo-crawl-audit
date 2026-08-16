import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCheckpointPages,
  checkpointPathForOutput,
  initializeCheckpoint,
  removeCheckpoint,
} from "../packages/core/dist/index.js";

test("checkpoint resumes saved pages and resets for another source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-checkpoint-"));
  const path = join(directory, "scan.checkpoint.ndjson");
  const source = {
    startUrl: "https://example.com/",
    sitemap: null,
    includeQuery: false,
    respectRobots: true,
  };

  assert.deepEqual(await initializeCheckpoint(path, source), {
    pages: [],
    resumed: false,
  });

  await appendCheckpointPages(path, [
    {
      url: "https://example.com/",
      title: "Saved",
      links: ["https://example.com/about"],
    },
  ]);
  // Simulate an interrupted final write. Valid records before it must survive.
  await import("node:fs/promises").then(({ appendFile }) =>
    appendFile(path, '{"type":"page"', "utf8"),
  );

  const resumed = await initializeCheckpoint(path, source);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.pages.length, 1);
  assert.equal(resumed.pages[0].title, "Saved");

  const reset = await initializeCheckpoint(path, {
    ...source,
    startUrl: "https://other.example/",
  });
  assert.deepEqual(reset, { pages: [], resumed: false });
  assert.match(await readFile(path, "utf8"), /other\.example/);

  await removeCheckpoint(path);
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
});

test("derives a nearby hidden-friendly checkpoint path", () => {
  assert.equal(
    checkpointPathForOutput("/tmp/.seo-audit.json"),
    "/tmp/.seo-audit.checkpoint.ndjson",
  );
  assert.equal(
    checkpointPathForOutput("/tmp/custom"),
    "/tmp/custom.checkpoint.ndjson",
  );
});
