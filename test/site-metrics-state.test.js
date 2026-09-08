import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  externalSiteMetrics,
  markStaleSiteMetrics,
  mergeSiteMetrics,
  validateSiteMetricsState,
  readSiteMetricsState,
  writeSiteMetricsState,
} from "../packages/core/dist/node.js";

const externalMetric = (id, source, observedAt) => ({
  id,
  label: { en: id, uk: id },
  value: 42,
  unit: "count",
  source: { id: source, label: source },
  observedAt,
  confidence: "low",
  status: "estimate",
});

test("site metrics state validates, persists atomically, and rejects another origin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seo-metrics-state-"));
  const path = join(directory, ".seo-audit.metrics.json");
  const state = {
    schemaVersion: 1,
    siteUrl: "https://example.com/",
    updatedAt: "2026-09-01T00:00:00.000Z",
    metrics: [externalMetric("search.google-site-estimate", "google-site-search-manual", "2026-09-01T00:00:00.000Z")],
  };
  await writeSiteMetricsState(path, state);
  assert.equal(JSON.parse(await readFile(path, "utf8")).schemaVersion, 1);
  assert.equal((await readSiteMetricsState(path, "https://example.com/page"))?.metrics.length, 1);
  assert.equal(await readSiteMetricsState(path, "https://other.example/"), null);
  assert.throws(() => validateSiteMetricsState({ ...state, schemaVersion: 2 }), /schemaVersion/);
});

test("persisted RDAP and Google estimates become stale on their own schedules", () => {
  const observedAt = "2026-01-01T00:00:00.000Z";
  const state = {
    schemaVersion: 1,
    siteUrl: "https://example.com/",
    updatedAt: observedAt,
    metrics: [
      externalMetric("domain.registration-date", "rdap", observedAt),
      externalMetric("search.google-site-estimate", "google-site-search-manual", observedAt),
    ],
  };
  assert.deepEqual(markStaleSiteMetrics(state, new Date("2026-01-10T00:00:00.000Z")).metrics.map((metric) => metric.stale), [true, false]);
  assert.deepEqual(markStaleSiteMetrics(state, new Date("2026-02-02T00:00:00.000Z")).metrics.map((metric) => metric.stale), [true, true]);
});

test("external metrics merge by stable id without replacing crawl-only values", () => {
  const local = {
    schemaVersion: 1,
    siteUrl: "https://example.com/",
    observedAt: "2026-09-01T00:00:00.000Z",
    metrics: [
      { ...externalMetric("pages.checked", "crawl", "2026-09-01T00:00:00.000Z"), value: 3, confidence: "high", status: "available" },
      { ...externalMetric("search.google-site-estimate", "crawl-estimate", "2026-09-01T00:00:00.000Z"), value: 3 },
    ],
  };
  const collected = { ...local, metrics: [...local.metrics, externalMetric("domain.registrar", "rdap", "2026-09-02T00:00:00.000Z")] };
  const state = externalSiteMetrics(collected);
  assert.deepEqual(state.metrics.map((metric) => metric.id), ["domain.registrar"]);
  const merged = mergeSiteMetrics(local, { ...state, metrics: [externalMetric("search.google-site-estimate", "google-site-search-manual", "2026-09-02T00:00:00.000Z")] });
  assert.equal(merged.metrics.find((metric) => metric.id === "pages.checked").value, 3);
  assert.equal(merged.metrics.find((metric) => metric.id === "search.google-site-estimate").value, 42);
});
