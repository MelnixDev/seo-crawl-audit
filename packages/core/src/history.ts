import { audit } from "./audit.js";
import { diff } from "./compare.js";
import type { HistoryPoint, HistorySeries, Issue, Severity, SnapshotV2 } from "./types.js";

function severityCounts(issues: readonly Issue[]): Record<Severity, number> {
  return issues.reduce<Record<Severity, number>>((counts, issue) => {
    counts[issue.severity] += 1;
    return counts;
  }, { error: 0, warning: 0, info: 0 });
}

/** Creates a deterministic local trend series from compatible snapshots. */
export function buildHistorySeries(snapshots: readonly SnapshotV2[]): HistorySeries | null {
  if (snapshots.length === 0) return null;
  const unique = new Map(snapshots.map((snapshot) => [`${snapshot.generatedAt}|${snapshot.configurationHash}|${snapshot.pages.length}`, snapshot]));
  const ordered = [...unique.values()].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  const siteUrl = ordered.at(-1)!.siteUrl;
  const compatible = ordered.filter((snapshot) => snapshot.siteUrl === siteUrl);
  const points: HistoryPoint[] = compatible.map((snapshot, index) => {
    const issues = audit(snapshot);
    const counts = severityCounts(issues);
    const previous = index > 0 ? compatible[index - 1] : undefined;
    const comparison = previous ? diff(previous, snapshot) : null;
    return {
      generatedAt: snapshot.generatedAt,
      siteUrl: snapshot.siteUrl,
      pages: snapshot.pages.length,
      affectedPages: new Set(issues.map((issue) => issue.url)).size,
      errors: counts.error,
      warnings: counts.warning,
      info: counts.info,
      newIssues: comparison?.newIssues.length ?? 0,
      resolvedIssues: comparison?.resolvedIssues.length ?? 0,
      sitemapUrls: snapshot.sitemap?.urls.length ?? 0,
      maxDepth: snapshot.pages.reduce((maximum, page) => Math.max(maximum, page.depth), 0),
      partial: snapshot.partial || snapshot.truncated,
    };
  });
  return { siteUrl, points };
}
