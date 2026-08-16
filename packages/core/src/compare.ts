import { applyRulePolicy, audit, createIssue, type RuleSet } from "./audit.js";
import { createBaseline, type BaselineInput } from "./baseline.js";
import type { DiffResult, Issue, PageSnapshot, Severity, SnapshotV2 } from "./types.js";

const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function hasDirective(value: string | null | undefined, directive: string): boolean {
  return new RegExp(`(^|[\\s,])${directive}($|[\\s,])`, "i").test(value ?? "");
}

function snapshot(input: SnapshotV2 | BaselineInput): SnapshotV2 {
  if (input.schemaVersion === 2) return input as SnapshotV2;
  const legacy = input as BaselineInput;
  const firstPage = legacy.pages?.[0];
  const firstPageUrl = firstPage && typeof firstPage === "object" ? (firstPage as { url?: unknown }).url : undefined;
  const firstUrl = typeof firstPageUrl === "string" ? firstPageUrl : legacy.source?.startUrl ?? "https://invalid.local/";
  return createBaseline({
    ...legacy,
    startUrl: legacy.siteUrl ?? legacy.source?.startUrl ?? firstUrl,
    robots: legacy.robots ?? { url: new URL("/robots.txt", firstUrl).href, status: null, sha256: null, error: null },
    options: legacy.config ?? legacy.options ?? {},
  });
}

function changedIssue(ruleId: string, url: string, message: string, before: unknown, after: unknown): Issue {
  const candidate = createIssue(ruleId, url, message, { before, after, actual: after });
  candidate.before = before;
  candidate.after = after;
  return candidate;
}

function sortIssues(issues: Issue[]): Issue[] {
  return issues.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.url.localeCompare(right.url) || left.ruleId.localeCompare(right.ruleId));
}

export function compareBaselines(
  baselineInput: SnapshotV2 | BaselineInput,
  currentInput: SnapshotV2 | BaselineInput,
  ruleSet: RuleSet = {},
): Issue[] {
  const baseline = snapshot(baselineInput);
  const current = snapshot(currentInput);
  const complete = !current.partial && !current.truncated;
  const issues: Issue[] = [];
  const currentPages = new Map(current.pages.map((page) => [page.url, page]));

  if (baseline.robots.sha256 && current.robots.sha256 && baseline.robots.sha256 !== current.robots.sha256) {
    issues.push(changedIssue("robots-changed", current.robots.url, "robots.txt content changed", baseline.robots.sha256, current.robots.sha256));
  }
  const previousSitemapCount = baseline.sitemap?.urls.length ?? 0;
  const currentSitemapCount = current.sitemap?.urls.length ?? 0;
  const sitemapDrop = previousSitemapCount - currentSitemapCount;
  if (complete && previousSitemapCount > 0 && sitemapDrop >= Math.max(5, Math.ceil(previousSitemapCount * 0.2))) {
    issues.push(changedIssue("sitemap-url-count-drop", current.sitemap?.url ?? baseline.sitemap?.url ?? current.siteUrl, `Sitemap URL count dropped by ${sitemapDrop}`, previousSitemapCount, currentSitemapCount));
  }

  for (const before of baseline.pages) {
    const after = currentPages.get(before.url) as PageSnapshot | undefined;
    if (!after) {
      if (complete) issues.push(changedIssue("page-missing", before.url, "Page was not checked", before.status, null));
      continue;
    }
    if (after.blockedByRobots && !before.blockedByRobots) { issues.push(changedIssue("robots-blocked", before.url, "Page is now blocked by robots.txt", false, true)); continue; }
    if (after.error && !before.error) { issues.push(changedIssue(after.error.includes("redirect loop") ? "redirect-loop" : "page-unreachable", before.url, `Page request failed: ${after.error}`, before.error, after.error)); continue; }
    if (before.status !== null && before.status < 400 && (after.status === null || after.status >= 400)) issues.push(changedIssue("status-regression", before.url, `HTTP status regressed from ${before.status} to ${after.status ?? "none"}`, before.status, after.status));
    const beforeRobots = `${before.robots ?? ""},${before.xRobotsTag ?? ""}`;
    const afterRobots = `${after.robots ?? ""},${after.xRobotsTag ?? ""}`;
    if (!hasDirective(beforeRobots, "noindex") && hasDirective(afterRobots, "noindex")) issues.push(changedIssue("new-noindex", before.url, "Page now contains a noindex directive", beforeRobots, afterRobots));
    if (before.title && !after.title) issues.push(changedIssue("title-removed", before.url, "Page title was removed", before.title, after.title));
    else if (before.title && after.title && before.title !== after.title) issues.push(changedIssue("title-changed", before.url, "Page title changed", before.title, after.title));
    if (before.description && !after.description) issues.push(changedIssue("description-removed", before.url, "Meta description was removed", before.description, after.description));
    if (before.canonical && !after.canonical) issues.push(changedIssue("canonical-removed", before.url, "Canonical URL was removed", before.canonical, after.canonical));
    else if (before.canonical && after.canonical && before.canonical !== after.canonical) {
      const candidate = changedIssue("canonical-changed", before.url, "Canonical URL changed", before.canonical, after.canonical);
      if (new URL(after.canonical).origin !== new URL(before.url).origin) candidate.severity = "error";
      issues.push(candidate);
    }
    if (before.h1Count > 0 && after.h1Count === 0) issues.push(changedIssue("h1-removed", before.url, "All H1 headings were removed", before.h1Count, after.h1Count));
    if (before.finalUrl && after.finalUrl && before.finalUrl !== after.finalUrl) {
      const candidate = changedIssue("redirect-changed", before.url, "Final redirect URL changed", before.finalUrl, after.finalUrl);
      if (new URL(after.finalUrl).origin !== new URL(before.url).origin) candidate.severity = "error";
      issues.push(candidate);
    }
  }
  return applyRulePolicy(sortIssues(issues), current, ruleSet);
}

function lifecycle(issue: Issue, value: Issue["lifecycle"]): Issue {
  return { ...issue, lifecycle: value };
}

export function diff(
  previousInput: SnapshotV2 | BaselineInput,
  currentInput: SnapshotV2 | BaselineInput,
  ruleSet: RuleSet = {},
): DiffResult {
  const previous = snapshot(previousInput);
  const current = snapshot(currentInput);
  const complete = !current.partial && !current.truncated;
  const checkedUrls = new Set(current.pages.map((page) => page.url));
  const previousIssues = new Map(audit(previous, ruleSet).map((candidate) => [candidate.fingerprint, candidate]));
  const currentIssues = new Map(audit(current, ruleSet).map((candidate) => [candidate.fingerprint, candidate]));
  const newIssues: Issue[] = [];
  const ongoingIssues: Issue[] = [];
  const unchangedIssues: Issue[] = [];
  const resolvedIssues: Issue[] = [];

  for (const [fingerprint, candidate] of currentIssues) {
    const before = previousIssues.get(fingerprint);
    if (!before) newIssues.push(lifecycle(candidate, "new"));
    else if (JSON.stringify(before.evidence) === JSON.stringify(candidate.evidence)) unchangedIssues.push(lifecycle(candidate, "unchanged"));
    else ongoingIssues.push(lifecycle({ ...candidate, before: before.evidence, after: candidate.evidence }, "ongoing"));
  }
  for (const [fingerprint, candidate] of previousIssues) {
    const evaluated = candidate.scope === "page" ? checkedUrls.has(candidate.url) : complete;
    if (evaluated && !currentIssues.has(fingerprint)) resolvedIssues.push(lifecycle(candidate, "resolved"));
  }
  const known = new Set(newIssues.map((candidate) => candidate.fingerprint));
  for (const regression of compareBaselines(previous, current, ruleSet)) {
    if (!known.has(regression.fingerprint)) newIssues.push(lifecycle(regression, "new"));
  }

  const budgets = { ...previous.config.regressionBudgets, ...current.config.regressionBudgets };
  const budgetExceeded = Object.entries(budgets).flatMap(([budget, allowed]) => {
    const actual = newIssues.filter((candidate) => candidate.severity === budget || candidate.ruleId === budget).length;
    return actual > allowed ? [{ budget, allowed, actual }] : [];
  });
  sortIssues(newIssues);
  sortIssues(ongoingIssues);
  sortIssues(unchangedIssues);
  sortIssues(resolvedIssues);
  return {
    complete,
    newIssues,
    ongoingIssues,
    resolvedIssues,
    unchangedIssues,
    issues: [...newIssues, ...ongoingIssues],
    budgetExceeded,
  };
}
