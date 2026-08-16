import type { IssueOwner, IssueScope, Severity, Suppression } from "../types.js";

export interface RuleDefinition {
  readonly id: string;
  readonly severity: Severity;
  readonly owner: IssueOwner;
  readonly scope: IssueScope;
  readonly remediation: string;
}

export interface RuleSet {
  enabledRules?: string[] | null;
  severityOverrides?: Record<string, Severity>;
  suppressions?: Suppression[];
  now?: Date | string;
}
