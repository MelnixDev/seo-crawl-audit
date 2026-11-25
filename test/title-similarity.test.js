import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTitleSimilarity } from '../packages/core/dist/rules/title-similarity.js';
import { evaluateCurrentRules } from '../packages/core/dist/rules/current.js';
import { createBaseline } from '../packages/core/dist/baseline.js';
const page=(path,title,extra={})=>({url:'https://example.com'+path,finalUrl:'https://example.com'+path,status:200,title,...extra});
test('Drupal first/second-page case is a critical error with self canonicals',()=>{
 const pages=[page('/film','Цитати з фільму | Балачки'),page('/film?page=1','Цитати з фільму | Балачки')]; pages.forEach(p=>p.canonical=p.url);
 const issues=evaluateTitleSimilarity(pages); assert.equal(issues.length,2); assert.ok(issues.every(i=>i.ruleId==='pagination-title-duplicate'&&i.severity==='error')); assert.deepEqual(issues[0].evidence.urls,pages.map(p=>p.url)); assert.match(issues[0].evidence.interpretation,/not proof/);
});
test('proper page titles and intentional canonical variants are excluded',()=>{
 assert.deepEqual(evaluateTitleSimilarity([page('/film','Film quotes — Page 1 | Site'),page('/film?page=2','Film quotes — Page 2 | Site')]),[]);
 assert.deepEqual(evaluateTitleSimilarity([page('/film','Same'),page('/film?page=2','Same',{canonical:'https://example.com/film'})]),[]);
});
test('parameter order, alternate pager keys, punctuation and whitespace',()=>{
 assert.equal(evaluateTitleSimilarity([page('/list?lang=uk','Film: quotes'),page('/list?paged=2&lang=uk','Film — quotes')]).length,2);
 assert.equal(evaluateTitleSimilarity([page('/list','Title'),page('/list?p=2','Title')]).length,2);
});
test('nonindexable, failed and titleless pages do not create critical findings',()=>{
 for(const extra of [{robots:'noindex, follow'},{xRobotsTag:'NOINDEX'},{blockedByRobots:true},{error:'timeout'},{status:404},{status:302},{title:null}]) assert.deepEqual(evaluateTitleSimilarity([page('/film','Same'),page('/film?page=1','Same',extra)]),[]);
});
test('near duplicate title is a review warning with concrete comparison evidence',()=>{
 const a='Find beautiful Ukrainian quotes about friendship and love in our collection'; const b=a.replace('love','hope');
 const issues=evaluateTitleSimilarity([page('/a',a),page('/b',b)]); assert.equal(issues.length,1); assert.equal(issues[0].ruleId,'near-duplicate-title'); assert.equal(issues[0].severity,'warning'); assert.equal(issues[0].evidence.otherTitle,a);
});
test('punctuation variants detected; exact duplicates left to existing rule',()=>{
 const a='Find Ukrainian quotes about friendship and love today'; assert.equal(evaluateTitleSimilarity([page('/a',a),page('/b',a+'!')]).length,1); assert.deepEqual(evaluateTitleSimilarity([page('/a',a),page('/b',a)]),[]);
});
test('short, unrelated and overly long titles do not trigger fuzzy review',()=>{
 for(const [a,b] of [['Red shoes','Blue shoes'],['one two three four five six','seven eight nine ten eleven twelve'],[Array(41).fill('word').join(' '),Array(41).fill('word').join(' ')+'!']]) assert.deepEqual(evaluateTitleSimilarity([page('/a',a),page('/b',b)]),[]);
});
test('valid pagination title similarity is expected and not flagged',()=>{
 assert.deepEqual(evaluateTitleSimilarity([page('/a','Find Ukrainian quotes about friendship and love page 1'),page('/a?page=2','Find Ukrainian quotes about friendship and love page 2')]),[]);
});
test('bounded deterministic candidates and capped pagination evidence',()=>{
 const title='Find Ukrainian quotes about friendship and love today'; const pages=Array.from({length:25},(_,i)=>page('/a'+String(i).padStart(2,'0'),title+'!'.repeat(i)));
 assert.deepEqual(evaluateTitleSimilarity(pages),evaluateTitleSimilarity(pages.toReversed()));
 const issues=evaluateTitleSimilarity(Array.from({length:30},(_,i)=>page('/list?page='+i,'Same title'))); assert.equal(issues.length,30); assert.equal(issues[0].evidence.urls.length,20); assert.equal(issues[0].evidence.affectedCount,30);
});
test('aliases with same final URL are not a pagination group',()=>assert.deepEqual(evaluateTitleSimilarity([page('/a','Same'),page('/a?page=1','Same',{finalUrl:'https://example.com/a'})]),[]));
test('exact duplicate titles of indexable pages are errors; noindex pairs remain review warnings',()=>{
 const make=(robots)=>createBaseline({startUrl:'https://example.com/',robots:{url:'https://example.com/robots.txt',status:200,sha256:'same',error:null},pages:[page('/a','Shared example title',{robots}),page('/b','Shared example title',{robots})]});
 assert.ok(evaluateCurrentRules(make('index, follow')).filter(i=>i.ruleId==='duplicate-title').every(i=>i.severity==='error'));
 assert.ok(evaluateCurrentRules(make('noindex')).filter(i=>i.ruleId==='duplicate-title').every(i=>i.severity==='warning'));
});

test('near matches require two-way hreflang evidence before excluding different languages', () => {
  const a = page('/de/repair', 'NGINX: Ingress Controller 5.8.0 und Gateway Fabric 2.9.0', { lang: 'de-DE' });
  const b = page('/hu/repair', 'NGINX Ingress Controller 5.8.0 és Gateway Fabric 2.9.0', { lang: 'hu' });
  const links = (peer, lang) => [{ url: peer.url, lang }];

  assert.equal(evaluateTitleSimilarity([a, b]).length, 1);
  a.hreflang = links(b, 'hu-HU');
  assert.equal(evaluateTitleSimilarity([a, b]).length, 1);
  b.hreflang = links(a, 'fr');
  assert.equal(evaluateTitleSimilarity([a, b]).length, 1);
  b.hreflang = links(a, 'de');
  assert.deepEqual(evaluateTitleSimilarity([a, b]), []);

  const site = createBaseline({ startUrl: 'https://example.com/', pages: [a, { ...b, title: a.title }] });
  assert.equal(evaluateCurrentRules(site).filter(issue => issue.ruleId === 'duplicate-title' && issue.severity === 'error').length, 2);
});

test('title length is checked on indexable pages and noindex findings remain separate', () => {
  const pages = [
    page('/short', 'Short'),
    page('/meta', 'Short', { robots: 'noindex, follow' }),
    page('/header', 'Short', { xRobotsTag: 'googlebot: NOINDEX' }),
    page('/alias', 'Short', { canonical: 'https://example.com/short' }),
  ];
  const issues = evaluateCurrentRules(createBaseline({ startUrl: 'https://example.com/', pages }));
  assert.deepEqual(issues.filter(issue => issue.ruleId === 'title-length').map(issue => issue.url), [pages[0].url]);
  assert.ok(issues.some(issue => issue.ruleId === 'noindex' && issue.url === pages[1].url));
  assert.ok(issues.some(issue => issue.ruleId === 'x-robots-noindex' && issue.url === pages[2].url));
});
