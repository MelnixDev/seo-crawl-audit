const SEVERITY_ORDER = { error: 0, warning: 1 };

function hasDirective(value, directive) {
  return new RegExp(`(^|[\\s,])${directive}($|[\\s,])`, "i").test(value ?? "");
}

function addIssue(issues, severity, rule, url, message, before, after) {
  issues.push({ severity, rule, url, message, before, after });
}

export function compareBaselines(baseline, current) {
  const issues = [];
  const currentPages = new Map(current.pages.map((page) => [page.url, page]));

  if (
    baseline.robots.sha256 &&
    current.robots.sha256 &&
    baseline.robots.sha256 !== current.robots.sha256
  ) {
    addIssue(
      issues,
      "warning",
      "robots-changed",
      current.robots.url,
      "robots.txt content changed",
      baseline.robots.sha256,
      current.robots.sha256,
    );
  }

  for (const before of baseline.pages) {
    const after = currentPages.get(before.url);

    if (!after) {
      addIssue(
        issues,
        "error",
        "page-missing",
        before.url,
        "page was not checked",
        before.status,
        null,
      );
      continue;
    }

    if (after.blockedByRobots && !before.blockedByRobots) {
      addIssue(
        issues,
        "error",
        "robots-blocked",
        before.url,
        "page is now blocked by robots.txt",
        false,
        true,
      );
      continue;
    }

    if (after.error && !before.error) {
      addIssue(
        issues,
        "error",
        "page-unreachable",
        before.url,
        `page request failed: ${after.error}`,
        before.error,
        after.error,
      );
      continue;
    }

    if (
      before.status !== null &&
      before.status < 400 &&
      (after.status === null || after.status >= 400)
    ) {
      addIssue(
        issues,
        "error",
        "status-regression",
        before.url,
        `HTTP status regressed from ${before.status} to ${after.status ?? "none"}`,
        before.status,
        after.status,
      );
    }

    if (
      !hasDirective(before.robots, "noindex") &&
      hasDirective(after.robots, "noindex")
    ) {
      addIssue(
        issues,
        "error",
        "new-noindex",
        before.url,
        "page now contains a noindex directive",
        before.robots,
        after.robots,
      );
    }

    if (before.title && !after.title) {
      addIssue(
        issues,
        "error",
        "title-removed",
        before.url,
        "page title was removed",
        before.title,
        after.title,
      );
    } else if (before.title && after.title && before.title !== after.title) {
      addIssue(
        issues,
        "warning",
        "title-changed",
        before.url,
        "page title changed",
        before.title,
        after.title,
      );
    }

    if (before.description && !after.description) {
      addIssue(
        issues,
        "warning",
        "description-removed",
        before.url,
        "meta description was removed",
        before.description,
        after.description,
      );
    }

    if (before.canonical && !after.canonical) {
      addIssue(
        issues,
        "error",
        "canonical-removed",
        before.url,
        "canonical URL was removed",
        before.canonical,
        after.canonical,
      );
    } else if (
      before.canonical &&
      after.canonical &&
      before.canonical !== after.canonical
    ) {
      const pageOrigin = new URL(before.url).origin;
      const canonicalOrigin = new URL(after.canonical).origin;
      addIssue(
        issues,
        canonicalOrigin === pageOrigin ? "warning" : "error",
        "canonical-changed",
        before.url,
        "canonical URL changed",
        before.canonical,
        after.canonical,
      );
    }

    if ((before.h1Count ?? 0) > 0 && (after.h1Count ?? 0) === 0) {
      addIssue(
        issues,
        "warning",
        "h1-removed",
        before.url,
        "all H1 headings were removed",
        before.h1Count,
        after.h1Count,
      );
    }

    if (
      before.finalUrl &&
      after.finalUrl &&
      before.finalUrl !== after.finalUrl
    ) {
      const pageOrigin = new URL(before.url).origin;
      const redirectOrigin = new URL(after.finalUrl).origin;
      addIssue(
        issues,
        redirectOrigin === pageOrigin ? "warning" : "error",
        "redirect-changed",
        before.url,
        "final redirect URL changed",
        before.finalUrl,
        after.finalUrl,
      );
    }
  }

  issues.sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.url.localeCompare(right.url) ||
      left.rule.localeCompare(right.rule),
  );

  return issues;
}
