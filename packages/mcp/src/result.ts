import type { CallToolResult } from "@modelcontextprotocol/server";

export function toolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function toolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    structuredContent: { error: message },
  };
}
