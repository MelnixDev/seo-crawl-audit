import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planScan,scan,audit,diff,resolveConfig,validateConfig,migrateSnapshot,buildLocalComparison} from '../packages/core/dist/index.js';
import {createBaseline} from '../packages/core/dist/baseline.js';
import {createFileCheckpointStore} from '../packages/core/dist/node.js';
import {scanConfig,parseCliArgs} from '../packages/cli/dist/args.js';

async function fixture(t) {
 const requests=[];let origin;
 const server=createServer((req,res)=>{
  requests.push(req.url);
  if(req.url==='/robots.txt')return res.end('User-agent: *\nDisallow: /blocked/\n');
  if(req.url==='/sitemap.xml'){res.setHeader('content-type','application/xml');return res.end(`<sitemapindex><sitemap><loc>${origin}/maps/</loc></sitemap></sitemapindex>`);}
  if(req.url==='/maps/'){res.setHeader('content-type','application/xml');return res.end(`<urlset>${['/section/','/plain','/en','/en/','/genuine','/blocked/'].map(p=>`<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>`);}
  if(['/section','/en','/genuine'].includes(req.url)){res.writeHead(301,{location:req.url+'/'});return res.end();}
  if(req.url==='/plain/'){res.writeHead(301,{location:'/plain'});return res.end();}
  res.setHeader('content-type','text/html');
  const canonical=req.url==='/en/'?'/en':req.url;
  res.end(`<title>Example ${req.url}</title><h1>Example</h1><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="uk" href="/section/"><a href="/section/">Section</a>`);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,requests};
}

test('issue 32: sitemap and start URLs preserve slash; no synthetic sitemap redirect',async t=>{
 const {origin,requests}=await fixture(t);
 const plan=await planScan({url:origin+'/section/',sitemap:origin+'/sitemap.xml',maxPages:10,delay:0});
 assert.ok(plan.sitemap.urls.includes(origin+'/section/'));
 assert.equal(plan.startUrl,origin+'/section/');
 assert.ok(requests.includes('/maps/'));assert.ok(!requests.includes('/maps'));
 const result=await scan(plan);
 const section=result.snapshot.pages.find(p=>p.url===origin+'/section/');
 assert.equal(section.finalUrl,origin+'/section/');assert.equal(section.canonical,origin+'/section/');assert.equal(section.canonicalRaw,'/section/');
 assert.equal(section.redirectChain.length,0);assert.equal(section.hreflang[0].url,origin+'/section/');
 assert.ok(!requests.includes('/section'));
 assert.ok(!requests.includes('/blocked/'));
 const findings=audit(result.snapshot);
 assert.ok(!findings.some(i=>i.ruleId==='redirect-in-sitemap'&&i.url===section.url));
 assert.ok(findings.some(i=>i.ruleId==='redirect-in-sitemap'&&i.url===origin+'/genuine'));
 const canonical=findings.filter(i=>i.ruleId==='canonical-target-redirect');
 assert.equal(canonical.length,1);assert.equal(canonical[0].url,origin+'/en/');
 assert.equal(canonical[0].evidence.requestedUrl,origin+'/en');assert.equal(canonical[0].evidence.finalUrl,origin+'/en/');
 assert.equal(canonical[0].evidence.redirectChain[0].location,origin+'/en/');
});

test('slashless site stays clean and a real slash alias redirect stays visible',async t=>{
 const {origin}=await fixture(t);
 const result=await scan({url:origin+'/plain',sitemap:'none',maxPages:1,delay:0});
 assert.equal(result.pages[0].url,origin+'/plain');assert.equal(result.pages[0].redirectChain.length,0);
 const alias=await scan({url:origin+'/plain/',sitemap:'none',maxPages:1,delay:0});
 assert.equal(alias.pages[0].url,origin+'/plain/');assert.equal(alias.pages[0].finalUrl,origin+'/plain');assert.equal(alias.pages[0].redirectChain.length,1);
 assert.ok(!audit(alias.snapshot).some(i=>i.ruleId==='canonical-target-redirect'));
});

test('strip is opt-in for traversal; observed final/canonical/hreflang remain exact',async t=>{
 const {origin,requests}=await fixture(t);
 const result=await scan({url:origin+'/section/',sitemap:'none',trailingSlash:'strip',maxPages:1,delay:0});
 assert.equal(result.startUrl,origin+'/section');assert.ok(requests.includes('/section'));
 assert.equal(result.pages[0].finalUrl,origin+'/section/');assert.equal(result.pages[0].canonical,origin+'/section/');assert.equal(result.pages[0].hreflang[0].url,origin+'/section/');
 assert.equal(result.snapshot.config.trailingSlash,'strip');assert.equal(result.snapshot.urlObservationVersion,1);
});

test('slash paths and query pagination survive independently',async t=>{
 const {origin,requests}=await fixture(t);
 const result=await scan({url:origin+'/section/?page=1',sitemap:'none',includeQuery:true,maxPages:1,delay:0});
 assert.ok(requests.includes('/section/?page=1'));assert.equal(result.pages[0].canonical,origin+'/section/?page=1');
 assert.equal(result.pages[0].finalUrl,origin+'/section/?page=1');
});

test('renderer observations preserve paths under both traversal policies',async t=>{
 const {origin}=await fixture(t);
 const renderer={id:'fixture',async render(){return {finalUrl:origin+'/section/?page=2',status:200,headers:{},html:'<title>Rendered</title><link rel="canonical" href="/section/?page=2"><link rel="alternate" hreflang="uk" href="/section/"><a href="/child/">Child</a>',responseBytes:120,redirectChain:[]};}};
 for(const trailingSlash of ['strip','preserve']){
  const r=await scan({url:origin+'/section/',sitemap:'none',trailingSlash,maxPages:1,delay:0},{renderer});
  assert.equal(r.pages[0].finalUrl,origin+'/section/?page=2');assert.equal(r.pages[0].canonical,origin+'/section/?page=2');
  assert.equal(r.pages[0].hreflang[0].url,origin+'/section/');assert.equal(r.pages[0].links[0],origin+(trailingSlash==='strip'?'/child':'/child/'));
 }
});

test('config and CLI policy are validated, defaulted, and hashed',()=>{
 assert.equal(resolveConfig({url:'https://example.com'}).trailingSlash,'preserve');
 assert.throws(()=>validateConfig({trailingSlash:'guess'}),/preserve or strip/);
 assert.equal(scanConfig('https://example.com',parseCliArgs(['--trailing-slash','strip']).values).trailingSlash,'strip');
 assert.throws(()=>scanConfig('https://example.com',{'trailing-slash':'guess'}),/preserve or strip/);
 const a=createBaseline({startUrl:'https://example.com/',options:{trailingSlash:'strip'}}),b=createBaseline({startUrl:'https://example.com/',options:{trailingSlash:'preserve'}});
 assert.notEqual(a.configurationHash,b.configurationHash);
});

test('legacy snapshots remain strip observations, retain versions, and do not invent slash evidence',()=>{
 const old=createBaseline({startUrl:'https://example.com/',pages:[{url:'https://example.com/section',finalUrl:'https://example.com/section',canonical:'https://example.com/section',canonicalRaw:'https://example.com/section/',status:200}]});
 delete old.config.trailingSlash;delete old.source.trailingSlash;delete old.urlObservationVersion;old.engineVersion='0.15.1';old.ruleSetVersion='1.1.0';
 const read=migrateSnapshot(old);
 assert.equal(read.config.trailingSlash,'strip');assert.equal(read.urlObservationVersion,undefined);assert.equal(read.engineVersion,'0.15.1');assert.equal(read.ruleSetVersion,'1.1.0');
 assert.equal(read.pages[0].finalUrl,'https://example.com/section');assert.equal(read.pages[0].canonicalRaw,'https://example.com/section/');
 const current=createBaseline({startUrl:'https://example.com/',pages:[{url:'https://example.com/section/',finalUrl:'https://example.com/section/',status:200}]});
 const compared=diff(read,current);assert.equal(compared.complete,false);assert.equal(compared.resolvedIssues.length,0);assert.ok(!compared.newIssues.some(i=>i.ruleId==='page-missing'));
 const local=buildLocalComparison(read,current,{evaluatedAt:'2026-11-14T12:00:00Z'});
 assert.ok(local.summary.warnings.includes('url-policy-changed'));assert.ok(local.summary.unverified.some(i=>i.reason==='url-policy-changed'));
});

test('old checkpoints are not reused for a preserve crawl or new observation schema',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'seo-issue32-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'checkpoint.ndjson');
 const identity={schemaVersion:2,pageSchemaVersion:1,siteUrl:'https://example.com/',sitemapUrl:null,includeQuery:false,respectRobots:true,timeout:10000,maxRedirects:10,maxResponseBytes:5242880,userAgent:'test'};
 const legacy=JSON.stringify({type:'seo-audit-checkpoint',schemaVersion:1,source:{startUrl:identity.siteUrl,sitemap:null,includeQuery:false,respectRobots:true}})+'\n'+JSON.stringify({type:'page',page:{url:'https://example.com/section',status:200}})+'\n';
 await writeFile(file,legacy);const store=createFileCheckpointStore(file);
 assert.equal(await store.load({...identity,trailingSlash:'preserve',pageSchemaVersion:2}),null);
 assert.equal(JSON.parse((await readFile(file,'utf8')).split('\n')[0]).identity.trailingSlash,'preserve');
 await writeFile(file,legacy);assert.equal(await store.load({...identity,trailingSlash:'strip',pageSchemaVersion:2}),null);
});

test('redirect aliases do not become critical duplicate-title findings',()=>{
 const final='https://example.com/section/';const title='A shared title for a single resource';
 const snapshot=createBaseline({startUrl:'https://example.com/',pages:[{url:final.slice(0,-1),finalUrl:final,title,canonical:final,status:200},{url:final,finalUrl:final,title,canonical:final,status:200}]});
 assert.ok(!audit(snapshot).some(i=>i.ruleId==='duplicate-title'&&i.severity==='error'));
});

test('MCP planning exposes and validates the same traversal policy',async t=>{
 const {origin}=await fixture(t);const root=await mkdtemp(join(tmpdir(),'seo-issue32-mcp-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const {planTool}=await import('../packages/mcp/dist/tools.js');
 const preserved=await planTool({root},{url:origin+'/section/',sitemap:'none',trailingSlash:'preserve',delay:0});
 const stripped=await planTool({root},{url:origin+'/section/',sitemap:'none',trailingSlash:'strip',delay:0});
 assert.equal(preserved.startUrl,origin+'/section/');assert.equal(preserved.config.trailingSlash,'preserve');assert.equal(stripped.startUrl,origin+'/section');assert.equal(stripped.config.trailingSlash,'strip');
 await assert.rejects(planTool({root},{url:origin,trailingSlash:'guess'}),/preserve or strip/);
});

test('V2 checkpoints reject old observation schema and different trailing-slash policy',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'seo-issue32-v2-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'checkpoint.ndjson');
 const old={schemaVersion:2,pageSchemaVersion:1,siteUrl:'https://example.com/',sitemapUrl:null,includeQuery:false,respectRobots:true,timeout:10000,maxRedirects:10,maxResponseBytes:5242880,userAgent:'test'};
 await writeFile(file,JSON.stringify({type:'seo-audit-checkpoint',schemaVersion:2,identity:old})+'\n'+JSON.stringify({type:'page',page:{url:'https://example.com/section',status:200}})+'\n');
 const store=createFileCheckpointStore(file);const preserve={...old,pageSchemaVersion:2,trailingSlash:'preserve'};
 assert.equal(await store.load(preserve),null);
 await store.append(preserve,{url:'https://example.com/section/',status:200});await store.flush();
 assert.equal((await store.load(preserve)).pages.length,1);
 assert.equal(await store.load({...preserve,trailingSlash:'strip'}),null);
});

test('unchecked canonical targets are not guessed or fetched just for the new rule',async t=>{
 const {origin,requests}=await fixture(t);
 const result=await scan({url:origin+'/en/',sitemap:'none',maxPages:1,delay:0});
 assert.equal(result.pages[0].canonical,origin+'/en');assert.ok(!requests.includes('/en'));
 assert.ok(!audit(result.snapshot).some(i=>i.ruleId==='canonical-target-redirect'));
});
