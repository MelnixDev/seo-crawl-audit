import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalComparison, migrateSnapshot } from "../packages/core/dist/index.js";
import { comparisonCsv, comparisonMarkdown } from "../packages/cli/dist/local-ui-comparison-export.js";

test("comparison exports escape spreadsheet formulas and Markdown controls", () => {
  const baseline = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [{ url: "https://example.com/", status: 200 }] });
  const summary = buildLocalComparison(baseline, baseline, { evaluatedAt: "2026-09-27T00:00:00.000Z" }).summary;
  summary.byRule.push({ id: '=HYPERLINK("https://evil.example")', counts: { new: 1, ongoing: 0, resolved: 0, unchanged: 0 }, affectedPages: 1 });
  summary.byTemplate.push({ id: "a|[bad]<script>", counts: { new: 0, ongoing: 1, resolved: 0, unchanged: 0 }, affectedPages: 1 });
  const csv = comparisonCsv(summary);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/evil\.example""\)"/);
  assert.match(csv, /"template","a\|\[bad\]<script>"/);
  const markdown = comparisonMarkdown(summary);
  assert.match(markdown, /a\\\|\\\[bad\\\]&lt;script&gt;/);
  assert.doesNotMatch(markdown, /<script>/);
  assert.match(markdown, /\[Full HTML report\]\(\.\/comparison\)/);
});
