import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, process.argv[2] ?? '_site');
await mkdir(resolve(output, 'demo'), { recursive: true });
const sourceRoot = resolve(root, 'docs/site');
for (const path of [
  'index.html', 'site.css', 'agent-prompt.js', 'robots.txt', 'sitemap.xml',
  'plugins/index.html', 'plugins/installation-prompts.js',
  'media/logo.png', 'media/codex.svg', 'media/claude-color.svg',
  'media/CLIENT-ICONS-LICENSE.txt', 'media/native-demo-report.html',
  'media/native-report-pages.png', 'media/native-report-issues.png',
  'media/native-report-overview.png', 'media/native-workflow.mp4',
  'media/regression-demo-noindex.webp',
]) {
  await cp(resolve(sourceRoot, path), resolve(output, path));
}
const scratch = await mkdtemp(resolve(tmpdir(), 'seo-crawl-audit-pages-'));
try {
  const regressionDemo = resolve(scratch, 'regression-demo');
  execFileSync(process.execPath, [
    resolve(root, 'packages/cli/bin/seo-audit.js'), 'demo', '--no-open', '--directory', regressionDemo,
  ], { stdio: 'inherit' });
  await mkdir(resolve(output, 'regression-demo'), { recursive: true });
  for (const name of ['failed.html', 'passed.html']) {
    const report = await readFile(resolve(regressionDemo, name), 'utf8');
    const noindexReport = report.replace(/<head\b[^>]*>/i, '$&<meta name="robots" content="noindex, follow">');
    if (report === noindexReport) throw new Error(`Regression demo ${name} is missing its head element`);
    await writeFile(resolve(output, 'regression-demo', name), noindexReport);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const source = await readFile(resolve(root, 'examples/quotes-toscrape-report.html'), 'utf8');
const demo = source.replace(/<head\b[^>]*>/i, '$&<meta name="robots" content="noindex, follow">');
if (demo === source) throw new Error('Example report is missing its head element');
await writeFile(resolve(output, 'demo/index.html'), demo);
await writeFile(resolve(output, 'report.html'), demo);
console.log(`Prepared product website and preserved example reports: ${output}`);
