import type { Issue, Severity } from "@seo-crawl-audit/core";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export interface IssueSummary {
  error: number;
  warning: number;
  info: number;
}

function color(code: string, value: string): string {
  return useColor ? `\u001b[${code}m${value}\u001b[0m` : value;
}

export function summarizeIssues(issues: readonly Issue[]): IssueSummary {
  return issues.reduce(
    (summary, issue) => {
      summary[issue.severity] += 1;
      return summary;
    },
    { error: 0, warning: 0, info: 0 } satisfies Record<Severity, number>,
  );
}

export function printIssues(issues: readonly Issue[]): void {
  if (issues.length === 0) {
    console.log(color("32", "✓ No SEO regressions detected."));
    return;
  }

  for (const issue of issues) {
    const marker =
      issue.severity === "error"
        ? color("31", "✖ error")
        : issue.severity === "warning"
          ? color("33", "⚠ warning")
          : color("34", "ℹ info");
    console.log(`${marker}  ${issue.rule}  ${issue.url}`);
    console.log(`  ${issue.message}`);

    if (issue.before !== undefined || issue.after !== undefined) {
      console.log(`  before: ${JSON.stringify(issue.before)}`);
      console.log(`  after:  ${JSON.stringify(issue.after)}`);
    }
  }

  const summary = summarizeIssues(issues);
  console.log(
    `\n${summary.error} error(s), ${summary.warning} warning(s) detected.`,
  );
}
