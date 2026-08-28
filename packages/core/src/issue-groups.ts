import type { Issue, IssueTemplateGroup, Severity } from "./types.js";

type GroupableIssue = Pick<Issue, "url" | "ruleId" | "severity" | "owner">;

interface ParsedIssueUrl {
  issue: GroupableIssue;
  url: URL;
  segments: string[];
}

function segmentToken(segment: string): string | null {
  if (/^\d+$/.test(segment)) return ":id";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return ":uuid";
  if (/^\d{4}-\d{2}-\d{2}$/.test(segment)) return ":date";
  if (/^[0-9a-f]{16,}$/i.test(segment)) return ":hash";
  return null;
}

function parseIssueUrls(issues: readonly GroupableIssue[]): ParsedIssueUrl[] {
  return issues.flatMap((issue) => {
    try {
      const url = new URL(issue.url);
      return [{ issue, url, segments: url.pathname.split("/").filter(Boolean) }];
    } catch {
      return [];
    }
  });
}

function dynamicSegments(pages: readonly ParsedIssueUrl[]): Set<string> {
  const siblings = new Map<string, Set<string>>();
  for (const page of pages) {
    for (let index = 1; index < page.segments.length; index += 1) {
      if (segmentToken(page.segments[index]!)) continue;
      const prefix = page.segments.slice(0, index).join("/");
      const key = `${page.url.origin}|${page.segments.length}|${index}|${prefix}`;
      const values = siblings.get(key) ?? new Set<string>();
      values.add(page.segments[index]!);
      siblings.set(key, values);
    }
  }
  return new Set([...siblings].filter(([, values]) => values.size >= 2).map(([key]) => key));
}

function templateFor(page: ParsedIssueUrl, dynamic: ReadonlySet<string>): string {
  const segments = page.segments.map((segment, index) => {
    const token = segmentToken(segment);
    if (token) return token;
    const prefix = page.segments.slice(0, index).join("/");
    const key = `${page.url.origin}|${page.segments.length}|${index}|${prefix}`;
    return index > 0 && dynamic.has(key) ? ":slug" : segment;
  });
  return `/${segments.join("/")}${page.url.pathname.endsWith("/") && segments.length > 0 ? "/" : ""}`;
}

/** Groups findings by an inferred URL template without changing issue identity. */
export function groupIssuesByTemplate(issues: readonly GroupableIssue[]): IssueTemplateGroup[] {
  const pages = parseIssueUrls(issues);
  const dynamic = dynamicSegments(pages);
  const grouped = new Map<string, { origin: string; template: string; issues: GroupableIssue[]; urls: Set<string> }>();
  for (const page of pages) {
    const template = templateFor(page, dynamic);
    const key = `${page.url.origin}${template}`;
    const group = grouped.get(key) ?? { origin: page.url.origin, template, issues: [], urls: new Set<string>() };
    group.issues.push(page.issue);
    group.urls.add(page.issue.url);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => {
    const severities: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    const rules: Record<string, number> = {};
    const owners: Record<string, number> = {};
    for (const issue of group.issues) {
      severities[issue.severity] += 1;
      rules[issue.ruleId] = (rules[issue.ruleId] ?? 0) + 1;
      owners[issue.owner] = (owners[issue.owner] ?? 0) + 1;
    }
    const urls = [...group.urls].sort();
    return {
      origin: group.origin,
      template: group.template,
      issueCount: group.issues.length,
      affectedPages: urls.length,
      severities,
      rules,
      owners,
      urls,
      representativeUrls: urls.slice(0, 3),
    };
  }).sort((left, right) => right.issueCount - left.issueCount || left.template.localeCompare(right.template) || left.origin.localeCompare(right.origin));
}
