import { audit } from "./audit.js";
import { diff } from "./compare.js";
import { groupPageTemplates } from "./issue-groups.js";
import type { DiffResult, Issue, Severity, SnapshotV2 } from "./types.js";

export type ComparisonWarning = "incomplete-before" | "incomplete-after" | "configuration-changed" | "rule-set-changed" | "evaluation-policy-changed";
type Lifecycle = "new" | "ongoing" | "resolved" | "unchanged";
type Counts = Record<Lifecycle, number>;

export interface ComparisonGroup {
  id: string;
  counts: Counts;
  affectedPages: number;
}

export interface ComparisonSummaryV1 {
  schemaVersion: 1;
  evaluatedAt: string;
  from: { generatedAt: string; siteUrl: string; pages: number; partial: boolean; truncated: boolean; configurationHash: string; engineVersion: string; ruleSetVersion: string };
  to: ComparisonSummaryV1["from"];
  coverage: { common: number; onlyBefore: number; onlyAfter: number; complete: boolean };
  warnings: ComparisonWarning[];
  beforeFindings: Record<Severity, number>;
  afterFindings: Record<Severity, number>;
  lifecycle: Counts;
  byRule: ComparisonGroup[];
  byTemplate: ComparisonGroup[];
  unverified: Array<{ fingerprint: string; ruleId: string; url: string; reason: string }>;
}

function descriptor(snapshot: SnapshotV2): ComparisonSummaryV1["from"] {
  return {
    generatedAt: snapshot.generatedAt, siteUrl: snapshot.siteUrl, pages: snapshot.pages.length,
    partial: snapshot.partial, truncated: snapshot.truncated, configurationHash: snapshot.configurationHash,
    engineVersion: snapshot.engineVersion, ruleSetVersion: snapshot.ruleSetVersion,
  };
}

function findingCounts(issues: readonly Issue[]): Record<Severity, number> {
  const result = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) result[issue.severity] += 1;
  return result;
}

function lifecycleCounts(): Counts { return { new: 0, ongoing: 0, resolved: 0, unchanged: 0 }; }

const STATUS_RULES = new Set(["page-unreachable", "http-error", "robots-blocked", "redirect-loop", "long-redirect-chain"]);

function hasResolutionEvidence(issue: Issue, current: SnapshotV2, pages: ReadonlyMap<string, SnapshotV2["pages"][number]>): string | null {
  if (issue.scope === "site") return current.partial || current.truncated ? "incomplete-site" : null;
  const page = pages.get(issue.url);
  if (!page) return "not-checked";
  if (page.blockedByRobots) return "robots-blocked";
  if (page.error || page.status === null || page.status >= 400) return "request-failed";
  if (STATUS_RULES.has(issue.ruleId)) return null;
  if (page.status >= 300 || !page.contentType || !/(?:text\/html|application\/xhtml\+xml)/i.test(page.contentType)) return "html-unavailable";
  return null;
}

function groups(entries: Array<{ lifecycle: Lifecycle; issue: Issue }>, key: (issue: Issue) => string): ComparisonGroup[] {
  const indexed = new Map<string, { counts: Counts; pages: Set<string> }>();
  for (const { lifecycle, issue } of entries) {
    const id = key(issue);
    const group = indexed.get(id) ?? { counts: lifecycleCounts(), pages: new Set<string>() };
    group.counts[lifecycle] += 1;
    if (issue.scope === "page") group.pages.add(issue.url);
    indexed.set(id, group);
  }
  return [...indexed].map(([id, value]) => ({ id, counts: value.counts, affectedPages: value.pages.size }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Re-evaluates both stored runs using the selected current policy and one evaluation time. */
export function buildLocalComparison(previous: SnapshotV2, current: SnapshotV2, options: { evaluatedAt: string }): { diff: DiffResult; summary: ComparisonSummaryV1 } {
  if (previous.siteUrl !== current.siteUrl) throw new Error("local history snapshots must have the same site URL");
  const effective = current.config;
  const sharedPolicy = (snapshot: SnapshotV2): SnapshotV2 => ({ ...snapshot, config: {
    ...snapshot.config,
    enabledRules: effective.enabledRules,
    severityOverrides: effective.severityOverrides,
    suppressions: effective.suppressions,
    regressionBudgets: effective.regressionBudgets,
  } });
  const before = sharedPolicy(previous);
  const after = sharedPolicy(current);
  const ruleSet = { now: options.evaluatedAt };
  const beforeFindings = audit(before, ruleSet);
  const afterFindings = audit(after, ruleSet);
  const raw = diff(before, after, ruleSet);
  const unverified: ComparisonSummaryV1["unverified"] = [];
  const currentPages = new Map(current.pages.map((page) => [page.url, page]));
  const resolvedIssues = raw.resolvedIssues.filter((issue) => {
    const reason = hasResolutionEvidence(issue, current, currentPages);
    if (reason) unverified.push({ fingerprint: issue.fingerprint, ruleId: issue.ruleId, url: issue.url, reason });
    return !reason;
  });
  const comparison = { ...raw, resolvedIssues };
  const beforeUrls = new Set(previous.pages.map((page) => page.url));
  const afterUrls = new Set(current.pages.map((page) => page.url));
  const common = [...beforeUrls].filter((url) => afterUrls.has(url)).length;
  const warnings: ComparisonWarning[] = [];
  if (previous.partial || previous.truncated) warnings.push("incomplete-before");
  if (current.partial || current.truncated) warnings.push("incomplete-after");
  if (previous.configurationHash !== current.configurationHash) warnings.push("configuration-changed");
  if (previous.ruleSetVersion !== current.ruleSetVersion) warnings.push("rule-set-changed");
  if (JSON.stringify(previous.config.enabledRules) !== JSON.stringify(effective.enabledRules)
    || JSON.stringify(previous.config.severityOverrides) !== JSON.stringify(effective.severityOverrides)
    || JSON.stringify(previous.config.suppressions) !== JSON.stringify(effective.suppressions)) warnings.push("evaluation-policy-changed");
  const entries: Array<{ lifecycle: Lifecycle; issue: Issue }> = [
    ...comparison.newIssues.map((issue) => ({ lifecycle: "new" as const, issue })),
    ...comparison.ongoingIssues.map((issue) => ({ lifecycle: "ongoing" as const, issue })),
    ...comparison.resolvedIssues.map((issue) => ({ lifecycle: "resolved" as const, issue })),
    ...comparison.unchangedIssues.map((issue) => ({ lifecycle: "unchanged" as const, issue })),
  ];
  const lifecycle = lifecycleCounts();
  for (const entry of entries) lifecycle[entry.lifecycle] += 1;
  const templates = groupPageTemplates([...new Set([...beforeUrls, ...afterUrls])]);
  const templateByUrl = new Map(templates.flatMap((group) => group.urls.map((url) => [url, group.origin + group.template] as const)));
  return { diff: comparison, summary: {
    schemaVersion: 1, evaluatedAt: options.evaluatedAt, from: descriptor(previous), to: descriptor(current),
    coverage: { common, onlyBefore: beforeUrls.size - common, onlyAfter: afterUrls.size - common,
      complete: !(previous.partial || previous.truncated || current.partial || current.truncated) },
    warnings, beforeFindings: findingCounts(beforeFindings), afterFindings: findingCounts(afterFindings),
    lifecycle, byRule: groups(entries, (issue) => issue.ruleId),
    byTemplate: groups(entries, (issue) => issue.scope === "site" ? "@site" : templateByUrl.get(issue.url) ?? "@unknown"),
    unverified: unverified.sort((left, right) => left.url.localeCompare(right.url) || left.ruleId.localeCompare(right.ruleId)),
  } };
}
