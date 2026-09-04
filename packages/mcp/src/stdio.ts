import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

export async function serve(): Promise<void> {
  serveStdio(() => createServer(), { onerror: (error) => console.error(`[seo-crawl-audit:mcp] ${error.message}`) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void serve();
}
