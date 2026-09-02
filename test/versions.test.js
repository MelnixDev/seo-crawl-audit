import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ENGINE_VERSION, RULE_SET_VERSION, renderReport } from "../packages/core/dist/index.js";
import { DEFAULT_USER_AGENT } from "../packages/core/dist/version.js";

async function manifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("manifests, user agent, and reports use centralized versions", async () => {
  const [root, core, cli, action] = await Promise.all([
    manifest("package.json"),
    manifest("packages/core/package.json"),
    manifest("packages/cli/package.json"),
    manifest("packages/action/package.json"),
  ]);
  assert.equal(ENGINE_VERSION, "0.8.0");
  assert.equal(RULE_SET_VERSION, "1.1.0");
  assert.deepEqual([root.version, core.version, cli.version, action.version], Array(4).fill(ENGINE_VERSION));
  assert.equal(cli.devDependencies["@seo-crawl-audit/core"], ENGINE_VERSION);
  assert.equal(action.devDependencies["@seo-crawl-audit/core"], ENGINE_VERSION);
  assert.equal(DEFAULT_USER_AGENT, `seo-crawl-audit/${ENGINE_VERSION}`);
  const html = renderReport({ pages: [], issues: [] });
  assert.match(html, new RegExp(`id="engine-label">Engine<\\/span> ${ENGINE_VERSION.replaceAll(".", "\\.")}`));
  assert.match(html, new RegExp(`id="rules-label">Rules<\\/span> ${RULE_SET_VERSION.replaceAll(".", "\\.")}`));
});
