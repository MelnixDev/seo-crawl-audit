import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHistorySeries, migrateSnapshot } from "../packages/core/dist/index.js";
import { readHistorySnapshots, writeHistorySnapshot } from "../packages/core/dist/node.js";

function snapshot(generatedAt, pages) {
  return migrateSnapshot({ schemaVersion: 1, generatedAt, startUrl: "https://example.com/", pages });
}

test("builds chronological issue and crawl trends", () => {
  const older = snapshot("2026-01-01T00:00:00.000Z", [{ url: "https://example.com/", status: 200, title: null, h1Count: 0 }]);
  const newer = snapshot("2026-01-02T00:00:00.000Z", [{ url: "https://example.com/", status: 200, title: "Fixed title", h1Count: 1, depth: 2 }]);
  const history = buildHistorySeries([newer, older]);
  assert.equal(history.siteUrl, "https://example.com/");
  assert.deepEqual(history.points.map((point) => point.generatedAt), [older.generatedAt, newer.generatedAt]);
  assert.ok(history.points[0].warnings > history.points[1].warnings);
  assert.ok(history.points[1].resolvedIssues > 0);
  assert.equal(history.points[1].maxDepth, 2);
});

test("writes and filters local history snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-history-"));
  const first = snapshot("2026-01-01T00:00:00.000Z", [{ url: "https://example.com/", status: 200 }]);
  const second = migrateSnapshot({ schemaVersion: 1, generatedAt: "2026-01-02T00:00:00.000Z", startUrl: "https://other.example/", pages: [] });
  const path = await writeHistorySnapshot(directory, first);
  await writeHistorySnapshot(directory, second);
  assert.match(path, /2026-01-01T00-00-00-000Z-.*\.snapshot\.json$/);
  const records = await readHistorySnapshots(directory, "https://example.com/");
  assert.equal(records.length, 1);
  assert.equal(records[0].snapshot.generatedAt, first.generatedAt);
  assert.deepEqual(await readHistorySnapshots(join(directory, "missing")), []);
});
