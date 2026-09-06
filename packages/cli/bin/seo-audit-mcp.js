#!/usr/bin/env node

try {
  const { serve } = await import("../bundle/mcp.js");
  await serve();
} catch (error) {
  console.error(`seo-audit-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
