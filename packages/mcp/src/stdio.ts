import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { ENGINE_VERSION } from "@seo-crawl-audit/core";
import { createServer } from "./server.js";

export async function serve(): Promise<void> {
  console.error(`[seo-crawl-audit:mcp] MCP server ${ENGINE_VERSION} is running on stdio. Waiting for client requests; press Ctrl+C to stop.`);
  serveStdio(() => createServer(), { onerror: (error) => console.error(`[seo-crawl-audit:mcp] ${error.message}`) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void serve();
}
