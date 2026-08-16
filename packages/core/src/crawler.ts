import { createHash } from "node:crypto";
import { createBaseline } from "./baseline.js";
import { fetchWithRetry, readResponseBody, RequestFailure } from "./fetcher.js";
import { extractSeoData } from "./html.js";
import { createPerOriginRequestGate } from "./request-gate.js";
import { isAllowedByRobots, parseRobots, type RobotsRule } from "./robots.js";
import { loadSitemapUrls } from "./sitemap.js";
import type { PageSnapshot, ScanEvent, ScanOptions, ScanResult } from "./types.js";
import { isCrawlableUrl, isSameOrigin, normalizeUrl } from "./urls.js";
import { DEFAULT_USER_AGENT } from "./version.js";

const MAX_ROBOTS_BYTES = 512 * 1024;

interface InternalOptions extends ScanOptions {
  maxPages: number;
  concurrency: number;
  timeout: number;
  includeQuery: boolean;
  respectRobots: boolean;
  sitemap: string | null;
  sitemapData: any;
  userAgent: string;
  requestDelay: number;
  requestGate: (url: string) => Promise<void>;
  maxRedirects: number;
  maxResponseBytes: number;
  retries: number;
  fetch: typeof globalThis.fetch;
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
}

interface RobotsData {
  url: string;
  status: number | null;
  body: string;
  sha256: string | null;
  rules: RobotsRule[];
  denyAll: boolean;
  error: string | null;
}

function emptyPage(url: string, depth: number): PageSnapshot {
  return {
    url,
    finalUrl: null,
    status: null,
    contentType: null,
    blockedByRobots: false,
    error: null,
    title: null,
    description: null,
    canonical: null,
    canonicalRaw: null,
    robots: null,
    xRobotsTag: null,
    lang: null,
    h1Count: 0,
    openGraph: { title: null, description: null, image: null },
    twitter: { card: null, title: null, description: null, image: null },
    hreflang: [],
    jsonLd: [],
    images: [],
    links: [],
    internalLinks: [],
    externalLinks: [],
    wordCount: 0,
    contentHash: null,
    depth,
    redirectChain: [],
    responseBytes: 0,
  };
}

async function emit(options: InternalOptions, event: ScanEvent): Promise<void> {
  await options.onEvent?.(event);
}

async function loadRobots(startUrl: string, options: InternalOptions): Promise<RobotsData> {
  const robotsUrl = new URL("/robots.txt", startUrl).href;
  try {
    const { response } = await fetchWithRetry(robotsUrl, {
      headers: { accept: "text/plain,*/*;q=0.1", "user-agent": options.userAgent },
    }, {
      ...options,
      gate: options.requestGate,
      onEvent: options.onEvent,
    });
    const { text: body } = await readResponseBody(response, MAX_ROBOTS_BYTES);
    return {
      url: robotsUrl,
      status: response.status,
      body,
      sha256: createHash("sha256").update(body).digest("hex"),
      rules: response.ok ? parseRobots(body, options.userAgent) : [],
      denyAll: response.status === 401 || response.status === 403,
      error: null,
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      url: robotsUrl,
      status: null,
      body: "",
      sha256: null,
      rules: [],
      denyAll: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchPage(
  requestUrl: string,
  depth: number,
  siteOrigin: string,
  options: InternalOptions,
  robots: RobotsData,
): Promise<PageSnapshot> {
  const page = emptyPage(requestUrl, depth);
  if (options.respectRobots && !isAllowedByRobots(requestUrl, robots)) {
    page.blockedByRobots = true;
    return page;
  }

  try {
    const { response, redirectChain } = await fetchWithRetry(requestUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "user-agent": options.userAgent,
      },
    }, {
      ...options,
      gate: options.requestGate,
      onEvent: options.onEvent,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
    const finalUrl = normalizeUrl(response.url, undefined, { includeQuery: options.includeQuery });
    page.finalUrl = finalUrl;
    page.status = response.status;
    page.contentType = contentType || null;
    page.xRobotsTag = response.headers.get("x-robots-tag");
    page.redirectChain = redirectChain;

    if (!isHtml) {
      await response.body?.cancel();
      return page;
    }

    const { text: body, bytes } = await readResponseBody(response, options.maxResponseBytes);
    const seo = extractSeoData(body);
    const baseUrl = finalUrl ?? requestUrl;
    const canonical = seo.canonical
      ? normalizeUrl(seo.canonical, baseUrl, { includeQuery: true })
      : null;
    const links = [...new Set(
      seo.links
        .map((link) => normalizeUrl(link, baseUrl, { includeQuery: options.includeQuery }))
        .filter((link): link is string => Boolean(link)),
    )].sort();
    const hreflang = seo.hreflang.map((item) => ({
      lang: item.lang,
      url: normalizeUrl(item.url, baseUrl, { includeQuery: true }),
    }));
    Object.assign(page, {
      ...seo,
      visibleText: undefined,
      canonical,
      canonicalRaw: seo.canonical,
      links,
      internalLinks: links.filter((link) => isSameOrigin(link, siteOrigin)),
      externalLinks: links.filter((link) => !isSameOrigin(link, siteOrigin)),
      hreflang,
      contentHash: seo.visibleText
        ? createHash("sha256").update(seo.visibleText.toLowerCase()).digest("hex")
        : null,
      responseBytes: bytes,
    });
    return page;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    page.error = error instanceof Error ? error.message : String(error);
    if (error instanceof RequestFailure) page.redirectChain = error.redirectChain;
    return page;
  }
}

function withDefaults(raw: ScanOptions & Record<string, any> = {}): InternalOptions {
  const requestDelay = raw.requestDelay ?? raw.delay ?? 100;
  const providedGate = raw.requestGate as ((url?: string) => Promise<void>) | undefined;
  return {
    ...raw,
    maxPages: raw.maxPages ?? 100,
    concurrency: Math.max(1, raw.concurrency ?? 5),
    timeout: raw.timeout ?? 10_000,
    includeQuery: raw.includeQuery ?? false,
    respectRobots: raw.respectRobots ?? true,
    sitemap: raw.sitemap ?? null,
    sitemapData: raw.sitemapData ?? null,
    userAgent: raw.userAgent ?? DEFAULT_USER_AGENT,
    requestDelay,
    requestGate: providedGate ? async (url) => providedGate(url) : createPerOriginRequestGate(requestDelay),
    maxRedirects: raw.maxRedirects ?? 10,
    maxResponseBytes: raw.maxResponseBytes ?? 5 * 1024 * 1024,
    retries: raw.retries ?? 2,
    fetch: raw.fetch ?? globalThis.fetch,
    logger: raw.logger ?? console,
  };
}

async function runPool<T>(
  concurrency: number,
  next: () => Promise<T | null>,
): Promise<T[]> {
  const output: T[] = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const value = await next();
      if (value === null) return;
      output.push(value);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function fetchPages(urls: string[], rawOptions: ScanOptions & Record<string, any> = {}): Promise<{ pages: PageSnapshot[]; robots: RobotsData }> {
  const options = withDefaults(rawOptions);
  if (urls.length === 0) throw new Error("fetchPages requires at least one URL");
  const robots: RobotsData = rawOptions.robots ?? await loadRobots(urls[0], options);
  const cached = new Map((rawOptions.cachedPages ?? []).map((page: PageSnapshot) => [page.url, page]));
  const pages = new Map<string, PageSnapshot>();
  let cursor = 0;
  const origin = new URL(urls[0]).origin;

  await runPool(options.concurrency, async () => {
    if (options.signal?.aborted || cursor >= urls.length) return null;
    const url = urls[cursor++];
    const page = cached.get(url) ?? await fetchPage(url, 0, origin, options, robots);
    pages.set(url, page);
    if (!cached.has(url)) await rawOptions.onBatch?.([page]);
    const completed = pages.size;
    rawOptions.onProgress?.(completed, urls.length);
    await emit(options, { type: "progress", completed, total: urls.length, page });
    return page;
  });

  return { pages: urls.map((url) => pages.get(url)).filter((page): page is PageSnapshot => Boolean(page)), robots };
}

export async function crawlSite(inputUrl: string, rawOptions: ScanOptions & Record<string, any> = {}): Promise<ScanResult> {
  const startedAt = Date.now();
  const options = withDefaults(rawOptions);
  const startUrl = normalizeUrl(inputUrl, undefined, { includeQuery: options.includeQuery });
  if (!startUrl) throw new Error(`invalid start URL: ${inputUrl}`);
  const origin = new URL(startUrl).origin;
  await emit(options, { type: "scan-start", url: startUrl, total: options.maxPages });

  const robots = await loadRobots(startUrl, options);
  let sitemap = options.sitemapData;
  if (!sitemap && options.sitemap) {
    try {
      sitemap = await loadSitemapUrls(options.sitemap, {
        ...options,
        maxUrls: rawOptions.sitemapMaxUrls ?? 50_000,
        siteOrigin: origin,
      });
    } catch (error) {
      sitemap = {
        url: options.sitemap,
        urls: [],
        sitemapCount: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      };
      options.logger.warn(`Could not load sitemap ${options.sitemap}: ${sitemap.error}`);
    }
  }
  const seeds = [...new Set([startUrl, ...(sitemap?.urls ?? [])])];
  const queue: Array<{ url: string; depth: number }> = seeds.slice(0, options.maxPages).map((url) => ({ url, depth: 0 }));
  const scheduled = new Set(queue.map((item) => item.url));
  const cached = new Map((rawOptions.cachedPages ?? []).map((page: PageSnapshot) => [page.url, page]));
  const pages = new Map<string, PageSnapshot>();
  const maxQueueSize = Math.max(options.maxPages * 10, options.maxPages);
  let cursor = 0;

  await runPool(options.concurrency, async () => {
    if (options.signal?.aborted || pages.size >= options.maxPages || cursor >= queue.length) return null;
    const item = queue[cursor++];
    const page = cached.get(item.url) ?? await fetchPage(item.url, item.depth, origin, options, robots);
    pages.set(item.url, page);
    if (!cached.has(item.url)) {
      await rawOptions.onBatch?.([page]);
      await options.storage?.saveCheckpoint?.(startUrl, page);
      await emit(options, { type: "checkpoint", page, completed: pages.size, total: options.maxPages });
    }
    const discoveredLinks = page.internalLinks?.length
      ? page.internalLinks
      : (page.links ?? []).filter((link) => isSameOrigin(link, origin));
    for (const link of [...discoveredLinks].sort()) {
      if (scheduled.size >= maxQueueSize || scheduled.has(link) || !isCrawlableUrl(link)) continue;
      scheduled.add(link);
      queue.push({ url: link, depth: item.depth + 1 });
    }
    rawOptions.onProgress?.(pages.size, options.maxPages);
    await emit(options, { type: "progress", completed: pages.size, total: options.maxPages, page });
    return page;
  });

  const sortedPages = [...pages.values()].sort((left, right) => left.url.localeCompare(right.url));
  const partial = Boolean(options.signal?.aborted);
  const truncated = partial || cursor < queue.length || (sitemap ? sitemap.urls.length > sortedPages.length : false) || (sitemap?.truncated ?? false);
  const result: Omit<ScanResult, "snapshot"> & { snapshot?: ScanResult["snapshot"]; partial: boolean; durationMs: number } = {
    startUrl,
    pages: sortedPages,
    robots,
    sitemap,
    truncated,
    partial,
    durationMs: Date.now() - startedAt,
    options,
  };
  result.snapshot = createBaseline(result);
  if (!partial) await options.storage?.removeCheckpoint?.(startUrl);
  await emit(options, { type: "complete", completed: sortedPages.length, total: options.maxPages });
  return result as ScanResult;
}
