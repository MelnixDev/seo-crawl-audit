import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateSnapshot } from "../packages/core/dist/index.js";
import { readCatalogSnapshot, readHistoryCatalog, writeHistorySnapshot } from "../packages/core/dist/node.js";

test("catalogue survives duplicate timestamps, bad files and symlinks without exposing paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "seo-history-catalog-"));
  try {
    const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", generatedAt: "2026-09-22T00:00:00.000Z", pages: [{ url: "https://example.com/", status: 200 }] });
    const first = await writeHistorySnapshot(root, snapshot);
    const second = await writeHistorySnapshot(root, snapshot);
    assert.notEqual(first, second);
    await writeFile(join(root, "bad.snapshot.json"), "{");
    await symlink(first, join(root, "link.snapshot.json"));
    const catalog = await readHistoryCatalog(root);
    assert.equal(catalog.entries.length, 2);
    assert.equal(catalog.warnings.length, 2);
    assert.equal(catalog.entries.every((entry) => !entry.runId.includes(root)), true);
    assert.equal((await readCatalogSnapshot(root, catalog.entries[0])).siteUrl, snapshot.siteUrl);
    const repeated = await readHistoryCatalog(root);
    assert.equal(repeated.revision, catalog.revision);
    await writeFile(first, (await readFile(first, "utf8")).replace("example.com", "changed.example.com"));
    await assert.rejects(readCatalogSnapshot(root, catalog.entries.find((entry) => first.endsWith(entry.name))), /changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
