import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Configure an unpacked Codex package before importing it into a marketplace.
try {
  if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) throw new Error('Usage: node configure.mjs /absolute/existing/workspace');
  const root = await realpath(process.argv[2]);
  if (!(await stat(root)).isDirectory()) throw new Error('Workspace must be a directory.');
  const plugin = await realpath(fileURLToPath(new URL('./', import.meta.url)));
  const overlaps = (parent, child) => {
    const rel = relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  if (overlaps(plugin, root) || overlaps(root, plugin)) {
    throw new Error('Workspace and plugin package must be separate, non-overlapping directories.');
  }
  const path = new URL('./mcp.json', import.meta.url);
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.mcpServers['seo-crawl-audit'].env.SEO_AUDIT_MCP_ROOT = root;
  config.mcpServers['seo-crawl-audit'].command = process.execPath;
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  console.log('Codex workspace and Node executable configured. Import or refresh this local plugin and restart the client.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
