import { crawlSite } from "./crawler.js";
import { DEFAULT_SCAN_CONFIG, resolveConfig } from "./config.js";
import { createPerOriginRequestGate } from "./request-gate.js";
import { discoverSitemapUrl } from "./sitemap.js";
import type { ScanConfigV1, ScanOptions, ScanResult } from "./types.js";
import { DEFAULT_USER_AGENT } from "./version.js";

/**
 * Run a local crawl through the stable engine API.
 *
 * Network access is performed exclusively through the injected fetch function
 * (or the current Node.js global fetch). No crawl data is uploaded elsewhere.
 */
export async function scan(
  configInput: Partial<ScanConfigV1> & { url: string },
  options: ScanOptions = {},
): Promise<ScanResult> {
  const config = resolveConfig(configInput, {}, DEFAULT_SCAN_CONFIG);
  if (!config.url) throw new Error("scan config requires url");
  const requestGate = createPerOriginRequestGate(config.delay);
  const common = {
    ...options,
    maxPages: config.maxPages,
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
  };
  let sitemap: string | null = null;
  if (config.sitemap === "auto") {
    sitemap = await discoverSitemapUrl(config.url, {
      timeout: config.timeout,
      maxRedirects: config.maxRedirects,
      userAgent: DEFAULT_USER_AGENT,
      fetch: options.fetch,
      signal: options.signal,
      requestGate,
    });
  } else if (config.sitemap !== "none") {
    sitemap = config.sitemap;
  }
  return crawlSite(config.url, { ...common, sitemap });
}
