import type * as ActionCore from "@actions/core";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  audit,
  diff,
  resolveConfig,
  scan,
  type Issue,
  type ScanConfigV1,
  type Severity,
} from "@seo-crawl-audit/core";
import { loadConfig, readSnapshot, writeReport } from "@seo-crawl-audit/core/node";

export function thresholdBlocks(severity: Severity, threshold: string): boolean {
  if (threshold === "none") return false;
  if (threshold === "warning") return severity === "error" || severity === "warning";
  return severity === "error";
}

export async function runAction(action: typeof ActionCore): Promise<void> {
  const configPath = action.getInput("config") || "seo-audit.config.json";
  const configFile: Partial<ScanConfigV1> = await loadConfig(configPath).catch((error: unknown) => {
    if (configPath === "seo-audit.config.json" && error instanceof Error && /ENOENT/.test(String(error.cause))) return {};
    throw error;
  });
  const baselinePath = action.getInput("baseline") || null;
  const baseline = baselinePath ? await readSnapshot(baselinePath) : null;
  const url = action.getInput("url") || configFile.url || baseline?.siteUrl;
  if (!url) throw new Error("Provide the url input, config url, or a baseline containing siteUrl.");
  const config = resolveConfig({ schemaVersion: 1, url }, configFile, baseline?.config ?? {});
  const result = await scan(config, {
    onEvent(event) {
      if (event.type === "progress" && (event.completed === event.total || event.completed % 25 === 0)) {
        action.info(`Scanned ${event.completed}/${event.total} pages`);
      }
    },
  });
  const currentIssues = audit(result.snapshot);
  const comparison = baseline ? diff(baseline, result.snapshot) : null;
  const issues = comparison?.newIssues ?? currentIssues;
  const reportPath = resolve(action.getInput("report") || "seo-audit-report.html");
  const summaryPath = `${reportPath}.json`;
  const reportData = {
    mode: baseline ? "check" as const : "scan" as const,
    startUrl: url,
    generatedAt: result.snapshot.generatedAt,
    pages: result.snapshot.pages,
    issues,
    ...(comparison ?? {}),
    partial: result.snapshot.partial,
    engineVersion: result.snapshot.engineVersion,
    ruleSetVersion: result.snapshot.ruleSetVersion,
    branding: config.report,
  };
  const summary = {
    url,
    generatedAt: result.snapshot.generatedAt,
    pages: result.snapshot.pages.length,
    partial: result.snapshot.partial,
    complete: comparison?.complete ?? !result.snapshot.partial,
    counts: issues.reduce((counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }), { error: 0, warning: 0, info: 0 }),
    issues,
    lifecycle: comparison,
  };
  await writeReport(reportPath, reportData);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  action.setOutput("report", reportPath);
  action.setOutput("summary", summaryPath);

  for (const issue of issues.filter((candidate) => candidate.severity === "error")) {
    action.error(`${issue.ruleId}: ${issue.message} (${issue.url})`, { title: `SEO regression · ${issue.ruleId}` });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await action.summary
      .addHeading("SEO Crawl Audit")
      .addRaw(`Scanned **${result.snapshot.pages.length}** page(s). Found **${summary.counts.error}** error(s), **${summary.counts.warning}** warning(s), and **${summary.counts.info}** informational finding(s).`)
      .addTable([
        [{ data: "Severity", header: true }, { data: "Rule", header: true }, { data: "URL", header: true }],
        ...issues.slice(0, 25).map((issue: Issue) => [issue.severity, issue.ruleId, issue.url]),
      ])
      .write();
  }

  action.info("HTML and JSON outputs are ready. Use actions/upload-artifact with the report and summary outputs to retain them.");
  const threshold = action.getInput("fail-on") || "error";
  if (!["error", "warning", "none"].includes(threshold)) throw new Error("fail-on must be error, warning, or none");
  if (issues.some((issue) => thresholdBlocks(issue.severity, threshold)) || (comparison?.budgetExceeded.length ?? 0) > 0) {
    action.setFailed(`SEO Crawl Audit found findings at or above the ${threshold} threshold.`);
  }
}
