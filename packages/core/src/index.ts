import { audit as auditSnapshot, type RuleSet } from "./audit.js";
import { diff as diffSnapshots } from "./compare.js";
import type { DiffResult, Issue, SnapshotV2 } from "./types.js";

export { planScan } from "./planning.js";
export { scan } from "./api.js";
export { renderReport } from "./html-report.js";
export { migrateSnapshot } from "./baseline.js";
export { getRuleDefinitions } from "./rules/registry.js";
export { groupIssuesByTemplate } from "./issue-groups.js";
export { buildHistorySeries } from "./history.js";
export {
  DEFAULT_CONFIG_FILE,
  DEFAULT_SCAN_CONFIG,
  resolveConfig,
  validateConfig,
} from "./config.js";
export { ENGINE_VERSION, RULE_SET_VERSION } from "./version.js";

export type { RuleDefinition, RuleSet } from "./rules/types.js";
export type {
  CheckpointIdentity,
  CheckpointState,
  CheckpointStore,
  CrawlStatistics,
  DiffResult,
  EngineLogger,
  Issue,
  IssueOwner,
  IssueScope,
  IssueTemplateGroup,
  HistoryPoint,
  HistorySeries,
  HistorySnapshotRecord,
  LinkGraphSummary,
  PageSnapshot,
  PlanScanOptions,
  ReportBranding,
  ReportData,
  ReportOptions,
  RobotsState,
  ScanConfigInput,
  ScanConfigV1,
  ScanEvent,
  ScanOptions,
  ScanPlan,
  ScanResult,
  Severity,
  SitemapState,
  SnapshotV2,
  Suppression,
} from "./types.js";

export function audit(snapshot: SnapshotV2, ruleSet: RuleSet = {}): Issue[] {
  return auditSnapshot(snapshot, ruleSet);
}

export function diff(
  previous: SnapshotV2,
  current: SnapshotV2,
  ruleSet: RuleSet = {},
): DiffResult {
  return diffSnapshots(previous, current, ruleSet);
}
