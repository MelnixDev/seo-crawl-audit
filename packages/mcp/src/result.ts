import type { CallToolResult } from "@modelcontextprotocol/server";

export function toolResult(value: unknown): CallToolResult {
  // Keep the complete payload in text for clients that do not yet handle
  // structuredContent consistently (notably some OpenCode releases).
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

export function toolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
