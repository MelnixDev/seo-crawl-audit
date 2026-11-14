/** Public archives must never retain machine-specific setup from an unpacked copy. */
export function assertPortableCodexTemplate(config) {
  const server = config.mcpServers?.['seo-crawl-audit'];
  if (server?.command !== 'node') {
    throw new Error('Do not distribute a runtime-configured plugin; restore the portable node command first.');
  }
  if (server.env?.SEO_AUDIT_MCP_ROOT !== '') {
    throw new Error('Do not distribute a workspace-configured plugin; restore the empty template root first.');
  }
}
