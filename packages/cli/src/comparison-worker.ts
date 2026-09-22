import { parentPort, workerData } from "node:worker_threads";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildLocalComparison, renderReport, type ReportData } from "@seo-crawl-audit/core";
import { readCatalogSnapshot, type HistoryCatalogEntry } from "@seo-crawl-audit/core/node";

interface ComparisonWorkerInput {
  historyDirectory: string;
  outputDirectory: string;
  from: HistoryCatalogEntry;
  to: HistoryCatalogEntry;
  evaluatedAt: string;
}

async function run(input: ComparisonWorkerInput): Promise<void> {
  parentPort?.postMessage({ phase: "read" });
  const [previous, current] = await Promise.all([
    readCatalogSnapshot(input.historyDirectory, input.from),
    readCatalogSnapshot(input.historyDirectory, input.to),
  ]);
  if (previous.siteUrl !== current.siteUrl) throw new Error("history runs belong to different sites");
  parentPort?.postMessage({ phase: "evaluate" });
  const { diff, summary } = buildLocalComparison(previous, current, { evaluatedAt: input.evaluatedAt });
  parentPort?.postMessage({ phase: "render" });
  const reportData: ReportData = {
    mode: "check", startUrl: current.siteUrl, generatedAt: input.evaluatedAt,
    pages: current.pages, pageDetails: current.pages,
    issues: diff.newIssues, newIssues: diff.newIssues, ongoingIssues: diff.ongoingIssues,
    resolvedIssues: diff.resolvedIssues, unchangedIssues: diff.unchangedIssues,
    partial: current.partial, complete: summary.coverage.complete,
    engineVersion: current.engineVersion, ruleSetVersion: current.ruleSetVersion,
    branding: current.config.report,
  };
  const html = renderReport(reportData);
  parentPort?.postMessage({ phase: "write" });
  await mkdir(input.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(input.outputDirectory, "report.html"), html, "utf8"),
    writeFile(join(input.outputDirectory, "summary.json"), `${JSON.stringify({ summary, diff })}\n`, "utf8"),
  ]);
  parentPort?.postMessage({ phase: "complete" });
}

void run(workerData as ComparisonWorkerInput).catch((error: unknown) => {
  parentPort?.postMessage({ phase: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
