import { crawlSite } from "./crawler.js";
import { createPerOriginRequestGate } from "./request-gate.js";
import { planScan } from "./planning.js";
import type {
  CheckpointIdentity,
  PageSnapshot,
  ScanConfigInput,
  ScanOptions,
  ScanPlan,
  ScanResult,
} from "./types.js";

function isPlan(input: ScanConfigInput | ScanPlan): input is ScanPlan {
  return "planVersion" in input;
}

function checkpointIdentity(plan: ScanPlan): CheckpointIdentity {
  return {
    schemaVersion: 2,
    pageSchemaVersion: 1,
    siteUrl: plan.startUrl,
    sitemapUrl: plan.sitemap?.url ?? null,
    includeQuery: plan.config.includeQuery,
    respectRobots: plan.config.respectRobots,
    timeout: plan.config.timeout,
    maxRedirects: plan.config.maxRedirects,
    maxResponseBytes: plan.config.maxResponseBytes,
    userAgent: plan.userAgent,
  };
}

function reusableCheckpointPage(page: PageSnapshot): boolean {
  return !page.error && (page.status === null || page.status < 500);
}

/**
 * Run a local crawl through the stable engine API.
 *
 * Network access is performed exclusively through the injected fetch function
 * (or the current Node.js global fetch). No crawl data is uploaded elsewhere.
 */
export async function scan(
  input: ScanConfigInput | ScanPlan,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const plan = isPlan(input) ? input : await planScan(input, options);
  if (plan.planVersion !== 1) throw new Error(`unsupported scan plan version: ${String(plan.planVersion)}`);
  const limit = options.limit ?? plan.config.maxPages;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("scan limit must be a positive integer");
  const config = { ...plan.config, maxPages: limit };
  const requestGate = createPerOriginRequestGate(config.delay);
  const identity = checkpointIdentity(plan);
  const checkpoint = options.checkpointStore && options.resume !== false
    ? await options.checkpointStore.load(identity)
    : null;
  const cachedPages = [
    ...(options.cachedPages ?? []),
    ...(checkpoint?.pages.filter(reusableCheckpointPage) ?? []),
  ];
  const uniqueCachedPages = [...new Map(cachedPages.map((page) => [page.url, page])).values()];
  if (uniqueCachedPages.length > 0) {
    await options.onEvent?.({ type: "resume", completed: uniqueCachedPages.length, total: limit });
  }

  const result = await crawlSite(plan.startUrl, {
    ...options,
    maxPages: limit,
    concurrency: config.concurrency,
    requestDelay: config.delay,
    timeout: config.timeout,
    respectRobots: config.respectRobots,
    includeQuery: config.includeQuery,
    maxRedirects: config.maxRedirects,
    maxResponseBytes: config.maxResponseBytes,
    enabledRules: config.enabledRules,
    severityOverrides: config.severityOverrides,
    suppressions: config.suppressions,
    regressionBudgets: config.regressionBudgets,
    report: config.report,
    requestGate,
    robots: plan.robots,
    sitemap: plan.sitemap?.url ?? null,
    sitemapData: plan.sitemap,
    userAgent: plan.userAgent,
    cachedPages: uniqueCachedPages,
    async onBatch(pages: PageSnapshot[]) {
      for (const page of pages) await options.checkpointStore?.append(identity, page);
      await options.onBatch?.(pages);
    },
  });

  await options.checkpointStore?.flush?.();
  if (!result.partial && !options.retainCheckpoint) {
    await options.checkpointStore?.clear(identity);
  }
  return result;
}
