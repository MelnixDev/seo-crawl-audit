import { createHash } from "node:crypto";
import type {
  CrawlStatistics,
  LinkGraphSummary,
  PageSnapshot,
  RobotsState,
  ScanConfigV1,
  SitemapState,
  SnapshotV2,
} from "./types.js";
import { ENGINE_VERSION, RULE_SET_VERSION } from "./version.js";

const DEFAULT_OPEN_GRAPH = { title: null, description: null, image: null };
const DEFAULT_TWITTER = { card: null, title: null, description: null, image: null };

type PageInput = Partial<PageSnapshot> & Pick<PageSnapshot, "url">;
type ConfigInput = Partial<ScanConfigV1> & { requestDelay?: number };

export interface BaselineInput {
  schemaVersion?: unknown;
  engineVersion?: string;
  ruleSetVersion?: string;
  generatedAt?: string;
  siteUrl?: string;
  startUrl?: string;
  pages?: unknown[];
  source?: Partial<SnapshotV2["source"]>;
  options?: ConfigInput;
  config?: Partial<ScanConfigV1>;
  robots?: Partial<RobotsState>;
  sitemap?: Partial<SitemapState> | null;
  linkGraph?: LinkGraphSummary;
  statistics?: CrawlStatistics;
  requested?: number;
  durationMs?: number;
  truncated?: boolean;
  partial?: boolean;
}

function baselineInput(value: unknown): BaselineInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("snapshot must be an object");
  }
  return value as BaselineInput;
}

function pageInput(value: unknown): PageInput {
  if (!value || typeof value !== "object" || typeof (value as { url?: unknown }).url !== "string") {
    throw new Error("snapshot page URL must be a string");
  }
  return value as PageInput;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashConfiguration(config: ScanConfigV1): string {
  return createHash("sha256").update(stableJson(config)).digest("hex");
}

export function normalizePage(page: Partial<PageSnapshot> & { url: string }): PageSnapshot {
  return {
    url: page.url,
    finalUrl: page.finalUrl ?? null,
    status: page.status ?? null,
    contentType: page.contentType ?? null,
    blockedByRobots: page.blockedByRobots ?? false,
    error: page.error ?? null,
    title: page.title ?? null,
    description: page.description ?? null,
    canonical: page.canonical ?? null,
    canonicalRaw: page.canonicalRaw ?? page.canonical ?? null,
    robots: page.robots ?? null,
    xRobotsTag: page.xRobotsTag ?? null,
    lang: page.lang ?? null,
    h1Count: page.h1Count ?? 0,
    openGraph: page.openGraph ?? DEFAULT_OPEN_GRAPH,
    twitter: page.twitter ?? DEFAULT_TWITTER,
    hreflang: page.hreflang ?? [],
    jsonLd: page.jsonLd ?? [],
    images: page.images ?? [],
    links: [...(page.links ?? [])].sort(),
    internalLinks: [...(page.internalLinks ?? [])].sort(),
    externalLinks: [...(page.externalLinks ?? [])].sort(),
    wordCount: page.wordCount ?? 0,
    contentHash: page.contentHash ?? null,
    depth: page.depth ?? 0,
    redirectChain: page.redirectChain ?? [],
    responseBytes: page.responseBytes ?? 0,
  };
}

function defaultConfig(input: BaselineInput): ScanConfigV1 {
  const source = input.source ?? {};
  const options = input.options ?? {};
  const firstPage = input.pages?.[0];
  const firstPageUrl = firstPage && typeof firstPage === "object"
    ? (firstPage as { url?: unknown }).url
    : undefined;
  const url = input.siteUrl ?? input.startUrl ?? source.startUrl ?? (typeof firstPageUrl === "string" ? firstPageUrl : undefined);
  if (!url) throw new Error("snapshot site URL must be a string");
  return {
    schemaVersion: 1,
    url,
    sitemap: options.sitemap ?? source.sitemap ?? "auto",
    maxPages: options.maxPages ?? source.maxPages ?? 100,
    concurrency: options.concurrency ?? 5,
    delay: options.requestDelay ?? source.requestDelay ?? 100,
    timeout: options.timeout ?? 10_000,
    respectRobots: options.respectRobots ?? source.respectRobots ?? true,
    includeQuery: options.includeQuery ?? source.includeQuery ?? false,
    maxRedirects: options.maxRedirects ?? 10,
    maxResponseBytes: options.maxResponseBytes ?? 5 * 1024 * 1024,
    enabledRules: options.enabledRules ?? null,
    severityOverrides: options.severityOverrides ?? {},
    suppressions: options.suppressions ?? [],
    regressionBudgets: options.regressionBudgets ?? {},
    report: options.report ?? {},
  };
}

function createLinkGraph(pages: PageSnapshot[], sitemapUrls: string[]): LinkGraphSummary {
  const known = new Set(pages.map((page) => page.url));
  const linked = new Set(pages.flatMap((page) => page.internalLinks));
  const broken = new Set<string>();
  for (const page of pages) {
    if (page.error || page.blockedByRobots || (page.status ?? 500) >= 400) {
      broken.add(page.url);
    }
  }
  return {
    internalEdges: pages.reduce((sum, page) => sum + page.internalLinks.length, 0),
    externalEdges: pages.reduce((sum, page) => sum + page.externalLinks.length, 0),
    orphanUrls: sitemapUrls.filter((url) => known.has(url) && !linked.has(url)),
    brokenInternalUrls: [...broken].sort(),
  };
}

function createStatistics(input: BaselineInput, pages: PageSnapshot[]): CrawlStatistics {
  const blockedByRobots = pages.filter((page) => page.blockedByRobots).length;
  const failed = pages.filter((page) => page.error || (page.status ?? 500) >= 400).length;
  return {
    requested: input.requested ?? pages.length,
    completed: pages.length,
    succeeded: pages.length - failed - blockedByRobots,
    failed,
    blockedByRobots,
    redirected: pages.filter((page) => page.redirectChain.length > 0 || page.url !== page.finalUrl).length,
    durationMs: input.durationMs ?? 0,
    truncated: input.truncated ?? false,
    partial: input.partial ?? false,
  };
}

export function createBaseline(scanInput: unknown): SnapshotV2 {
  const scan = baselineInput(scanInput);
  const config = defaultConfig(scan);
  const pages = (scan.pages ?? []).map((page) => normalizePage(pageInput(page))).sort((left, right) => left.url.localeCompare(right.url));
  const sitemapUrls = scan.sitemap?.urls ?? [];
  if (scan.sitemap && !scan.sitemap.url) throw new Error("snapshot sitemap URL must be a string");
  const sitemap = scan.sitemap
    ? {
        url: scan.sitemap.url!,
        urls: [...sitemapUrls].sort(),
        sitemapCount: scan.sitemap.sitemapCount ?? 0,
        truncated: scan.sitemap.truncated ?? false,
        error: scan.sitemap.error ?? null,
      }
    : null;
  const siteUrl = scan.startUrl ?? config.url;
  const truncated = scan.truncated ?? false;

  return {
    schemaVersion: 2,
    engineVersion: ENGINE_VERSION,
    ruleSetVersion: RULE_SET_VERSION,
    generatedAt: scan.generatedAt ?? new Date().toISOString(),
    siteUrl,
    configurationHash: hashConfiguration(config),
    config,
    robots: {
      url: scan.robots?.url ?? new URL("/robots.txt", siteUrl).href,
      status: scan.robots?.status ?? null,
      sha256: scan.robots?.sha256 ?? null,
      error: scan.robots?.error ?? null,
      denyAll: scan.robots?.denyAll ?? false,
    },
    sitemap,
    pages,
    linkGraph: scan.linkGraph ?? createLinkGraph(pages, sitemapUrls),
    statistics: scan.statistics ?? createStatistics(scan, pages),
    partial: scan.partial ?? false,
    source: {
      startUrl: siteUrl,
      maxPages: config.maxPages,
      requestDelay: config.delay,
      includeQuery: config.includeQuery,
      respectRobots: config.respectRobots,
      sitemap: typeof config.sitemap === "string" && !["auto", "none"].includes(config.sitemap) ? config.sitemap : null,
    },
    truncated,
  };
}

export function migrateSnapshot(input: unknown): SnapshotV2 {
  const value = baselineInput(input);
  if (!Array.isArray(value.pages)) {
    throw new Error("snapshot pages must be an array");
  }
  if (value.schemaVersion === 2) {
    return createBaseline({
      ...value,
      startUrl: value.siteUrl,
      options: value.config,
      pages: value.pages,
      generatedAt: value.generatedAt,
      partial: value.partial,
      statistics: value.statistics,
      linkGraph: value.linkGraph,
    });
  }
  if (value.schemaVersion === 1) {
    return createBaseline(value);
  }
  throw new Error(`unsupported snapshot schema version: ${String(value.schemaVersion)}`);
}
