import { audit } from "./audit.js";
import type { BaselineInput } from "./baseline.js";
import { applyRulePolicy, sortIssues } from "./rules/policy.js";
import { evaluateRegressionRules } from "./rules/regression.js";
import type { RuleSet } from "./rules/types.js";
import { normalizeSnapshotInput } from "./snapshot-input.js";
import type { DiffResult, Issue, SnapshotV2 } from "./types.js";

export function compareBaselines(
  baselineInput: SnapshotV2 | BaselineInput,
  currentInput: SnapshotV2 | BaselineInput,
  ruleSet: RuleSet = {},
): Issue[] {
  const baseline = normalizeSnapshotInput(baselineInput);
  const current = normalizeSnapshotInput(currentInput);
  return applyRulePolicy(evaluateRegressionRules(baseline, current), current, ruleSet);
}

function lifecycle(issue: Issue, value: NonNullable<Issue["lifecycle"]>): Issue {
  return { ...issue, lifecycle: value };
}

export function diff(
  previousInput: SnapshotV2 | BaselineInput,
  currentInput: SnapshotV2 | BaselineInput,
  ruleSet: RuleSet = {},
): DiffResult {
  const previous = normalizeSnapshotInput(previousInput);
  const current = normalizeSnapshotInput(currentInput);
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
