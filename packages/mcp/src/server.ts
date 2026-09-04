import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ENGINE_VERSION } from "@seo-crawl-audit/core";
import { workspaceRoot } from "./paths.js";
import { toolError, toolResult } from "./result.js";
import { checkTool, compareTool, issuesTool, planTool, reportTool, rulesTool, scanTool } from "./tools.js";

const common = {
  url: z.string().url().optional().describe("HTTP(S) site URL; may come from config"),
  config: z.string().optional().describe("Relative config path inside the workspace"),
  maxPages: z.number().int().positive().max(10000).optional(),
  concurrency: z.number().int().positive().max(20).optional(),
  delay: z.number().int().nonnegative().max(60000).optional(),
  timeout: z.number().int().positive().max(120000).optional(),
  sitemap: z.string().optional(),
  includeQuery: z.boolean().optional(),
  respectRobots: z.boolean().optional(),
};

function register<T extends z.ZodRawShape>(server: McpServer, name: string, title: string, description: string, shape: T, handler: (input: z.infer<z.ZodObject<T>>, signal: AbortSignal) => Promise<Record<string, unknown>>) {
  server.registerTool(name, { title, description, inputSchema: z.object(shape), annotations: { readOnlyHint: name !== "seo_audit_scan" && name !== "seo_audit_check", idempotentHint: true } }, async (input, ctx) => {
    try { return toolResult(await handler(input, ctx.mcpReq.signal)); } catch (error) { return toolError(error); }
  });
}

export function createServer(root = workspaceRoot()): McpServer {
  const server = new McpServer({ name: "seo-crawl-audit", version: ENGINE_VERSION }, { instructions: "Local-first SEO audit server. Plan before crawling, keep scans within the workspace, respect robots.txt, inspect issues with pagination, and cite report artifact paths. Do not expose secrets from environment variables." });
  const context = (signal: AbortSignal) => ({ root, signal });
  register(server, "seo_audit_plan", "Plan SEO crawl", "Discover robots.txt and sitemap metadata without fetching HTML pages.", common, (input, signal) => planTool(context(signal), input));
  register(server, "seo_audit_scan", "Run SEO scan", "Scan a site locally and save a SnapshotV2 plus an HTML report. Defaults to 100 pages and a resumable checkpoint.", { ...common, output: z.string().optional(), report: z.string().optional(), checkpoint: z.string().optional(), resume: z.boolean().optional() }, (input, signal) => scanTool(context(signal), input));
  register(server, "seo_audit_check", "Check SEO regressions", "Scan against a saved baseline and return new, ongoing, resolved, and unchanged issue counts.", { ...common, baseline: z.string().optional(), output: z.string().optional(), report: z.string().optional(), checkpoint: z.string().optional(), resume: z.boolean().optional() }, (input, signal) => checkTool(context(signal), input));
  register(server, "seo_audit_compare", "Compare snapshots", "Compare two local SnapshotV2 files without network access and optionally render a regression report.", { production: z.string().optional(), preview: z.string().optional(), report: z.string().optional() }, (input, signal) => compareTool(context(signal), input));
  register(server, "seo_audit_issues", "List SEO issues", "Read a local snapshot or comparison and return filtered, paginated issues.", { snapshot: z.string().optional(), baseline: z.string().optional(), query: z.string().optional(), severity: z.enum(["error", "warning", "info"]).optional(), rule: z.string().optional(), owner: z.enum(["seo", "content", "developer"]).optional(), lifecycle: z.enum(["new", "ongoing", "resolved", "unchanged"]).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().positive().max(100).optional() }, (input, signal) => issuesTool(context(signal), input));
  register(server, "seo_audit_report", "Render SEO report", "Render a clean HTML report from a local SnapshotV2 without network access.", { snapshot: z.string().optional(), output: z.string().optional() }, (input, signal) => reportTool(context(signal), input));
  server.registerTool("seo_audit_rules", { title: "List SEO rules", description: "List built-in rules, severities, owners, and documentation links.", annotations: { readOnlyHint: true, idempotentHint: true } }, async () => {
    try { return toolResult(await rulesTool()); } catch (error) { return toolError(error); }
  });
  return server;
}
