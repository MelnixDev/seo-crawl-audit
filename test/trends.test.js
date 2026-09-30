import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateSnapshot } from "../packages/core/dist/index.js";
import { calculateTrendSummary, writeHistorySnapshot } from "../packages/core/dist/node.js";

const siteUrl = "https://example.com/";
function snapshot(generatedAt, title) {
  return migrateSnapshot({ schemaVersion: 1, generatedAt, startUrl: siteUrl,
    pages: [{ url: siteUrl, status: 200, contentType: "text/html", title, h1Count: 1 }] });
}

test("local trend summary is bounded, versioned, and uses verified adjacent comparisons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-trends-"));
  const empty = await calculateTrendSummary(directory, { siteUrl });
  assert.equal(empty.schemaVersion, 1);
  assert.deepEqual(empty.points, []);
  await writeHistorySnapshot(directory, snapshot("2026-01-01T00:00:00.000Z", null));
  await writeHistorySnapshot(directory, snapshot("2026-01-02T00:00:00.000Z", "Page title"));
  const summary = await calculateTrendSummary(directory, { siteUrl, evaluatedAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(summary.points.length, 2);
  assert.equal(summary.points[0].previousRunId, null);
  assert.equal(summary.points[1].previousRunId, summary.points[0].runId);
  assert.ok(summary.points[1].verifiedResolved > 0);
  assert.ok(summary.points[0].severity.error + summary.points[0].severity.warning > summary.points[1].severity.error + summary.points[1].severity.warning);
  assert.ok(!JSON.stringify(summary).includes(directory));
  await assert.rejects(calculateTrendSummary(directory, { limit: 21 }), /trend limit/);
});

test("corrupt history is warned about without inventing a comparison across the gap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-trends-"));
  await writeHistorySnapshot(directory, snapshot("2026-01-01T00:00:00.000Z", null));
  await writeFile(join(directory, "corrupt.snapshot.json"), "{not json", "utf8");
  const summary = await calculateTrendSummary(directory, { siteUrl });
  assert.equal(summary.points.length, 1);
  assert.ok(summary.warnings.some((warning) => warning.includes("corrupt.snapshot.json")));
});

test("trend limits select the latest 20, 50, or 100 runs deterministically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-trends-"));
  for (let index = 0; index < 101; index++) {
    const generatedAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
    await writeHistorySnapshot(directory, snapshot(generatedAt, `Title ${index}`));
  }
  for (const limit of [20, 50, 100]) {
    const summary = await calculateTrendSummary(directory, { siteUrl, limit, evaluatedAt: "2026-06-01T00:00:00.000Z" });
    assert.equal(summary.points.length, limit);
    assert.equal(summary.points.at(-1).generatedAt, new Date(Date.UTC(2026, 0, 101)).toISOString());
  }
});

test("trend uses the newest policy at one evaluation time and respects suppression expiry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-trends-"));
  const first = snapshot("2026-01-01T00:00:00.000Z", null);
  const second = snapshot("2026-01-02T00:00:00.000Z", null);
  second.config.suppressions = [{ rule: "missing-title", urlPattern: "/**", reason: "Temporary", expiresAt: "2027-01-01" }];
  await writeHistorySnapshot(directory, first);
  await writeHistorySnapshot(directory, second);
  const active = await calculateTrendSummary(directory, { siteUrl, ruleId: "missing-title", evaluatedAt: "2026-12-31T00:00:00.000Z" });
  const expired = await calculateTrendSummary(directory, { siteUrl, ruleId: "missing-title", evaluatedAt: "2027-01-02T00:00:00.000Z" });
  assert.deepEqual(active.points.map((point) => point.selectedRuleCount), [0, 0]);
  assert.deepEqual(expired.points.map((point) => point.selectedRuleCount), [1, 1]);
});

test("trend calculation honors cancellation and does not emit a partial summary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-trends-"));
  await writeHistorySnapshot(directory, snapshot("2026-01-01T00:00:00.000Z", null));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(calculateTrendSummary(directory, { signal: controller.signal }), /abort/i);
});

test("partial coverage creates a visible trend gap without false resolutions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-audit-trends-"));
  await writeHistorySnapshot(directory, snapshot("2026-01-01T00:00:00.000Z", null));
  const partial = { ...snapshot("2026-01-02T00:00:00.000Z", "Fixed"), pages: [], partial: true, statistics: {
    ...snapshot("2026-01-02T00:00:00.000Z", "Fixed").statistics, partial: true,
  } };
  await writeHistorySnapshot(directory, partial);
  const summary = await calculateTrendSummary(directory, { siteUrl, evaluatedAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(summary.points[1].verifiedResolved, 0);
  assert.ok(summary.points[1].warnings.includes("incomplete-after"));
  assert.ok(summary.points[1].warnings.includes("coverage-changed"));
});
