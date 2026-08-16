import type { Issue, Severity, SnapshotV2, Suppression } from "../types.js";
import type { RuleSet } from "./types.js";

const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function globMatches(url: string, pattern: string): boolean {
  const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  const regex = new RegExp(`^${expression}$`);
  return regex.test(pathname) || regex.test(url);
}

function activeSuppression(issue: Issue, suppressions: Suppression[], now: Date): Suppression | null {
  return suppressions.find((suppression) => {
    if (suppression.rule !== issue.ruleId || !globMatches(issue.url, suppression.urlPattern)) return false;
    if (!suppression.expiresAt) return true;
    return new Date(`${suppression.expiresAt}T23:59:59.999Z`).getTime() >= now.getTime();
  }) ?? null;
}

export function sortIssues(issues: Issue[]): Issue[] {
  return issues.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || left.url.localeCompare(right.url)
    || left.ruleId.localeCompare(right.ruleId)
    || left.fingerprint.localeCompare(right.fingerprint));
}

export function applyRulePolicy(issues: Issue[], snapshot: SnapshotV2, ruleSet: RuleSet = {}): Issue[] {
  const enabled = ruleSet.enabledRules ?? snapshot.config.enabledRules;
  const enabledSet = enabled ? new Set(enabled) : null;
  const overrides = { ...snapshot.config.severityOverrides, ...(ruleSet.severityOverrides ?? {}) };
  const suppressions = ruleSet.suppressions ?? snapshot.config.suppressions;
  const now = new Date(ruleSet.now ?? Date.now());
  return sortIssues(issues
    .filter((candidate) => !enabledSet || enabledSet.has(candidate.ruleId))
    .map((candidate) => ({ ...candidate, severity: overrides[candidate.ruleId] ?? candidate.severity }))
    .filter((candidate) => !activeSuppression(candidate, suppressions, now)));
}
