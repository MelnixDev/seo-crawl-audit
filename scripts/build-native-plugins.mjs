import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { zipSync } from 'fflate';
import { assertPortableCodexTemplate } from './native-plugin-contracts.mjs';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(root, 'plugins/seo-crawl-audit');
const out = resolve(root, 'native-plugin-dist');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
for (const file of ['plugin.json', '.claude-plugin/plugin.json', 'manifest.json', 'package.json']) {
  const manifest = JSON.parse(await readFile(resolve(plugin, file), 'utf8'));
  if (manifest.version !== version) throw new Error(`Bump ${file} to match engine ${version} before packaging`);
}
const config = JSON.parse(await readFile(resolve(plugin, 'mcp.json'), 'utf8'));
assertPortableCodexTemplate(config);
// No install/network at runtime: use exactly the engine bundle produced by npm run build.
await mkdir(resolve(plugin, 'server'), { recursive: true });
await cp(resolve(root, 'packages/cli/bundle/mcp.js'), resolve(plugin, 'server/mcp.js'));
await cp(resolve(root, 'packages/cli/agent-skill'), resolve(plugin, 'skills'), { recursive: true });
await mkdir(resolve(plugin, 'skills/seo-crawl-audit/assets'), { recursive: true });
await cp(resolve(plugin, 'assets/logo.png'), resolve(plugin, 'skills/seo-crawl-audit/assets/logo.png'));
await cp(resolve(root, 'LICENSE'), resolve(plugin, 'LICENSE'));
await cp(resolve(root, 'docs/native-plugins.md'), resolve(plugin, 'INSTALL.md'));
await mkdir(out, { recursive: true });
const zip = `seo-crawl-audit-${version}-codex-claude-code.zip`;
const entries = {};
const allowed = new Set(['plugin.json', 'mcp.json', '.claude-plugin/plugin.json', '.mcp.json', 'manifest.json', 'package.json', 'configure.mjs', 'server/launch.mjs', 'server/mcp.js', 'skills/seo-crawl-audit/SKILL.md', 'LICENSE', 'INSTALL.md', 'assets/logo.png', 'skills/seo-crawl-audit/agents/openai.yaml', 'skills/seo-crawl-audit/assets/logo.png']);
for (const path of await readdir(plugin, { recursive: true, withFileTypes: true })) {
  if (path.isDirectory()) continue;
  if (!path.isFile()) throw new Error(`Unexpected symlink or special file in plugin: ${path.name}`);
  const absolute = resolve(path.parentPath, path.name);
  const name = relative(plugin, absolute).replaceAll('\\', '/');
  if (!allowed.has(name)) throw new Error(`Unexpected file in plugin: ${name}; refusing to package local configuration or secrets`);
  if (name !== 'manifest.json') entries[name] = await readFile(absolute);
}
await writeFile(resolve(out, zip), zipSync(entries));
const mcpb = `seo-crawl-audit-${version}-claude-desktop.mcpb`;
execFileSync(process.execPath, [resolve(root, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js'), 'pack', plugin, resolve(out, mcpb)], { stdio: 'inherit' });
for (const name of [zip, mcpb]) {
  const digest = createHash('sha256').update(await readFile(resolve(out, name))).digest('hex');
  await writeFile(resolve(out, `${name}.sha256`), `${digest}  ${name}\n`);
}
console.log(`Native plugin artifacts: ${out}`);
