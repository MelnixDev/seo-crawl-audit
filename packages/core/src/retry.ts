import { planScan } from "./planning.js";
import { resolveConfig } from "./config.js";
import type { PageSnapshot, PlanScanOptions, RetrySelection, ScanConfigInput, ScanPlan, SnapshotV2 } from "./types.js";
import { normalizeUrl } from "./urls.js";
import { DEFAULT_USER_AGENT } from "./version.js";

export interface RetryOptions extends PlanScanOptions {
  statuses?: number[] | undefined;
  networkErrors?: boolean | undefined;
  config?: Partial<ScanConfigInput>;
}

export function retryOutcome(pages: readonly PageSnapshot[]) {
  return {
    recovered: pages.filter(page => !page.blockedByRobots && !page.error && page.status !== null && page.status >= 200 && page.status < 400).length,
    stillFailing: pages.filter(page => !page.blockedByRobots && (Boolean(page.error) || (page.status !== null && page.status >= 400))).length,
    blocked: pages.filter(page => page.blockedByRobots).length,
  };
}

/** Select observed failing URLs, without discovering new URLs or modifying the sources. */
export function selectRetryUrls(snapshots: readonly SnapshotV2[], options: Pick<RetryOptions, "statuses" | "networkErrors"> = {}): RetrySelection {
  if (!snapshots.length) throw new Error("retry requires at least one source snapshot");
  if (options.statuses && (!options.statuses.length || options.statuses.some(status => !Number.isInteger(status) || status < 400 || status > 599))) {
    throw new Error("retry statuses must be HTTP error codes from 400 to 599");
  }
  const origin = new URL(snapshots[0]!.siteUrl).origin;
  const pages = new Map<string, PageSnapshot>();
  if (snapshots.some(snapshot => !Number.isFinite(Date.parse(snapshot.generatedAt)))) throw new Error("retry snapshots require valid generatedAt timestamps");
  // Later observations win when sources overlap, as with resumable batched audits.
  for (const snapshot of [...snapshots].sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt))) {
    if (new URL(snapshot.siteUrl).origin !== origin) throw new Error("retry source snapshots must have the same origin");
    for (const page of snapshot.pages) pages.set(page.url, page);
  }
  const statuses = options.statuses ? [...new Set(options.statuses)].sort((a, b) => a - b) : null;
  const networkErrors = options.networkErrors ?? statuses === null;
  const urls = new Set<string>();
  for (const page of pages.values()) {
    if (page.blockedByRobots) continue;
    const httpError = page.status !== null && (statuses ? statuses.includes(page.status) : page.status >= 400 && page.status <= 599);
    const networkError = networkErrors && page.status === null && Boolean(page.error);
    if (!httpError && !networkError) continue;
    const url = normalizeUrl(page.url, undefined, { includeQuery: true, trailingSlash: "preserve" });
    if (!url || new URL(url).origin !== origin || new URL(url).username || new URL(url).password) throw new Error("retry targets must be HTTP(S) URLs on the source origin without credentials");
    urls.add(url);
  }
  return { sourcePages: pages.size, sourceSnapshots: snapshots.length, statuses, networkErrors, urls: [...urls].sort() };
}

export async function planRetry(snapshots: readonly SnapshotV2[], options: RetryOptions = {}): Promise<ScanPlan> {
  const retry = selectRetryUrls(snapshots, options);
  const baseline = snapshots[0]!;
  if (options.config?.url && new URL(options.config.url).origin !== new URL(baseline.siteUrl).origin) throw new Error("retry URL must match the source origin");
  const config = resolveConfig({ ...baseline.config, ...options.config, url: retry.urls[0] ?? baseline.siteUrl, sitemap: "none", includeQuery: true, trailingSlash: "preserve", respectRobots: options.config?.respectRobots ?? true });
  const plan = retry.urls.length ? await planScan(config, options) : {
    planVersion: 1 as const, config, startUrl: config.url, origin: new URL(config.url).origin,
    userAgent: DEFAULT_USER_AGENT, robots: { ...baseline.robots, body: "", denyAll: false, rules: [] },
    sitemap: null, candidateUrls: [], candidateCount: 0, mode: "retry" as const,
  };
  return { ...plan, mode: "retry", candidateUrls: retry.urls, candidateCount: retry.urls.length, retry };
}
