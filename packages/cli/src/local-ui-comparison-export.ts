import type { ComparisonSummaryV1 } from "@seo-crawl-audit/core";

function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function markdownCell(value: unknown): string {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`")
    .replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/[\r\n]+/g, " ");
}

export function comparisonCsv(summary: ComparisonSummaryV1): string {
  const rows: unknown[][] = [["scope", "id", "new", "ongoing", "resolved", "unchanged", "affected_pages", "before", "after", "coverage_complete"]];
  for (const [scope, groups] of [["rule", summary.byRule], ["template", summary.byTemplate]] as const) {
    for (const group of groups) rows.push([scope, group.id, group.counts.new, group.counts.ongoing, group.counts.resolved,
      group.counts.unchanged, group.affectedPages, summary.from.generatedAt, summary.to.generatedAt, summary.coverage.complete]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function comparisonMarkdown(summary: ComparisonSummaryV1): string {
  const lines = [
    "# SEO Crawl Audit — local comparison", "",
    `- Site: ${markdownCell(summary.to.siteUrl)}`,
    `- Before: ${markdownCell(summary.from.generatedAt)} (${summary.from.pages} checked pages)`,
    `- After: ${markdownCell(summary.to.generatedAt)} (${summary.to.pages} checked pages)`,
    `- Coverage: ${summary.coverage.common} common, ${summary.coverage.onlyBefore} only before, ${summary.coverage.onlyAfter} only after; ${summary.coverage.complete ? "complete" : "incomplete"}`,
    `- Findings: ${summary.lifecycle.new} new, ${summary.lifecycle.ongoing} ongoing, ${summary.lifecycle.resolved} resolved on checked pages, ${summary.unverified.length} unverified`,
    `- Warnings: ${summary.warnings.length ? summary.warnings.map(markdownCell).join(", ") : "none"}`,
    "- [Full HTML report](./comparison)", "",
  ];
  for (const [heading, groups] of [["Rules", summary.byRule], ["Page templates", summary.byTemplate]] as const) {
    lines.push(`## ${heading}`, "", "| Group | New | Ongoing | Resolved | Pages |", "| --- | ---: | ---: | ---: | ---: |");
    for (const group of groups.slice(0, 10)) lines.push(`| ${markdownCell(group.id)} | ${group.counts.new} | ${group.counts.ongoing} | ${group.counts.resolved} | ${group.affectedPages} |`);
    if (groups.length > 10) lines.push("", `${groups.length - 10} more groups omitted; download CSV for the full grouped summary.`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
