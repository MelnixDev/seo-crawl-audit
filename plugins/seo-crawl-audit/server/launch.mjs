import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Do not infer a workspace from CWD: native hosts often start in the install cache.
try {
  const requested = process.env.SEO_AUDIT_MCP_ROOT;
  if (!requested || !isAbsolute(requested) || requested.includes('${')) {
    throw new Error('Configure an absolute existing workspace directory before starting this plugin (SEO_AUDIT_MCP_ROOT).');
  }
  const root = await realpath(requested);
  if (!(await stat(root)).isDirectory()) throw new Error('Configured workspace must be a directory.');
  const plugin = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const overlaps = (parent, child) => {
    const rel = relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  if (overlaps(plugin, root) || overlaps(root, plugin)) {
    throw new Error('Workspace and plugin package must be separate, non-overlapping directories.');
  }
  process.env.SEO_AUDIT_MCP_ROOT = root;
  // The renderer resolves optional Playwright from the consumer workspace.
  process.chdir(root);
  const { serve } = await import('./mcp.js');
  await serve();
} catch (error) {
  console.error(`seo-crawl-audit plugin: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
