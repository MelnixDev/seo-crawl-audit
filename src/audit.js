function addIssue(issues, severity, rule, page, message, after) {
  issues.push({
    severity,
    rule,
    url: page.url,
    message,
    before: undefined,
    after,
  });
}

export function auditBaseline(baseline) {
  const issues = [];

  for (const page of baseline.pages) {
    if (page.blockedByRobots) {
      addIssue(
        issues,
        "error",
        "robots-blocked",
        page,
        "Page is blocked by robots.txt",
        true,
      );
      continue;
    }

    if (page.error) {
      addIssue(
        issues,
        "error",
        "page-unreachable",
        page,
        `Page request failed: ${page.error}`,
        page.error,
      );
      continue;
    }

    if (page.status === null || page.status >= 400) {
      addIssue(
        issues,
        "error",
        "http-error",
        page,
        `Page returned HTTP ${page.status ?? "unknown"}`,
        page.status,
      );
    }

    if (!page.title) {
      addIssue(
        issues,
        "error",
        "missing-title",
        page,
        "Page does not have a title",
        page.title,
      );
    }

    if (!page.description) {
      addIssue(
        issues,
        "warning",
        "missing-description",
        page,
        "Page does not have a meta description",
        page.description,
      );
    }

    if (!page.canonical) {
      addIssue(
        issues,
        "warning",
        "missing-canonical",
        page,
        "Page does not declare a canonical URL",
        page.canonical,
      );
    }

    if ((page.h1Count ?? 0) === 0) {
      addIssue(
        issues,
        "warning",
        "missing-h1",
        page,
        "Page does not contain an H1 heading",
        page.h1Count,
      );
    } else if (page.h1Count > 1) {
      addIssue(
        issues,
        "info",
        "multiple-h1",
        page,
        `Page contains ${page.h1Count} H1 headings`,
        page.h1Count,
      );
    }

    if (/(^|[\s,])noindex($|[\s,])/i.test(page.robots ?? "")) {
      addIssue(
        issues,
        "info",
        "noindex",
        page,
        "Page contains a noindex directive",
        page.robots,
      );
    }
  }

  const severityOrder = { error: 0, warning: 1, info: 2 };
  issues.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.url.localeCompare(right.url) ||
      left.rule.localeCompare(right.rule),
  );

  return issues;
}
