import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const cli=fileURLToPath(new URL('../bin/seo-audit.js',import.meta.url));

test('non-TTY bundled CLI respects configured page budgets, overrides and safe default',async t=>{
 const root=await mkdtemp(join(tmpdir(),'seo-configured-budget-'));t.after(()=>rm(root,{recursive:true,force:true}));let origin;let requested=[];
 const urls=Array.from({length:150},(_,i)=>i===0?'/':`/page-${String(i).padStart(3,'0')}`);
 const server=createServer((req,res)=>{
  if(req.url==='/robots.txt')return res.end('User-agent: *\nAllow: /\n');
  if(req.url==='/sitemap.xml'){res.setHeader('content-type','application/xml');return res.end('<urlset>'+urls.map(p=>`<url><loc>${origin}${p}</loc></url>`).join('')+'</urlset>');}
  requested.push(req.url);res.setHeader('content-type','text/html');res.end(`<title>Fixture page ${req.url}</title><h1>Fixture</h1><link rel="canonical" href="${req.url}">`);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());origin=`http://127.0.0.1:${server.address().port}`;
 const cases=[{name:'below-default',configured:2,want:2},{name:'above-default',configured:120,want:120},{name:'override-up',configured:2,flags:['--pages','3'],want:3},{name:'override-down',configured:120,flags:['--pages','2'],want:2},{name:'safe-default',want:100},{name:'intentional-all',configured:2,flags:['--all'],want:150}];
 for(const row of cases){
  requested=[];const config=join(root,row.name+'.config.json'),output=join(root,row.name+'.snapshot.json');
  await writeFile(config,JSON.stringify({url:origin+'/',sitemap:origin+'/sitemap.xml',delay:0,concurrency:1,...(row.configured?{maxPages:row.configured}:{})}));
  const result=await run(process.execPath,[cli,'scan',origin+'/', '--config',config,'--output',output,'--json','--no-report','--no-cache','--no-history',...(row.flags??[])],{cwd:root,maxBuffer:4*1024*1024});
  assert.doesNotThrow(()=>JSON.parse(result.stdout),row.name+': stdout is one JSON response');
  const snapshot=JSON.parse(await readFile(output,'utf8'));
  assert.equal(snapshot.pages.length,row.want,row.name);assert.equal(snapshot.config.maxPages,row.want,row.name+' effective budget');assert.equal(requested.length,row.want,row.name+' actual HTML requests');
  assert.equal(new Set(requested).size,row.want,row.name+' unique requests');assert.equal(snapshot.partial,false);assert.equal(snapshot.truncated,row.want<urls.length,row.name+' scope');
 }
});
