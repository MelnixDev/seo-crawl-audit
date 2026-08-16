import { resolveConfig } from "./config.js";
import { createPerOriginRequestGate } from "./request-gate.js";
import { fetchRobots } from "./robots.js";
import { discoverSitemapUrl, loadSitemapUrls } from "./sitemap.js";
import type {
  PlanScanOptions,
  ScanConfigInput,
  ScanEvent,
  ScanPlan,
  SitemapState,
} from "./types.js";
import { normalizeUrl } from "./urls.js";
import { DEFAULT_USER_AGENT } from "./version.js";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function emit(options: PlanScanOptions, event: ScanEvent): Promise<void> {
  await options.onEvent?.(event);
}

export async function planScan(
  configInput: ScanConfigInput,
  options: PlanScanOptions = {},
): Promise<ScanPlan> {
  const config = resolveConfig(configInput);
  const startUrl = normalizeUrl(config.url, undefined, { includeQuery: config.includeQuery });
  if (!startUrl) throw new Error(`invalid start URL: ${config.url}`);
  const origin = new URL(startUrl).origin;
  const fetch = options.fetch ?? globalThis.fetch;
  const requestGate = createPerOriginRequestGate(config.delay);
  const logger = options.logger ?? noopLogger;
  await emit(options, { type: "plan-start", url: startUrl });

  const robots = await fetchRobots(startUrl, {
    userAgent: DEFAULT_USER_AGENT,
    timeout: config.timeout,
    maxRedirects: config.maxRedirects,
    retries: 2,
    fetch,
    signal: options.signal,
    requestGate,
    onEvent: options.onEvent,
    logger,
  });
  await emit(options, { type: "robots", robots });

  let sitemapUrl: string | null = null;
  if (config.sitemap === "auto") {
    sitemapUrl = await discoverSitemapUrl(startUrl, {
      timeout: config.timeout,
      maxRedirects: config.maxRedirects,
      userAgent: DEFAULT_USER_AGENT,
      fetch,
      signal: options.signal,
      requestGate,
      onEvent: options.onEvent,
      robotsBody: robots.body,
    });
  } else if (config.sitemap !== "none") {
    sitemapUrl = config.sitemap;
  }

  let sitemap: SitemapState | null = null;
  if (sitemapUrl) {
    try {
      sitemap = await loadSitemapUrls(sitemapUrl, {
        siteOrigin: origin,
        includeQuery: config.includeQuery,
        maxUrls: 50_000,
        timeout: config.timeout,
        maxRedirects: config.maxRedirects,
        retries: 2,
        userAgent: DEFAULT_USER_AGENT,
        fetch,
        signal: options.signal,
        requestGate,
        onEvent: options.onEvent,
      });
    } catch (error) {
      sitemap = {
        url: sitemapUrl,
        urls: [],
        sitemapCount: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      };
      logger.warn(`Could not load sitemap ${sitemapUrl}: ${sitemap.error}`);
    }
  }

  const candidateUrls = sitemap
    ? [...new Set([startUrl, ...sitemap.urls])].sort((left, right) => left === startUrl ? -1 : right === startUrl ? 1 : left.localeCompare(right))
    : [startUrl];
  const candidateCount = sitemap ? candidateUrls.length : null;
  await emit(options, { type: "sitemap", sitemap, candidateCount });
  return {
    planVersion: 1,
    config,
    startUrl,
    origin,
    userAgent: DEFAULT_USER_AGENT,
    robots,
    sitemap,
    candidateUrls,
    candidateCount,
    mode: sitemap ? "sitemap" : "links",
  };
}
