import { createHash } from "node:crypto";
import { audit } from "./audit.js";
import { groupPageTemplates } from "./issue-groups.js";
import { getRuleDefinitions } from "./rules/registry.js";
import { buildLocalComparison } from "./local-comparison.js";
import { readCatalogSnapshot, readHistoryCatalog, type HistoryCatalogEntry } from "./node-history-catalog.js";
import { ENGINE_VERSION, RULE_SET_VERSION } from "./version.js";
import type { Issue, Severity, SnapshotV2 } from "./types.js";

export type TrendLimit = 20 | 50 | 100;
export interface TrendPointV1 {
  runId: string;
  generatedAt: string;
  pages: number;
  partial: boolean;
  truncated: boolean;
  severity: Record<Severity, number>;
  selectedRuleCount: number | null;
  selectedTemplateCount: number | null;
  verifiedNew: number | null;
  verifiedResolved: number | null;
  unverified: number | null;
  warnings: string[];
  previousRunId: string | null;
}
export interface TrendSummaryV1 {
  schemaVersion: 1;
  siteUrl: string | null;
  revision: string;
  evaluatedAt: string;
  limit: TrendLimit;
  selectedRule: string | null;
  selectedTemplate: string | null;
  templates: string[];
  rules: string[];
  points: TrendPointV1[];
  warnings: string[];
}

export interface TrendOptions {
  siteUrl?: string;
  limit?: TrendLimit;
  ruleId?: string;
  template?: string;
  evaluatedAt?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

function matchingTemplate(url: string, templates: readonly string[]): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "Other"; }
  for (const template of templates) {
    const prefix = parsed.origin;
    if (!template.startsWith(prefix)) continue;
    const path = template.slice(prefix.length);
    const expression = path.split("/").map((segment) => segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
    if (new RegExp(`^${expression}$`).test(parsed.pathname)) return template;
  }
  return "Other";
}

function withPolicy(snapshot: SnapshotV2, policy: SnapshotV2["config"]): SnapshotV2 {
  return { ...snapshot, config: { ...snapshot.config,
    enabledRules: policy.enabledRules,
    severityOverrides: policy.severityOverrides,
    suppressions: policy.suppressions,
    regressionBudgets: policy.regressionBudgets,
  } };
}

function countIssues(issues: readonly Issue[], templates: readonly string[], ruleId?: string, template?: string): Pick<TrendPointV1, "severity" | "selectedRuleCount" | "selectedTemplateCount"> {
  const severity = { error: 0, warning: 0, info: 0 };
  let selectedRuleCount = 0;
  let selectedTemplateCount = 0;
  for (const issue of issues) {
    severity[issue.severity] += 1;
    if (ruleId && issue.ruleId === ruleId) selectedRuleCount += 1;
    if (template && (issue.scope === "site" ? "@site" : matchingTemplate(issue.url, templates)) === template) selectedTemplateCount += 1;
  }
  return { severity, selectedRuleCount: ruleId ? selectedRuleCount : null, selectedTemplateCount: template ? selectedTemplateCount : null };
}

function deadline(policy: SnapshotV2["config"], evaluatedAt: string): string {
  const now = new Date(evaluatedAt).getTime();
  const next = policy.suppressions.flatMap((entry) => entry.expiresAt ? [new Date(`${entry.expiresAt}T23:59:59.999Z`).getTime() + 1] : [])
    .filter((value) => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0];
  return next === undefined ? "none" : new Date(next).toISOString();
}

const cache = new Map<string, TrendSummaryV1>();

/** Reads at most the latest snapshot and one adjacent history pair at a time. Never fetches pages. */
export async function calculateTrendSummary(directory: string, options: TrendOptions = {}): Promise<TrendSummaryV1> {
  const limit = options.limit ?? 20;
  if (limit !== 20 && limit !== 50 && limit !== 100) throw new Error("trend limit must be 20, 50, or 100");
  const catalog = await readHistoryCatalog(directory);
  const siteUrl = options.siteUrl ?? catalog.entries[0]?.siteUrl ?? null;
  const selected = catalog.entries.filter((entry) => entry.siteUrl === siteUrl).slice(0, limit).reverse();
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error("invalid trend evaluation time");
  const warnings = [...catalog.warnings];
  const rules = getRuleDefinitions().map((rule) => rule.id);
  if (selected.length === 0) return { schemaVersion: 1, siteUrl, revision: catalog.revision, evaluatedAt, limit,
    selectedRule: options.ruleId ?? null, selectedTemplate: options.template ?? null, templates: [], rules, points: [], warnings };
  let latestData: { policy: SnapshotV2["config"]; templates: string[] } | null = null;
  const unreadable = new Set<string>();
  for (const entry of [...selected].reverse()) {
    options.signal?.throwIfAborted();
    try {
      const latest = await readCatalogSnapshot(directory, entry);
      latestData = { policy: latest.config, templates: groupPageTemplates(latest.pages.map((page) => page.url))
        .map((group) => group.origin + group.template).sort((left, right) => {
          const specificity = (value: string) => value.split("/").filter((segment) => segment && !segment.startsWith(":")).length;
          return specificity(right) - specificity(left) || right.length - left.length || left.localeCompare(right);
        }) };
      break;
    } catch (error) { unreadable.add(entry.runId); warnings.push(`${entry.runId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!latestData) return { schemaVersion: 1, siteUrl, revision: catalog.revision, evaluatedAt, limit,
    selectedRule: options.ruleId ?? null, selectedTemplate: options.template ?? null, templates: [], rules, points: [], warnings };
  const { templates, policy } = latestData;
  const key = createHash("sha256").update(JSON.stringify({ revision: catalog.revision, ids: selected.map((entry) => entry.runId), siteUrl,
    limit, ruleId: options.ruleId, template: options.template, policy, engine: ENGINE_VERSION, rules: RULE_SET_VERSION,
    suppressionDeadline: deadline(policy, evaluatedAt) })).digest("hex");
  if (!options.evaluatedAt && cache.has(key)) return cache.get(key)!;
  const points: TrendPointV1[] = [];
  let previous: { entry: HistoryCatalogEntry; snapshot: SnapshotV2 } | null = null;
  for (const [index, entry] of selected.entries()) {
    options.signal?.throwIfAborted();
    let snapshot: SnapshotV2;
    if (unreadable.has(entry.runId)) { previous = null; continue; }
    try { snapshot = await readCatalogSnapshot(directory, entry); }
    catch (error) { warnings.push(`${entry.runId}: ${error instanceof Error ? error.message : String(error)}`); previous = null; continue; }
    const evaluated = withPolicy(snapshot, policy);
    const counts = countIssues(audit(evaluated, { now: evaluatedAt }), templates, options.ruleId, options.template);
    const comparison = previous ? buildLocalComparison(withPolicy(previous.snapshot, policy), evaluated, { evaluatedAt }).summary : null;
    const pointWarnings: string[] = comparison ? [...comparison.warnings] : [];
    if (comparison && (comparison.coverage.onlyBefore > 0 || comparison.coverage.onlyAfter > 0)) pointWarnings.push("coverage-changed");
    if (index > 0 && !previous) pointWarnings.push("history-gap");
    points.push({ runId: entry.runId, generatedAt: entry.generatedAt, pages: snapshot.pages.length,
      partial: snapshot.partial, truncated: snapshot.truncated, ...counts,
      verifiedNew: comparison?.lifecycle.new ?? null, verifiedResolved: comparison?.lifecycle.resolved ?? null,
      unverified: comparison?.unverified.length ?? null, warnings: pointWarnings, previousRunId: previous?.entry.runId ?? null });
    previous = { entry, snapshot };
    options.onProgress?.(index + 1, selected.length);
  }
  const result: TrendSummaryV1 = { schemaVersion: 1, siteUrl, revision: catalog.revision, evaluatedAt, limit,
    selectedRule: options.ruleId ?? null, selectedTemplate: options.template ?? null, templates, rules, points, warnings };
  if (!options.evaluatedAt && !options.signal?.aborted) { cache.set(key, result); if (cache.size > 8) cache.delete(cache.keys().next().value!); }
  return result;
}
