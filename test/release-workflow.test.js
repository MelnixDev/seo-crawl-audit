import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("npm publishing uses OIDC and cannot run for the moving v0 tag", async () => {
  const workflow = await readFile(".github/workflows/publish.yml", "utf8");

  assert.match(workflow, /tags: \["v\*\.\*\.\*"\]/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /automation\/scripts\/verify-release-tag\.mjs "\$RELEASE_TAG" source/);
  assert.match(workflow, /Checkout immutable release source/);
  assert.match(workflow, /working-directory: source/);
  assert.match(workflow, /publish --workspace seo-crawl-audit --access public/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  assert.doesNotMatch(workflow, /publish --workspace @seo-crawl-audit\/core/);
});

test("release tag verification locks all workspace versions", async () => {
  const root = JSON.parse(await readFile("package.json", "utf8"));
  const valid = spawnSync(process.execPath, ["scripts/verify-release-tag.mjs", `v${root.version}`], {
    encoding: "utf8",
  });
  const moving = spawnSync(process.execPath, ["scripts/verify-release-tag.mjs", "v0"], {
    encoding: "utf8",
  });

  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /only seo-crawl-audit@/);
  assert.notEqual(moving.status, 0);
  assert.match(moving.stderr, /vMAJOR\.MINOR\.PATCH/);
});

test("release verification can inspect a separately checked-out source tree", async () => {
  const root = JSON.parse(await readFile("package.json", "utf8"));
  const nested = spawnSync(
    process.execPath,
    ["scripts/verify-release-tag.mjs", `v${root.version}`, "."],
    { encoding: "utf8" },
  );

  assert.equal(nested.status, 0, nested.stderr);
  assert.match(nested.stdout, /is publishable/);
});
