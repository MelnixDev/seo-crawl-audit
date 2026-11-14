import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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
