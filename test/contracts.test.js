import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../packages/core/dist/index.js";
import { createBaseline } from "../packages/core/dist/baseline.js";

const { audit, diff, migrateSnapshot, renderReport, scan } = core;

const legacySnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  startUrl: "https://example.com/",
  robots: {
    url: "https://example.com/robots.txt",
    status: 200,
    sha256: "r",
    error: null,
  },
  options: { maxPages: 1, requestDelay: 100 },
  pages: [{
    url: "https://example.com/",
    status: 200,
    title: null,
    description: null,
    canonical: null,
    h1Count: 0,
  }],
};

test("locks the documented core function surface", () => {
  for (const candidate of [audit, diff, migrateSnapshot, renderReport, scan]) {
    assert.equal(typeof candidate, "function");
  }
  assert.deepEqual(Object.keys(core).sort(), [
    "DEFAULT_CONFIG_FILE",
    "DEFAULT_SCAN_CONFIG",
    "ENGINE_VERSION",
    "RULE_SET_VERSION",
    "audit",
    "buildHistorySeries",
    "diff",
    "getRuleDefinitions",
    "groupIssuesByTemplate",
    "migrateSnapshot",
    "planScan",
    "renderReport",
    "resolveConfig",
    "scan",
    "validateConfig",
  ]);
  const definitions = core.getRuleDefinitions();
  assert.ok(definitions.length >= 25);
  assert.equal(Object.isFrozen(definitions), true);
  assert.equal(Object.isFrozen(definitions[0]), true);
});

test("locks SnapshotV2 normalization, configuration hash, and issue fingerprints", () => {
  const snapshot = createBaseline(legacySnapshot);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.siteUrl, "https://example.com/");
  assert.equal(
    snapshot.configurationHash,
    "66ae7d2616f5e03c51981412325fb46717d7727d848fd95763992cb04d85794f",
  );
  assert.deepEqual(
    audit(snapshot).map(({ ruleId, fingerprint }) => [ruleId, fingerprint]),
    [
      ["missing-title", "1ed49435730a4ff913a8e15e"],
      ["missing-canonical", "bd136dda2e1e8a79b286ca2b"],
      ["missing-description", "48f5482c30c59eb43898afed"],
      ["missing-h1", "a40898ca6dcfd6a7e05b24cf"],
      ["low-word-count", "e596a00555b35157fcf9a0c7"],
      ["missing-open-graph", "0b3e1aa183fd76b0d4c014df"],
      ["missing-twitter-metadata", "728c10486fac348c43a77c9a"],
    ],
  );
  assert.deepEqual(migrateSnapshot(legacySnapshot), snapshot);
});
