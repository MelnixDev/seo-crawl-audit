import assert from "node:assert/strict";
import test from "node:test";
import { migrateSnapshot } from "../packages/core/dist/index.js";
import { buildObservedLinks } from "../packages/core/dist/report-links.js";

test("observed graph deduplicates sources and preserves checked-target semantics", () => {
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [
    { url: "https://example.com/", status: 200, internalLinks: ["/broken#one", "/broken#two", "/redirect", "/blocked", "/unchecked", "/", "javascript:alert(1)", "/timeout"] },
    { url: "https://example.com/broken", status: 404 },
    { url: "https://example.com/redirect", status: 200, finalUrl: "https://example.com/destination" },
    { url: "https://example.com/blocked", status: null, blockedByRobots: true, error: "blocked" },
    { url: "https://example.com/timeout", status: null, error: "timeout" },
  ] });
  const graph = buildObservedLinks(snapshot.pages);
  assert.deepEqual(graph.get("https://example.com/").broken, ["https://example.com/broken", "https://example.com/timeout"]);
  assert.deepEqual(graph.get("https://example.com/").redirects, ["https://example.com/redirect"]);
  assert.deepEqual(graph.get("https://example.com/broken").incoming, ["https://example.com/"]);
  assert.deepEqual(graph.get("https://example.com/").incoming, []);
  assert.equal(graph.has("https://example.com/unchecked"), false);
  assert.deepEqual([...buildObservedLinks([...snapshot.pages].reverse())].sort(), [...graph].sort());
});
