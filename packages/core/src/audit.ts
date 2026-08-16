import type { BaselineInput } from "./baseline.js";
import { evaluateCurrentRules } from "./rules/current.js";
import { applyRulePolicy } from "./rules/policy.js";
import type { RuleSet } from "./rules/types.js";
import { normalizeSnapshotInput } from "./snapshot-input.js";
import type { Issue, SnapshotV2 } from "./types.js";

export type { RuleDefinition, RuleSet } from "./rules/types.js";
export { applyRulePolicy } from "./rules/policy.js";
export { createIssue, getRuleDefinitions, issueFingerprint, RULE_REGISTRY } from "./rules/registry.js";

export function audit(snapshotInput: SnapshotV2 | BaselineInput, ruleSet: RuleSet = {}): Issue[] {
  const snapshot = normalizeSnapshotInput(snapshotInput);
  return applyRulePolicy(evaluateCurrentRules(snapshot), snapshot, ruleSet);
}

export const auditBaseline = audit;
