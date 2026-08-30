import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getRuleDefinitions } from "../packages/core/dist/index.js";

function ruleHeadings(markdown) {
  return [...markdown.matchAll(/^### ([a-z0-9-]+)$/gm)].map((match) => match[1]);
}

test("English and Ukrainian rule references cover the same built-in rules", async () => {
  const [english, ukrainian] = await Promise.all([
    readFile(new URL("../docs/rules.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/rules.uk.md", import.meta.url), "utf8"),
  ]);
  const expected = getRuleDefinitions().map((definition) => definition.id);
  const englishRules = ruleHeadings(english);
  const ukrainianRules = ruleHeadings(ukrainian);

  assert.deepEqual(ukrainianRules, englishRules);
  assert.deepEqual(englishRules.toSorted(), expected.toSorted());
  assert.match(english, /\[Українська\]\(rules\.uk\.md\)/);
  assert.match(ukrainian, /\[English\]\(rules\.md\)/);
});

test("README report screenshots are present and linked from the npm README", async () => {
  const screenshots = [
    "report-overview.jpg",
    "report-analytics.jpg",
    "report-issues.jpg",
  ];
  const [rootReadme, packageReadme] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../packages/cli/README.md", import.meta.url), "utf8"),
  ]);

  for (const screenshot of screenshots) {
    const image = await readFile(new URL(`../docs/images/${screenshot}`, import.meta.url));

    assert.deepEqual([...image.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.match(rootReadme, new RegExp(`docs/images/${screenshot}`));
    assert.match(
      packageReadme,
      new RegExp(`raw\\.githubusercontent\\.com/MelnixDev/seo-crawl-audit/main/docs/images/${screenshot}`),
    );
  }
});
