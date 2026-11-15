import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { migrateSnapshot, planRetry, selectRetryUrls, retryOutcome, scan, diff, renderReport } from '../packages/core/dist/index.js';
import { createFileCheckpointStore, readSnapshot, writeSnapshot } from '../packages/core/dist/node.js';
import { planTool, scanTool } from '../packages/mcp/dist/tools.js';

function baseline(pages, origin='https://example.com') {
  return migrateSnapshot({ schemaVersion:2, urlObservationVersion:1, siteUrl:origin+'/', generatedAt:'2026-11-15T00:00:00Z', config:{url:origin+'/',sitemap:'none',includeQuery:true,trailingSlash:'preserve',delay:0,maxPages:100}, pages:pages.map(p=>({url:origin+p.path,...p})) });
}
const html='<html lang="en"><head><title>Recovered page</title></head><body><h1>Recovered</h1><a href="/healthy">Healthy</a><a href="/extra">Extra</a></body></html>';
function fixture(requests, robots='User-agent: *\nAllow: /\n') {
  return async input=>{
    const url=String(input);requests.push(new URL(url).pathname+new URL(url).search);
    const response=new Response(url.endsWith('/robots.txt')?robots:html,{status:200,headers:{'content-type':'text/html'}});
    Object.defineProperty(response,'url',{value:url});return response;
  };
}
async function temp(t) { const p=await mkdtemp(join(tmpdir(),'seo-retry-'));t.after(()=>rm(p,{recursive:true,force:true}));return p; }

test('retry defaults select HTTP/network failures, preserve query/slash and ignore robot exclusions',()=>{
  const old=baseline([{path:'/ok',status:200},{path:'/gone',status:410},{path:'/fail/?page=1',status:503},{path:'/offline',status:null,error:'offline'},{path:'/blocked',status:null,blockedByRobots:true,error:'blocked'}]);
  const before=JSON.stringify(old);
  assert.deepEqual(selectRetryUrls([old]).urls,['https://example.com/fail/?page=1','https://example.com/gone','https://example.com/offline']);
  assert.deepEqual(selectRetryUrls([old],{statuses:[503]}).urls,['https://example.com/fail/?page=1']);
  assert.equal(selectRetryUrls([old],{statuses:[503],networkErrors:true}).urls.length,2);
  assert.equal(JSON.stringify(old),before);
});

test('retry merges overlapping observations by time and rejects invalid scope before fetching',async()=>{
  const old=baseline([{path:'/a',status:503}]);
  const current={...baseline([{path:'/a',status:200}]),generatedAt:'2026-11-15T01:00:00Z'};
  assert.equal(selectRetryUrls([current,old]).urls.length,0);
  assert.throws(()=>selectRetryUrls([]),/at least one/);
  assert.throws(()=>selectRetryUrls([{...old,generatedAt:'invalid'}]),/valid generatedAt/);
  assert.equal(selectRetryUrls([{...current,generatedAt:'2026-11-15T03:00:00+02:00'},old]).urls.length,0);
  for(const statuses of [[],[200],[600],[503.5]]) assert.throws(()=>selectRetryUrls([old],{statuses}),/400 to 599/);
  assert.throws(()=>selectRetryUrls([old,baseline([], 'https://other.example')]),/same origin/);
  const escaped={...old,pages:[{...old.pages[0],url:'https://other.example/private'}]};
  await assert.rejects(planRetry([escaped],{fetch:()=>{throw Error('must not fetch');}}),/source origin/);
  await assert.rejects(planRetry([old],{config:{url:'https://other.example/'}}),/source origin/);
});

test('retry crawls only selected URLs, never healthy links or a sitemap, and labels partial coverage',async()=>{
  const old=baseline([{path:'/healthy',status:200},{path:'/a/?page=1',status:503},{path:'/b/',status:503}]);
  const requests=[];const fetch=fixture(requests);
  const plan=await planRetry([old],{statuses:[503],fetch});
  assert.equal(plan.mode,'retry');assert.equal(plan.candidateCount,2);
  const result=await scan(plan,{fetch});
  assert.deepEqual(requests,['/robots.txt','/a/?page=1','/b/']);
  assert.equal(result.snapshot.truncated,true);
  assert.deepEqual(retryOutcome(result.pages),{recovered:2,stillFailing:0,blocked:0});
  assert.match(renderReport({retry:result.snapshot.retry,pages:result.pages}),/Targeted retry/);
});

test('empty retry performs zero network requests; robot exclusion still applies',async()=>{
  const healthy=baseline([{path:'/ok',status:200}]);
  const fetch=()=>{throw Error('empty retry must not fetch');};
  const empty=await scan(await planRetry([healthy],{fetch}),{fetch});assert.equal(empty.pages.length,0);
  const requests=[];const blockedFetch=fixture(requests,'User-agent: *\nDisallow: /blocked\n');
  const old=baseline([{path:'/blocked',status:503}]);
  const blocked=await scan(await planRetry([old],{fetch:blockedFetch}),{fetch:blockedFetch});
  assert.deepEqual(requests,['/robots.txt']);assert.equal(retryOutcome(blocked.pages).blocked,1);
});

test('bounded retries do not resolve or mark missing unvisited failures',async()=>{
  const old=baseline([{path:'/a',status:503},{path:'/b',status:503}]);
  const fetch=fixture([]);const result=await scan(await planRetry([old],{fetch}),{fetch,limit:1});
  const comparison=diff(old,result.snapshot);
  assert.equal(comparison.complete,false);
  assert.ok(!comparison.resolvedIssues.some(i=>i.url.endsWith('/b')));
  assert.ok(!comparison.newIssues.some(i=>i.ruleId==='page-missing'));
});

test('checkpoint reuse is bound to the exact retry selection and persisted scope survives read/report',async t=>{
  const root=await temp(t);const checkpoint=createFileCheckpointStore(join(root,'checkpoint.ndjson'));
  const requests=[];const fetch=fixture(requests);
  const a=baseline([{path:'/a',status:503},{path:'/b',status:503}]);
  const b=baseline([{path:'/a',status:503},{path:'/c',status:503}]);
  await scan(await planRetry([a],{fetch}),{fetch,limit:1,checkpointStore:checkpoint,retainCheckpoint:true});
  const result=await scan(await planRetry([b],{fetch}),{fetch,limit:1,checkpointStore:checkpoint,retainCheckpoint:true});
  assert.equal(requests.filter(x=>x==='/a').length,2);
  await writeSnapshot(join(root,'retry.json'),result.snapshot);
  const read=await readSnapshot(join(root,'retry.json'));assert.deepEqual(read.retry,result.snapshot.retry);assert.equal(read.truncated,true);
});

test('MCP retry supports multiple snapshots, count/limit summaries and immutable source files',async t=>{
  const root=await temp(t);const a=baseline([{path:'/healthy',status:200},{path:'/a',status:503}]);const b=baseline([{path:'/b',status:503}]);
  await writeSnapshot(join(root,'a.json'),a);await writeSnapshot(join(root,'b.json'),b);
  const bytes=await readFile(join(root,'a.json'),'utf8');const requests=[];const context={root,fetch:fixture(requests)};
  const input={retryFrom:['a.json','b.json'],retryStatuses:[503],delay:0,maxPages:1};
  const plan=await planTool(context,input);assert.equal(plan.retry.selected,2);
  const result=await scanTool(context,input);assert.equal(result.retry.checked,1);assert.equal(result.retry.remaining,1);assert.equal(result.outcome.recovered,1);
  assert.equal(result.retry.siteCoverageComplete,false);assert.equal(await readFile(join(root,'a.json'),'utf8'),bytes);
  assert.ok(!requests.includes('/healthy'));assert.ok(result.artifacts.snapshot.endsWith('.seo-audit.retry.json'));
  await assert.rejects(scanTool(context,{...input,output:'a.json'}),/overwrite a source/);
  await assert.rejects(scanTool(context,{...input,report:'a.json'}),/overwrite a source/);
  await assert.rejects(scanTool(context,{...input,fullSitemap:true}),/fullSitemap/);
  await assert.rejects(planTool(context,{retryStatuses:[503]}),/require retryFrom/);
  await assert.rejects(planTool(context,{...input,trailingSlash:'strip'}),/preserves observed/);
  await assert.rejects(planTool(context,{retryFrom:'../escape.json'}),/workspace/);
  if(process.platform!=='win32') {
    await symlink(join(root,'a.json'),join(root,'alias.json'));
    await assert.rejects(scanTool(context,{...input,output:'alias.json'}),/overwrite a source/);
    await link(join(root,'a.json'),join(root,'hardlink.json'));
    await assert.rejects(scanTool(context,{...input,report:'hardlink.json'}),/overwrite a source/);
  }
});

test('MCP empty retry reports zero selected/checked and does not request the site',async t=>{
  const root=await temp(t);await writeSnapshot(join(root,'source.json'),baseline([{path:'/ok',status:200}]));
  const context={root,fetch:()=>{throw Error('no network');}};
  const result=await scanTool(context,{retryFrom:'source.json'});assert.equal(result.pages,0);assert.equal(result.retry.selected,0);
});

test('large retry confirmations bind exact targets and filters before any page request',async t=>{
  const root=await temp(t);const source=join(root,'source.json');const requests=[];
  const snapshot=baseline(Array.from({length:5001},(_,i)=>({path:'/failed/'+i,status:503})));
  await writeSnapshot(source,snapshot);
  const context={root,fetch:fixture(requests)};
  const input={retryFrom:'source.json',retryStatuses:[503],maxPages:5001,delay:0};
  const first=await scanTool(context,input);assert.equal(first.requiresConfirmation,true);
  const changedFilter=await scanTool(context,{...input,retryStatuses:[500,503],confirmLargeScan:true,confirmationId:first.confirmationId});
  assert.equal(changedFilter.requiresConfirmation,true);assert.notEqual(changedFilter.confirmationId,first.confirmationId);
  snapshot.pages[0].url='https://example.com/changed';await writeSnapshot(source,snapshot);
  const changedTarget=await scanTool(context,{...input,confirmLargeScan:true,confirmationId:first.confirmationId});
  assert.equal(changedTarget.requiresConfirmation,true);assert.notEqual(changedTarget.confirmationId,first.confirmationId);
  assert.ok(requests.every(url=>url==='/robots.txt'));
});

test('cancelled retry resumes remaining selected pages, not healthy linked pages',async t=>{
  const root=await temp(t);const store=createFileCheckpointStore(join(root,'checkpoint.ndjson'));
  const old=baseline([{path:'/a',status:503},{path:'/b',status:503}]);
  const requests=[];const fetch=fixture(requests);const controller=new AbortController();
  const plan=await planRetry([old],{fetch,config:{concurrency:1}});
  const interrupted=await scan(plan,{fetch,signal:controller.signal,checkpointStore:store,retainCheckpoint:true,onBatch(){controller.abort();}});
  assert.equal(interrupted.partial,true);assert.equal(interrupted.pages.length,1);
  const resumed=await scan(plan,{fetch,checkpointStore:store,retainCheckpoint:true});
  assert.equal(resumed.pages.length,2);assert.equal(requests.filter(url=>url==='/a').length,1);
  assert.ok(!requests.includes('/healthy'));
});

test('packaged CLI retry requests only the selected failed URL and preserves its source',async t=>{
  const root=await temp(t);const requests=[];
  const server=createServer((req,res)=>{requests.push(req.url);res.setHeader('content-type','text/html');res.end(req.url==='/robots.txt'?'User-agent: *\nAllow: /\n':html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const source=join(root,'source with spaces.json');await writeSnapshot(source,baseline([{path:'/healthy',status:200},{path:'/failed/?page=1',status:503},{path:'/not-found',status:404}],origin));
  const bytes=await readFile(source,'utf8');
  const child=spawn(process.execPath,[resolve('bin/seo-audit.js'),'retry',source,'--status','503','--all','--delay','0','--json'],{cwd:root});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const exit=await new Promise(r=>child.on('exit',r));assert.equal(exit,0,stderr);
  const result=JSON.parse(stdout);assert.equal(result.selected,1);assert.equal(result.outcome.recovered,1);
  assert.deepEqual(requests,['/robots.txt','/failed/?page=1']);assert.equal(await readFile(source,'utf8'),bytes);
});
