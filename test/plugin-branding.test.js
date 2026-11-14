import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';

const plugin = resolve('plugins/seo-crawl-audit');
const json = async path => JSON.parse(await readFile(path, 'utf8'));

function assertLogoPng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'logo must be a real PNG');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.equal(width, height, 'plugin directory artwork must be square');
  assert.ok(width >= 512, 'source logo must remain legible at high density');
  assert.ok(bytes.length < 5 * 1024 * 1024, 'plugin image must stay below the submission limit');
}

test('all plugin surfaces reference the packaged brand artwork', async () => {
  const portable = await json(`${plugin}/plugin.json`);
  const openai = portable.extensions['com.openai'].interface;
  const claude = await json(`${plugin}/.claude-plugin/plugin.json`);
  const desktop = await json(`${plugin}/manifest.json`);
  assert.equal(openai.logo, './assets/logo.png');
  assert.equal(openai.composerIcon, './assets/logo.png');
  assert.equal(openai.brandColor, '#f05a40');
  assert.equal(claude.icon, './assets/logo.png');
  assert.equal(desktop.icon, 'assets/logo.png');
  const logo = await readFile(`${plugin}/assets/logo.png`);
  assertLogoPng(logo);
  assert.deepEqual(await readFile('packages/cli/agent-skill/seo-crawl-audit/assets/logo.png'), logo);
  const skillInterface = await readFile('packages/cli/agent-skill/seo-crawl-audit/agents/openai.yaml', 'utf8');
  for (const field of ['icon_small', 'icon_large']) assert.match(skillInterface, new RegExp(`${field}: "\\./assets/logo\\.png"`));
  assert.deepEqual(await readFile(`${plugin}/skills/seo-crawl-audit/agents/openai.yaml`), Buffer.from(skillInterface));
  assert.deepEqual(await readFile(`${plugin}/skills/seo-crawl-audit/assets/logo.png`), logo);

  const { version } = await json('package.json');
  for (const suffix of ['codex-claude-code.zip', 'claude-desktop.mcpb']) {
    const archive = unzipSync(await readFile(`native-plugin-dist/seo-crawl-audit-${version}-${suffix}`));
    for (const path of ['assets/logo.png', 'skills/seo-crawl-audit/assets/logo.png']) {
      assert.ok(archive[path], `${suffix} must include ${path}`);
      assert.deepEqual(Buffer.from(archive[path]), logo, 'installed client must receive the reviewed artwork bytes');
    }
    assert.deepEqual(Buffer.from(archive['skills/seo-crawl-audit/agents/openai.yaml']), Buffer.from(skillInterface));
    const rootManifest = JSON.parse(Buffer.from(archive['plugin.json']).toString());
    assert.equal(rootManifest.extensions['com.openai'].interface.logo, openai.logo);
    if (suffix.endsWith('.mcpb')) assert.equal(JSON.parse(Buffer.from(archive['manifest.json']).toString()).icon, desktop.icon);
  }
});
