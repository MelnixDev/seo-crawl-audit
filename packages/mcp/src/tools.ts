import {
  audit,
  diff,
  getRuleDefinitions,
  planScan,
  resolveConfig,
  scan,
  ENGINE_VERSION,
  RULE_SET_VERSION,
  type DiffResult,
  type Issue,
  type ReportData,
  type ScanConfigInput,
  type SnapshotV2,
} from "@seo-crawl-audit/core";
import {
  createFileCheckpointStore,
  findConfigFile,
  loadConfig,
  readSnapshot,
  writeReport,
  writeSnapshot,
} from "@seo-crawl-audit/core/node";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePath, relativeArtifact } from "./paths.js";
import { authenticatedCheckpointPath, requestFetch } from "./request-headers.js";

export interface ToolContext {
  root: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

interface CommonInput {
  url?: string | undefined;
  config?: string | undefined;
  maxPages?: number | undefined;
  concurrency?: number | undefined;
  delay?: number | undefined;
  timeout?: number | undefined;
  sitemap?: string | undefined;
  includeQuery?: boolean | undefined;
  respectRobots?: boolean | undefined;
  headersEnv?: string | undefined;
}

function requireUrl(url: string | undefined): string {
  if (!url) throw new Error("url is required (or provide a config file with url)");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("url must be a valid HTTP(S) URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("url must use http or https");
  return parsed.href;
}

async function inputConfig(context: ToolContext, input: CommonInput, fallbackUrl?: string): Promise<ScanConfigInput> {
  const configPath = input.config
    ? workspacePath(context.root, input.config, "seo-audit.config.json")
    : await findConfigFile(context.root);
  const file = await loadConfig(configPath);
  const url = requireUrl(input.url ?? fallbackUrl ?? file.url);
  return resolveConfig({
    url,
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
    ...(input.delay === undefined ? {} : { delay: input.delay }),
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
    ...(input.sitemap === undefined ? {} : { sitemap: input.sitemap }),
    ...(input.includeQuery === undefined ? {} : { includeQuery: input.includeQuery }),
    ...(input.respectRobots === undefined ? {} : { respectRobots: input.respectRobots }),
  }, file);
}

function summary(snapshot: SnapshotV2) {
  const issues = audit(snapshot);
  return {
    pages: snapshot.pages.length,
    affectedPages: new Set(issues.map((issue) => issue.url)).size,
    issues: issues.length,
    severity: issues.reduce((counts, issue) => ({ ...counts, [issue.severity]: (counts[issue.severity] ?? 0) + 1 }), { error: 0, warning: 0, info: 0 } as Record<string, number>),
    partial: snapshot.partial,
    truncated: snapshot.truncated,
  };
}

function reportData(snapshot: SnapshotV2, issues: Issue[], mode: "scan" | "check", extra: Partial<ReportData> = {}): ReportData {
  return {
    mode,
    startUrl: snapshot.siteUrl,
    generatedAt: snapshot.generatedAt,
    pages: snapshot.pages,
    issues,
    partial: snapshot.partial,
    complete: !snapshot.partial && !snapshot.truncated,
    engineVersion: snapshot.engineVersion,
    ruleSetVersion: snapshot.ruleSetVersion,
    branding: snapshot.config.report,
    ...extra,
  };
}

async function ensureParents(...paths: string[]): Promise<void> {
  await Promise.all([...new Set(paths.map(dirname))].map((directory) => mkdir(directory, { recursive: true })));
}

export async function rulesTool(): Promise<Record<string, unknown>> {
  return {
    engineVersion: ENGINE_VERSION,
    ruleSetVersion: RULE_SET_VERSION,
    rules: getRuleDefinitions().map((rule) => ({
      ...rule,
      documentationUrl: `https://github.com/MelnixDev/seo-crawl-audit/blob/main/docs/rules.md#${rule.id}`,
    })),
  };
}

export async function planTool(context: ToolContext, input: CommonInput): Promise<Record<string, unknown>> {
  const config = await inputConfig(context, input);
  const fetch = requestFetch(input.headersEnv, config.url, context.fetch);
  const plan = await planScan(config, { signal: context.signal, fetch });
  return {
    planVersion: plan.planVersion,
    startUrl: plan.startUrl,
    origin: plan.origin,
    mode: plan.mode,
    candidateCount: plan.candidateCount,
    robots: { url: plan.robots.url, status: plan.robots.status, error: plan.robots.error, denyAll: plan.robots.denyAll ?? false },
    sitemap: plan.sitemap ? { url: plan.sitemap.url, count: plan.sitemap.urls.length, truncated: plan.sitemap.truncated, error: plan.sitemap.error ?? null } : null,
    config: { maxPages: plan.config.maxPages, concurrency: plan.config.concurrency, delay: plan.config.delay, timeout: plan.config.timeout, respectRobots: plan.config.respectRobots },
  };
}

export async function scanTool(context: ToolContext, input: CommonInput & { output?: string | undefined; report?: string | undefined; checkpoint?: string | undefined; resume?: boolean | undefined }): Promise<Record<string, unknown>> {
  const config = await inputConfig(context, input);
  const fetch = requestFetch(input.headersEnv, config.url, context.fetch);
  const plan = await planScan(config, { signal: context.signal, fetch });
  const output = workspacePath(context.root, input.output, ".seo-audit.json");
  const report = workspacePath(context.root, input.report, "seo-audit-report.html");
  const checkpoint = authenticatedCheckpointPath(workspacePath(context.root, input.checkpoint, ".seo-audit.checkpoint.ndjson"), input.headersEnv);
  await ensureParents(output, report, checkpoint);
  const store = createFileCheckpointStore(checkpoint);
  const result = await scan(plan, {
    signal: context.signal,
    limit: input.maxPages ?? config.maxPages,
    resume: input.resume !== false,
    checkpointStore: store,
    fetch,
  });
  await writeSnapshot(output, result.snapshot);
  const issues = audit(result.snapshot);
  await writeReport(report, reportData(result.snapshot, issues, "scan"));
  return { ...summary(result.snapshot), startUrl: result.startUrl, artifacts: { snapshot: relativeArtifact(context.root, output), report: relativeArtifact(context.root, report), checkpoint: result.partial ? relativeArtifact(context.root, checkpoint) : null } };
}

export async function checkTool(context: ToolContext, input: CommonInput & { baseline?: string | undefined; output?: string | undefined; report?: string | undefined; checkpoint?: string | undefined; resume?: boolean | undefined }): Promise<Record<string, unknown>> {
  const baselinePath = workspacePath(context.root, input.baseline, ".seo-audit.json");
  const baseline = await readSnapshot(baselinePath);
  const config = await inputConfig(context, input, baseline.siteUrl);
  const fetch = requestFetch(input.headersEnv, config.url, context.fetch);
  const plan = await planScan(config, { signal: context.signal, fetch });
  const output = workspacePath(context.root, input.output, ".seo-audit.current.json");
  const report = workspacePath(context.root, input.report, "seo-audit-check.html");
  const checkpoint = authenticatedCheckpointPath(workspacePath(context.root, input.checkpoint, ".seo-audit.checkpoint.ndjson"), input.headersEnv);
  await ensureParents(output, report, checkpoint);
  const store = createFileCheckpointStore(checkpoint);
  const result = await scan(plan, { signal: context.signal, limit: input.maxPages ?? config.maxPages, resume: input.resume !== false, checkpointStore: store, fetch });
  await writeSnapshot(output, result.snapshot);
  const comparison = diff(baseline, result.snapshot);
  await writeReport(report, reportData(result.snapshot, comparison.issues, "check", {
    newIssues: comparison.newIssues, ongoingIssues: comparison.ongoingIssues, resolvedIssues: comparison.resolvedIssues, unchangedIssues: comparison.unchangedIssues, complete: comparison.complete,
  }));
  return {
    baseline: relativeArtifact(context.root, baselinePath),
    ...summary(result.snapshot),
    complete: comparison.complete,
    lifecycle: { new: comparison.newIssues.length, ongoing: comparison.ongoingIssues.length, resolved: comparison.resolvedIssues.length, unchanged: comparison.unchangedIssues.length },
    budgetExceeded: comparison.budgetExceeded,
    artifacts: { snapshot: relativeArtifact(context.root, output), report: relativeArtifact(context.root, report), checkpoint: result.partial ? relativeArtifact(context.root, checkpoint) : null },
  };
}

function issueMatches(issue: Issue, input: { query?: string | undefined; severity?: string | undefined; rule?: string | undefined; owner?: string | undefined; lifecycle?: string | undefined }): boolean {
  return (!input.query || `${issue.url} ${issue.message}`.toLowerCase().includes(input.query.toLowerCase()))
    && (!input.severity || issue.severity === input.severity)
    && (!input.rule || issue.ruleId === input.rule)
    && (!input.owner || issue.owner === input.owner)
    && (!input.lifecycle || issue.lifecycle === input.lifecycle);
}

export async function issuesTool(context: ToolContext, input: { snapshot?: string | undefined; baseline?: string | undefined; query?: string | undefined; severity?: string | undefined; rule?: string | undefined; owner?: string | undefined; lifecycle?: string | undefined; offset?: number | undefined; limit?: number | undefined }): Promise<Record<string, unknown>> {
  const currentPath = workspacePath(context.root, input.snapshot, ".seo-audit.json");
  const current = await readSnapshot(currentPath);
  const comparison = input.baseline ? diff(await readSnapshot(workspacePath(context.root, input.baseline, ".seo-audit.json")), current) : null;
  const all = comparison ? [...comparison.newIssues, ...comparison.ongoingIssues, ...comparison.resolvedIssues, ...comparison.unchangedIssues] : audit(current);
  const filtered = all.filter((issue) => issueMatches(issue, input));
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.min(100, Math.max(1, input.limit ?? 20));
  return { snapshot: relativeArtifact(context.root, currentPath), total: filtered.length, offset, limit, hasMore: offset + limit < filtered.length, issues: filtered.slice(offset, offset + limit) };
}

export async function compareTool(context: ToolContext, input: { production?: string | undefined; preview?: string | undefined; report?: string | undefined }): Promise<Record<string, unknown>> {
  const productionPath = workspacePath(context.root, input.production, ".seo-audit.json");
  const previewPath = workspacePath(context.root, input.preview, ".seo-audit.current.json");
  const production = await readSnapshot(productionPath);
  const preview = await readSnapshot(previewPath);
  const comparison = diff(production, preview);
  if (input.report !== undefined) {
    const report = workspacePath(context.root, input.report, "seo-audit-compare.html");
    await ensureParents(report);
    await writeReport(report, reportData(preview, comparison.issues, "check", {
      newIssues: comparison.newIssues, ongoingIssues: comparison.ongoingIssues, resolvedIssues: comparison.resolvedIssues,
      unchangedIssues: comparison.unchangedIssues, complete: comparison.complete,
    }));
    return { ...diffSummary(comparison), production: relativeArtifact(context.root, productionPath), preview: relativeArtifact(context.root, previewPath), report: relativeArtifact(context.root, report) };
  }
  return { ...diffSummary(comparison), production: relativeArtifact(context.root, productionPath), preview: relativeArtifact(context.root, previewPath) };
}

export async function reportTool(context: ToolContext, input: { snapshot?: string | undefined; output?: string | undefined }): Promise<Record<string, unknown>> {
  const snapshotPath = workspacePath(context.root, input.snapshot, ".seo-audit.json");
  const output = workspacePath(context.root, input.output, "seo-audit-report.html");
  const snapshot = await readSnapshot(snapshotPath);
  await ensureParents(output);
  await writeReport(output, reportData(snapshot, audit(snapshot), "scan"));
  return { snapshot: relativeArtifact(context.root, snapshotPath), report: relativeArtifact(context.root, output), ...summary(snapshot) };
}

export function diffSummary(comparison: DiffResult): Record<string, unknown> {
  return { complete: comparison.complete, new: comparison.newIssues.length, ongoing: comparison.ongoingIssues.length, resolved: comparison.resolvedIssues.length, unchanged: comparison.unchangedIssues.length, budgetExceeded: comparison.budgetExceeded };
}
