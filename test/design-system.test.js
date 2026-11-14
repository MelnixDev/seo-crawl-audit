import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function luminance(hex) {
  const digits = hex.slice(1);
  const expanded = digits.length === 3 ? [...digits].map(value => value.repeat(2)).join('') : digits;
  const channels = [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test('shared theme preserves readable brand and semantic text pairs', async () => {
  const theme = JSON.parse(await readFile('design/theme.json', 'utf8'));
  for (const [foreground, background] of [
    ['ink', 'paper'], ['muted', 'paper'], ['muted', 'wash'], ['ink', 'coral'],
    ['error', 'errorWash'], ['warning', 'warningWash'], ['info', 'infoWash'], ['success', 'successWash'],
  ]) assert.ok(contrast(theme[foreground], theme[background]) >= 4.5, `${foreground}/${background} must support normal text`);
  assert.ok(contrast(theme.controlLine, theme.paper) >= 3, 'interactive control boundaries must remain visible against the surface');
  assert.ok(contrast(theme.focus, theme.paper) >= 3, 'focus indicator must remain visible against the surface');
  assert.equal(new Set(['error', 'warning', 'info', 'success'].map(key => theme[key])).size, 4, 'severity colors must remain distinct');
  assert.notEqual(theme.coral, theme.error, 'brand action must not double as an error color');
  execFileSync(process.execPath, ['scripts/generate-design-system.mjs', '--check']);
});

test('generated theme checks accept CRLF and reject module, website or source token drift', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'seo-design-tokens-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await Promise.all(['scripts', 'design', 'docs/site', 'packages/core/src', 'packages/cli/src']
    .map(directory => mkdir(join(fixture, directory), { recursive: true })));
  const files = ['scripts/generate-design-system.mjs', 'design/theme.json', 'docs/site/site.css', 'packages/core/src/design-system.ts', 'packages/cli/src/design-system.ts'];
  for (const file of files) await cp(file, join(fixture, file));
  const originals = new Map();
  for (const file of files.filter(file => file.endsWith('.ts') || file.endsWith('.css'))) {
    const text = (await readFile(join(fixture, file), 'utf8')).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    originals.set(file, text);
    await writeFile(join(fixture, file), text);
  }
  const check = () => spawnSync(process.execPath, [join(fixture, 'scripts/generate-design-system.mjs'), '--check'], { cwd: fixture, encoding: 'utf8' });
  assert.equal(check().status, 0, 'matching generated files must pass Windows line endings');
  for (const [file, text] of originals) {
    const changed = text.replace('#14243c', '#14243d');
    assert.notEqual(changed, text);
    await writeFile(join(fixture, file), changed);
    const result = check();
    assert.notEqual(result.status, 0, `${file} token drift must fail`);
    assert.match(result.stderr, /design tokens are out of sync/);
    await writeFile(join(fixture, file), text);
  }
  const website = originals.get('docs/site/site.css');
  await writeFile(join(fixture, 'docs/site/site.css'), `${website}\n:root{--ink : #000;}`);
  const override = check();
  assert.notEqual(override.status, 0);
  assert.match(override.stderr, /Website overrides shared design token: ink/);
  await writeFile(join(fixture, 'docs/site/site.css'), website);
  const theme = JSON.parse(await readFile(join(fixture, 'design/theme.json'), 'utf8'));
  theme.unrecognized = 'url(https://example.com/font)';
  await writeFile(join(fixture, 'design/theme.json'), JSON.stringify(theme));
  const result = check();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixed product contract/);
});
