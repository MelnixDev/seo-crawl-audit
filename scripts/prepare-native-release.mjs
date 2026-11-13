import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const base = resolve(root, 'native-plugin-dist');
const out = resolve(base, `release-${version}`);
await mkdir(out, { recursive:true });
const stems = [`seo-crawl-audit-${version}-codex-claude-code.zip`, `seo-crawl-audit-${version}-claude-desktop.mcpb`];
const sources = [
  ...stems.flatMap(name => [resolve(base, name), resolve(base, `${name}.sha256`)]),
  ...['native-workflow.mp4', 'native-report-overview.png', 'native-report-pages.png', 'native-report-issues.png', 'native-demo-report.html', 'demo-fixture.mjs'].map(name => resolve(root, 'docs/site/media', name)),
];
for (const name of ['demo-snapshot.json', 'demo-workflow-evidence.json', 'visual-qa.json', 'codex-native-cli-evidence.json', 'landing-desktop.png', 'landing-mobile.png']) sources.push(resolve(base, name));
const manifest = [];
for (const source of sources) {
  const bytes = await readFile(source);
  const name = basename(source);
  await cp(source, resolve(out, name));
  manifest.push({ name, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') });
}
for (const stem of stems) {
  const actual = manifest.find(entry => entry.name === stem);
  const expected = (await readFile(resolve(out, `${stem}.sha256`), 'utf8')).trim().split(/\s+/)[0];
  if (actual.sha256 !== expected) throw new Error(`Checksum mismatch: ${stem}`);
}
const notes = await readFile(resolve(root, `docs/releases/${version}.md`), 'utf8');
await writeFile(resolve(out, 'RELEASE-NOTES.md'), notes);
manifest.push({ name:'RELEASE-NOTES.md', bytes:Buffer.byteLength(notes), sha256:createHash('sha256').update(notes).digest('hex') });
await writeFile(resolve(out, 'SHA256SUMS.txt'), manifest.filter(entry=>!entry.name.endsWith('.sha256')).map(entry=>`${entry.sha256}  ${entry.name}`).join('\n')+'\n');
await writeFile(resolve(out, 'release-assets.json'), JSON.stringify({ version, status:'draft-not-published', nativePackagesAreSeparateFromNpm:true, assets:manifest },null,2)+'\n');
console.log(`Prepared reviewed-upload directory: ${out}`);
