import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { renderReport } from '../packages/core/dist/index.js';
import { PRODUCT_LOGO_DATA_URI } from '../packages/core/dist/brand.js';

test('standalone reports embed the reviewed compact crab without external brand requests', async () => {
  const bytes = await readFile('docs/brand/logo-128.jpg');
  assert.ok(bytes.length < 32 * 1024, 'display derivative must not embed the full-size source');
  assert.deepEqual(Buffer.from(PRODUCT_LOGO_DATA_URI.split(',')[1], 'base64'), bytes);
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'runtime image must be a JPEG');
  // SOF0 declares the actual image dimensions independently of its filename.
  const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof >= 0);
  assert.equal(bytes.readUInt16BE(sof + 5), 128);
  assert.equal(bytes.readUInt16BE(sof + 7), 128);
  const html = renderReport({ pages: [], issues: [], startUrl: 'https://example.com/' });
  assert.match(html, /<img class="logo product-mark" src="data:image\/jpeg;base64,[A-Za-z0-9+/=]+" width="52" height="52" alt="SEO Crawl Audit crab logo"/);
  assert.match(html, /rel="icon" href="data:image\/jpeg;base64,/);
  assert.ok(!html.includes('https://melnixdev.github.io/seo-crawl-audit/media/logo.png'));
  execFileSync(process.execPath, ['scripts/generate-brand-assets.mjs', '--check']);
});


test('brand generator check accepts CRLF checkout files but rejects changed image payloads', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'seo-brand-line-endings-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(fixture, 'scripts'), { recursive: true }),
    mkdir(join(fixture, 'docs/brand'), { recursive: true }),
    ...['core', 'cli'].map(module => mkdir(join(fixture, `packages/${module}/src`), { recursive: true })),
  ]);
  await cp('scripts/generate-brand-assets.mjs', join(fixture, 'scripts/generate-brand-assets.mjs'));
  await cp('docs/brand/logo-128.jpg', join(fixture, 'docs/brand/logo-128.jpg'));
  const originals = new Map();
  for (const module of ['core', 'cli']) {
    const text = (await readFile(`packages/${module}/src/brand.ts`, 'utf8')).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    originals.set(module, text);
    await writeFile(join(fixture, `packages/${module}/src/brand.ts`), text);
  }
  const check = () => spawnSync(process.execPath, [join(fixture, 'scripts/generate-brand-assets.mjs'), '--check'], { cwd: fixture, encoding: 'utf8' });
  const matching = check();
  assert.equal(matching.status, 0, matching.stderr);
  for (const module of ['core', 'cli']) {
    const original = originals.get(module);
    const changed = original.replace(/base64,./, 'base64,A');
    assert.notEqual(changed, original);
    await writeFile(join(fixture, `packages/${module}/src/brand.ts`), changed);
    const mismatched = check();
    assert.notEqual(mismatched.status, 0, `${module} changed payload must fail`);
    assert.match(mismatched.stderr, new RegExp(`${module} runtime brand image is out of sync`));
    await writeFile(join(fixture, `packages/${module}/src/brand.ts`), original);
  }
});
