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
  const screenshots = new Map([
    ["report-overview.png", [2598, 1380]],
    ["report-analytics.png", [2580, 1128]],
    ["report-issues.png", [2904, 1306]],
  ]);
  const [rootReadme, packageReadme] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../packages/cli/README.md", import.meta.url), "utf8"),
  ]);

  for (const [screenshot, [width, height]] of screenshots) {
    const image = await readFile(new URL(`../docs/images/${screenshot}`, import.meta.url));

    assert.deepEqual(
      [...image.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
    assert.match(rootReadme, new RegExp(`docs/images/${screenshot}`));
    assert.match(
      packageReadme,
      new RegExp(`raw\\.githubusercontent\\.com/MelnixDev/seo-crawl-audit/main/docs/images/${screenshot}`),
    );
  }

  assert.doesNotMatch(rootReadme, /docs\/images\/report-(?:overview|analytics|issues)\.jpg/);
  assert.doesNotMatch(packageReadme, /docs\/images\/report-(?:overview|analytics|issues)\.jpg/);
});

test("release documentation matches the current distribution boundary", async () => {
  const [rootManifest, coreManifest, rootReadme, coreApi, changelog] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../packages/core/package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/public-api.md", import.meta.url), "utf8"),
    readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"),
  ]);
  const releaseNotes = await readFile(
    new URL(`../docs/releases/${rootManifest.version}.md`, import.meta.url),
    "utf8",
  );

  assert.equal(coreManifest.private, true);
  assert.match(rootReadme, /core` is currently an internal workspace package/);
  assert.match(coreApi, /not\s+available as a standalone npm install/);
  assert.match(changelog, new RegExp(`^## ${rootManifest.version.replaceAll(".", "\\.")} `, "m"));
  assert.match(releaseNotes, new RegExp(`^# SEO Crawl Audit ${rootManifest.version.replaceAll(".", "\\.")}$`, "m"));
});

test("repository and npm documentation describe safe project initialization", async () => {
  const [rootReadme, packageReadme, initialization, actionGuide] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../packages/cli/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/initialization.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/github-action.md", import.meta.url), "utf8"),
  ]);

  for (const readme of [rootReadme, packageReadme]) {
    assert.match(readme, /seo-audit init https:\/\/example\.com\//);
    assert.match(readme, /--workflow scheduled/);
    assert.match(readme, /--force/);
  }
  assert.match(initialization, /does not ignore `\.seo-audit\.json`/);
  assert.match(initialization, /does not replace\r?\n  an existing config or workflow/);
  assert.match(actionGuide, /CMS publishing/);
  assert.match(actionGuide, /SEO_AUDIT_PREVIEW_URL/);
});

test("repository and npm documentation explain project diagnostics", async () => {
  const [rootReadme, packageReadme, doctorGuide] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../packages/cli/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/doctor.md", import.meta.url), "utf8"),
  ]);

  for (const readme of [rootReadme, packageReadme]) {
    assert.match(readme, /seo-audit doctor --offline/);
    assert.match(readme, /site can use any server stack/);
  }
  assert.match(doctorGuide, /Node\.js is required by the local CLI, not by the audited website/);
  assert.match(doctorGuide, /No linked HTML pages are crawled/);
  assert.match(doctorGuide, /^1    One or more diagnostic checks failed$/m);
});

test("authenticated scan documentation covers CLI, Action, and secret isolation", async () => {
  const [rootReadme, packageReadme, guide, actionGuide] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../packages/cli/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/authenticated-scans.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/github-action.md", import.meta.url), "utf8"),
  ]);
  for (const readme of [rootReadme, packageReadme]) {
    assert.match(readme, /--headers-env SEO_AUDIT_SITE_HEADERS/);
  }
  assert.match(guide, /A redirect or sitemap hosted on another origin does not receive/);
  assert.match(guide, /secrets\.SEO_AUDIT_SITE_HEADERS/);
  assert.match(actionGuide, /authenticated scans guide/);
});
