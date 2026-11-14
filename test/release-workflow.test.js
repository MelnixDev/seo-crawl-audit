import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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


test("release verification refuses accidental standalone renderer publication", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "seo-renderer-release-policy-"));
  try {
    for (const relative of ["package.json", ...["core", "cli", "action", "mcp", "renderer-playwright"].map(name => `packages/${name}/package.json`)]) {
      const value = JSON.parse(await readFile(relative, "utf8"));
      if (relative.includes("renderer-playwright")) value.private = false;
      const target = path.join(fixture, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(value));
    }
    const root = JSON.parse(await readFile("package.json", "utf8"));
    const result = spawnSync(process.execPath, ["scripts/verify-release-tag.mjs", `v${root.version}`, fixture], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /renderer workspace must remain private/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
