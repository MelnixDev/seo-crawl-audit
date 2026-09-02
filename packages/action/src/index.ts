import * as action from "@actions/core";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig, readSnapshot, writeReport } from "@seo-crawl-audit/core/node";
import { runAction } from "./runner.js";

runAction({
  url: action.getInput("url"),
  baseline: action.getInput("baseline"),
  config: action.getInput("config"),
  failOn: action.getInput("fail-on"),
  report: action.getInput("report"),
  headersEnv: action.getInput("headers-env"),
}, {
  loadConfig,
  readSnapshot,
  writeReport,
  async writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  },
  resolvePath: resolve,
  info: action.info,
  annotateError(issue) {
    action.error(`${issue.ruleId}: ${issue.message} (${issue.url})`, {
      title: `SEO regression · ${issue.ruleId}`,
    });
  },
  setOutput: action.setOutput,
  setFailed: action.setFailed,
  async writeSummary(summary) {
    if (!process.env.GITHUB_STEP_SUMMARY) return;
    await action.summary
      .addHeading("SEO Crawl Audit")
      .addRaw(`Scanned **${summary.pages}** page(s). Found **${summary.counts.error}** error(s), **${summary.counts.warning}** warning(s), and **${summary.counts.info}** informational finding(s).`)
      .addTable([
        [{ data: "Severity", header: true }, { data: "Rule", header: true }, { data: "URL", header: true }],
        ...summary.issues.slice(0, 25).map((issue) => [issue.severity, issue.ruleId, issue.url]),
      ])
      .write();
  },
}).catch((error: unknown) => {
  action.setFailed(error instanceof Error ? error.message : String(error));
});
