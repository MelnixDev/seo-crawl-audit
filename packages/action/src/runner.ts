import {
  audit,
  diff,
  resolveConfig,
  scan as coreScan,
  type Issue,
  type ReportData,
  type ScanConfigV1,
  type ScanResult,
  type Severity,
  type SnapshotV2,
} from "@seo-crawl-audit/core";

export interface ActionInputs {
  url?: string;
  baseline?: string;
  config?: string;
  failOn?: string;
  report?: string;
}

export interface ActionSummary {
  url: string;
  pages: number;
  counts: Record<Severity, number>;
  issues: Issue[];
}

export interface ActionAdapters {
  loadConfig(path: string): Promise<Partial<ScanConfigV1>>;
  readSnapshot(path: string): Promise<SnapshotV2>;
  writeReport(path: string, data: ReportData): Promise<void>;
  writeJson(path: string, value: unknown): Promise<void>;
  resolvePath(path: string): string;
  scan?: typeof coreScan;
  info(message: string): void;
  annotateError(issue: Issue): void;
  setOutput(name: "report" | "summary", value: string): void;
  setFailed(message: string): void;
  writeSummary?(summary: ActionSummary): Promise<void>;
}

export interface ActionRunResult {
  reportPath: string;
  summaryPath: string;
  scan: ScanResult;
  issues: Issue[];
  blocked: boolean;
  complete: boolean;
}

export function thresholdBlocks(severity: Severity, threshold: string): boolean {
  if (threshold === "none") return false;
  if (threshold === "warning") return severity === "error" || severity === "warning";
  return severity === "error";
}

function isMissingDefaultConfig(error: unknown, path: string): boolean {
  return path === "seo-audit.config.json"
    && error instanceof Error
    && /ENOENT/.test(`${error.message} ${String(error.cause)}`);
}

export async function runAction(inputs: ActionInputs, adapters: ActionAdapters): Promise<ActionRunResult> {
  const threshold = inputs.failOn || "error";
  if (!["error", "warning", "none"].includes(threshold)) {
    throw new Error("fail-on must be error, warning, or none");
  }

  const configPath = inputs.config || "seo-audit.config.json";
  const configFile = await adapters.loadConfig(configPath).catch<Partial<ScanConfigV1>>((error: unknown) => {
    if (isMissingDefaultConfig(error, configPath)) return {};
    throw error;
  });
  const baselinePath = inputs.baseline || null;
  const baseline = baselinePath ? await adapters.readSnapshot(baselinePath) : null;
  const url = inputs.url || configFile.url || baseline?.siteUrl;
  if (!url) throw new Error("Provide the url input, config url, or a baseline containing siteUrl.");

  const config = resolveConfig({ schemaVersion: 1, url }, configFile, baseline?.config ?? {});
  const runScan = adapters.scan ?? coreScan;
  const result = await runScan(config, {
    onEvent(event) {
      if (event.type === "progress" && (event.completed === event.total || event.completed % 25 === 0)) {
        adapters.info(`Scanned ${event.completed}/${event.total} pages`);
      }
    },
  });
  const currentIssues = audit(result.snapshot);
  const comparison = baseline ? diff(baseline, result.snapshot) : null;
  const issues = comparison?.newIssues ?? currentIssues;
  const reportPath = adapters.resolvePath(inputs.report || "seo-audit-report.html");
  const summaryPath = `${reportPath}.json`;
  const reportData: ReportData = {
    mode: baseline ? "check" : "scan",
    startUrl: url,
    generatedAt: result.snapshot.generatedAt,
    pages: result.snapshot.pages,
    issues,
    ...(comparison ?? {}),
    partial: result.snapshot.partial,
    complete: comparison?.complete ?? !result.snapshot.partial,
    engineVersion: result.snapshot.engineVersion,
    ruleSetVersion: result.snapshot.ruleSetVersion,
    branding: config.report,
  };
  const counts = issues.reduce<Record<Severity, number>>((summary, issue) => {
    summary[issue.severity] += 1;
    return summary;
  }, { error: 0, warning: 0, info: 0 });
  const summary = {
    url,
    generatedAt: result.snapshot.generatedAt,
    pages: result.snapshot.pages.length,
    partial: result.snapshot.partial,
    complete: comparison?.complete ?? !result.snapshot.partial,
    counts,
    issues,
    lifecycle: comparison,
  };

  await adapters.writeReport(reportPath, reportData);
  await adapters.writeJson(summaryPath, summary);
  adapters.setOutput("report", reportPath);
  adapters.setOutput("summary", summaryPath);
  for (const issue of issues.filter((candidate) => candidate.severity === "error")) {
    adapters.annotateError(issue);
  }
  await adapters.writeSummary?.({ url, pages: result.snapshot.pages.length, counts, issues });
  adapters.info("HTML and JSON outputs are ready. Use actions/upload-artifact with the report and summary outputs to retain them.");

  const blocked = issues.some((issue) => thresholdBlocks(issue.severity, threshold))
    || (comparison?.budgetExceeded.length ?? 0) > 0;
  if (blocked) adapters.setFailed(`SEO Crawl Audit found findings at or above the ${threshold} threshold.`);
  return {
    reportPath,
    summaryPath,
    scan: result,
    issues,
    blocked,
    complete: summary.complete,
  };
}
