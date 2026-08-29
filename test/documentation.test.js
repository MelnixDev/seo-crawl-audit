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
