import test from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';

// Opt in with the actual installed Codex binary. No Codex account or model call is used.
// This checks native loader restrictions that standalone MCP tests cannot exercise.
const codex = process.env.CODEX_NATIVE_TEST_BINARY;
test('Codex native loader discovers plugin tools and scans with an empty inherited PATH', { skip: !codex, timeout: 120000 }, async t => {
  assert.ok(codex && resolve(codex) === codex, 'CODEX_NATIVE_TEST_BINARY must be absolute');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'seo-codex-native-')));
  const workspace = join(root, 'consumer with spaces');
  const marketplace = join(root, 'marketplace');
  const installedSource = join(marketplace, 'plugins/seo-crawl-audit');
  const profile = join(root, 'codex-profile');
  await Promise.all([mkdir(workspace), mkdir(profile), mkdir(join(marketplace, '.agents/plugins'), { recursive: true })]);
  let child;
  let server;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await cp(resolve('plugins/seo-crawl-audit'), installedSource, { recursive: true });
  execFileSync(process.execPath, [join(installedSource, 'configure.mjs'), workspace]);
  await writeFile(join(marketplace, '.agents/plugins/marketplace.json'), JSON.stringify({
    name: 'seo-native-loader-test',
    interface: { displayName: 'SEO native loader test' },
    plugins: [{ name: 'seo-crawl-audit', source: { source: 'local', path: './plugins/seo-crawl-audit' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }],
  }));
  const env = { ...process.env, CODEX_HOME: profile, PATH: '' };
  execFileSync(codex, ['plugin', 'marketplace', 'add', marketplace, '--json'], { cwd: workspace, env });
  const installation = JSON.parse(execFileSync(codex, ['plugin', 'add', 'seo-crawl-audit@seo-native-loader-test', '--json'], { cwd: workspace, env, encoding: 'utf8' }));
  const installedConfig = JSON.parse(await readFile(join(installation.installedPath, 'mcp.json'), 'utf8'));
  assert.equal(installedConfig.mcpServers['seo-crawl-audit'].command, 'node');
  assert.equal(installedConfig.mcpServers['seo-crawl-audit'].env.PATH, dirname(process.execPath));
  server = createServer((request, response) => {
    if (request.url === '/robots.txt') return response.end('User-agent: *\nAllow: /\n');
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html lang="en"><head><title>Native Codex fixture</title></head><body><h1>Fixture</h1></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  child = spawn(codex, ['app-server', '--stdio'], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const pending = new Map();
  let nextId = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  child.on('exit', code => { for (const request of pending.values()) request.reject(new Error(`Codex exited ${code}: ${stderr}`)); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, 30000);
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  await rpc('initialize', { clientInfo: { name: 'seo-native-loader-test', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const skills = await rpc('skills/list', { cwds: [workspace], forceReload: true });
  const skill = skills.data[0].skills.find(skill => skill.pluginId === 'seo-crawl-audit@seo-native-loader-test' && skill.enabled);
  assert.ok(skill, 'native loader must expose the plugin skill');
  assert.equal(skill.interface.displayName, 'SEO Crawl Audit');
  for (const icon of [skill.interface.iconSmall, skill.interface.iconLarge]) {
    assert.ok(icon && icon.startsWith(installation.installedPath), 'native skill icon must resolve inside the installed plugin');
    await access(icon);
  }
  const thread = await rpc('thread/start', { cwd: workspace, ephemeral: true });
  const threadId = thread.thread.id;
  const status = await rpc('mcpServerStatus/list', { threadId });
  const pluginServer = status.data.find(server => server.pluginId === 'seo-crawl-audit@seo-native-loader-test');
  assert.ok(pluginServer, `native loader must expose MCP server: ${stderr}`);
  assert.equal(pluginServer.toolsError, null);
  assert.equal(Object.keys(pluginServer.tools).length, 8);
  const call = (tool, args) => rpc('mcpServer/tool/call', { threadId, server: pluginServer.name, tool, arguments: args });
  const scan = await call('seo_audit_scan', { workspace, url: `http://127.0.0.1:${server.address().port}/`, sitemap: 'none', maxPages: 1, delay: 0, output: 'baseline.json', report: 'scan.html' });
  assert.ok(!scan.isError, JSON.stringify(scan));
  assert.equal(JSON.parse(scan.content[0].text).pages, 1);
  await access(join(workspace, 'baseline.json'));
  await access(join(workspace, 'scan.html'));
  assert.equal((await call('seo_audit_plan', { workspace: root, url: 'https://example.com' })).isError, true);
  assert.doesNotMatch(stderr, /failed to parse plugin MCP server/);
});
