import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, access, writeFile, realpath, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { unzipSync } from 'fflate';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertPortableCodexTemplate } from '../scripts/native-plugin-contracts.mjs';

const plugin = resolve('plugins/seo-crawl-audit');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const entry = join(plugin, 'server/launch.mjs');
const generated = [];
const temp = async (label) => { const path = await realpath(await mkdtemp(join(tmpdir(), `seo-native-${label}-`))); generated.push(path); return path; };
test.after(async () => { for (const path of generated) await rm(path, { recursive:true, force:true }); });

function connect(args, env, cwd, executable = process.execPath) {
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe','pipe','pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const pending = new Map();
  let id = 0;
  createInterface({ input: child.stdout }).on('line', line => {
    const value = JSON.parse(line);
    if (value.id) { const p = pending.get(value.id); pending.delete(value.id); p?.resolve(value); }
  });
  child.once('exit', code => { for (const p of pending.values()) p.reject(new Error(`MCP exited ${code}: ${stderr}`)); });
  return {
    child,
    async request(method, params = {}) {
      const requestId = ++id;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}: ${stderr}`)); }, 20000);
        pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: e => { clearTimeout(timer); reject(e); } });
        child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:requestId, method, params })+'\n');
      });
      assert.equal(result.error, undefined, JSON.stringify(result));
      return result.result;
    },
    async tool(name, args) { return this.request('tools/call', { name, arguments:args }); },
    close() { child.kill(); },
  };
}
const value = result => { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text); };

test('portable schemas, MCPB authoritative validator and pinned engine versions', async () => {
  const ajv = new Ajv2020({ strict: false });
  for (const name of ['plugin','mcp']) {
    const validate = ajv.compile(await json(`scripts/plugin-schemas/${name}.schema.json`));
    assert.ok(validate(await json(join(plugin, `${name}.json`))), JSON.stringify(validate.errors));
    const invalid = await json(join(plugin, `${name}.json`));
    if (name === 'mcp') delete invalid.mcpServers['seo-crawl-audit'].type;
    else invalid.name = '../escape';
    assert.equal(validate(invalid), false, 'canonical schema must reject incompatible shapes');
  }
  const template = await json(join(plugin, 'mcp.json'));
  assertPortableCodexTemplate(template);
  template.mcpServers['seo-crawl-audit'].command = process.execPath;
  // Clearing a workspace must not allow a personal runtime path into a public archive.
  template.mcpServers['seo-crawl-audit'].env.SEO_AUDIT_MCP_ROOT = '';
  assert.throws(() => assertPortableCodexTemplate(template), /portable.*node/);
  const {version} = await json('package.json');
  for (const name of ['plugin.json','.claude-plugin/plugin.json','manifest.json','package.json']) assert.equal((await json(join(plugin,name))).version,version);
  execFileSync(process.execPath,['node_modules/@anthropic-ai/mcpb/dist/cli/cli.js','validate',join(plugin,'manifest.json')]);
  const original = await readFile('packages/cli/bundle/mcp.js');
  assert.deepEqual(await readFile(join(plugin,'server/mcp.js')),original);
  assert.deepEqual(await readFile(join(plugin,'skills/seo-crawl-audit/SKILL.md')),await readFile('packages/cli/agent-skill/seo-crawl-audit/SKILL.md'));
  for (const catalog of ['.agents/plugins/marketplace.json','.claude-plugin/marketplace.json']) {
    const marketplace=await json(catalog);
    const source=marketplace.plugins[0].source;
    assert.equal(resolve(typeof source==='string'?source:source.path),plugin);
  }
  const zip = `native-plugin-dist/seo-crawl-audit-${version}-codex-claude-code.zip`;
  const mcpb = `native-plugin-dist/seo-crawl-audit-${version}-claude-desktop.mcpb`;
  for(const artifact of [zip,mcpb]) {
    const names=Object.keys(unzipSync(await readFile(artifact)));
    for(const required of ['server/mcp.js','server/launch.mjs','skills/seo-crawl-audit/SKILL.md']) assert.ok(names.includes(required));
    assert.ok(!names.some(name=>name.startsWith('node_modules/')||name.includes('.env')));
  }
});

for (const adapter of ['codex','claude-code','claude-desktop']) test(`${adapter}: real stdio plan/scan/issues/report lifecycle and workspace containment`, async t => {
  const root=await temp(adapter);
  const installed=join(await temp('install'),'plugin');
  const {version}=await json('package.json');
  const artifact=resolve(`native-plugin-dist/seo-crawl-audit-${version}-${adapter==='claude-desktop'?'claude-desktop.mcpb':'codex-claude-code.zip'}`);
  for(const [name,bytes] of Object.entries(unzipSync(await readFile(artifact)))) {
    const path=join(installed,name);
    const {dirname}=await import('node:path');
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,bytes);
  }
  const http=createServer((req,res)=>{
    if(req.url==='/robots.txt') return res.end('User-agent: *\nAllow: /\n');
    res.setHeader('content-type','text/html');
    res.end('<!doctype html><html lang="en"><head><title>Fixture</title></head><body><p>Example</p></body></html>');
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(()=>http.close());
  const replacements={ '${PLUGIN_ROOT}':installed, '${CLAUDE_PLUGIN_ROOT}':installed, '${CLAUDE_PROJECT_DIR}':root, '${__dirname}':installed, '${user_config.workspace}':root };
  if(adapter==='codex') execFileSync(process.execPath,[join(installed,'configure.mjs'),root]);
  const config=await json(join(installed,adapter==='codex'?'mcp.json':adapter==='claude-code'?'.mcp.json':'manifest.json'));
  const server=adapter==='claude-desktop'?config.server.mcp_config:config.mcpServers['seo-crawl-audit'];
  const expand=s=>Object.entries(replacements).reduce((s,[key,v])=>s.replaceAll(key,v),s);
  const runtimeEnv=Object.fromEntries(Object.entries(server.env).map(([k,v])=>[k,expand(v)]));
  if(adapter==='codex') { assert.equal(server.command,process.execPath); runtimeEnv.PATH=''; }
  const client=connect(server.args.map(expand),runtimeEnv,installed,adapter==='codex'?server.command:process.execPath);
  t.after(()=>client.close());
  const initialized=await client.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:adapter,version:'1'}});
  assert.equal(initialized.serverInfo.version,(await json('package.json')).version);
  client.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.equal((await client.request('tools/list')).tools.length,8);
  assert.ok(initialized.instructions.includes(root));
  if(adapter==='codex') {
    assert.equal((await client.tool('seo_audit_scan',{workspace:'/another-project',url:'https://example.com'})).isError,true);
    assert.equal((await client.tool('seo_audit_plan',{url:'https://example.com'})).isError,true);
  }
  const binding=adapter==='codex'?{workspace:root}:{};
  const common={...binding,url:`http://127.0.0.1:${http.address().port}/`,sitemap:'none',delay:0,maxPages:1};
  assert.equal(value(await client.tool('seo_audit_plan',common)).mode,'links');
  const scan=value(await client.tool('seo_audit_scan',{...common,output:'baseline.json',report:'scan.html'}));
  assert.equal(scan.pages,1);
  assert.equal(scan.artifacts.snapshot,'baseline.json');
  await access(join(root,'baseline.json'));
  await assert.rejects(access(join(installed,'baseline.json')));
  const issues=value(await client.tool('seo_audit_issues',{...binding,snapshot:'baseline.json',limit:1}));
  assert.equal(issues.limit,1); assert.ok(issues.issues.length<=1);
  assert.equal(typeof issues.hasMore,'boolean');
  const report=value(await client.tool('seo_audit_report',{...binding,snapshot:'baseline.json',output:'reports/rendered.html'}));
  assert.equal(report.report,join('reports','rendered.html'));
  await access(join(root,'reports/rendered.html'));
  for (const output of ['../escape.html',join(installed,'escape.html')]) {
    const denied=await client.tool('seo_audit_report',{...binding,snapshot:'baseline.json',output});
    assert.equal(denied.isError,true);
  }
  const outside=await temp('outside');
  await symlink(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir');
  assert.equal((await client.tool('seo_audit_report',{...binding,snapshot:'baseline.json',output:'linked/escape.html'})).isError,true);
});

test('missing, relative, unresolved and installation workspace config fails closed',async()=>{
  for(const root of ['', '.', '${user_config.workspace}',plugin,join(plugin,'server'),dirname(plugin)]) {
    const child=spawn(process.execPath,[entry],{cwd:plugin,env:{...process.env,SEO_AUDIT_MCP_ROOT:root},stdio:['pipe','pipe','pipe']});
    let stdout=''; let stderr='';
    child.stdout.on('data',s=>{stdout+=s;}); child.stderr.on('data',s=>{stderr+=s;});
    child.stdin.end();
    const code=await new Promise(resolve=>child.on('close',resolve));
    assert.equal(code,2); assert.equal(stdout,''); assert.match(stderr,/workspace/i);
  }
});

test('Codex configuration can be reapplied to an updated package without moving reports',async()=>{
  const workspace=await temp('consumer with spaces');
  const installed=join(await temp('update'),'plugin');
  await cp(plugin,installed,{recursive:true});
  assert.throws(()=>execFileSync(process.execPath,[join(installed,'configure.mjs'),dirname(installed)],{stdio:'pipe'}), /non-overlapping/);
  const configure=()=>execFileSync(process.execPath,[join(installed,'configure.mjs'),workspace]);
  configure();
  const configured=(await json(join(installed,'mcp.json'))).mcpServers['seo-crawl-audit'];
  assert.equal(configured.env.SEO_AUDIT_MCP_ROOT,workspace);
  assert.equal(configured.command,process.execPath);
  await writeFile(join(workspace,'report.html'),'retained');
  await cp(join(plugin,'mcp.json'),join(installed,'mcp.json'));
  configure();
  assert.equal(await readFile(join(workspace,'report.html'),'utf8'),'retained');
  // Verify the launcher changes CWD before dynamically importing its bundled runtime.
  await writeFile(join(installed,'server/mcp.js'),'export async function serve(){ console.log(JSON.stringify({cwd:process.cwd(),root:process.env.SEO_AUDIT_MCP_ROOT})); }');
  const refreshed=(await json(join(installed,'mcp.json'))).mcpServers['seo-crawl-audit'];
  assert.equal(refreshed.command,process.execPath);
  const result=execFileSync(refreshed.command,[join(installed,'server/launch.mjs')],{cwd:installed,env:{...process.env,...refreshed.env,PATH:''},encoding:'utf8'});
  assert.deepEqual(JSON.parse(result),{cwd:workspace,root:workspace});
});
