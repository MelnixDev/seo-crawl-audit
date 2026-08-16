import { gunzipSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { fetchWithRetry, readResponseBody } from "./fetcher.js";
import type { ScanEvent, SitemapState } from "./types.js";
import { isCrawlableUrl, isSameOrigin, normalizeUrl } from "./urls.js";

const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;
const MAX_SITEMAPS = 100;
const DEFAULT_SITEMAP_LIMIT = 50_000;

interface SitemapOptions {
  siteOrigin: string;
  includeQuery?: boolean | undefined;
  maxUrls?: number | undefined;
  timeout: number;
  maxRedirects?: number | undefined;
  retries?: number | undefined;
  userAgent: string;
  fetch?: typeof globalThis.fetch | undefined;
  signal?: AbortSignal | undefined;
  requestGate?: ((url: string) => Promise<void>) | undefined;
  onEvent?: ((event: ScanEvent) => void | Promise<void>) | undefined;
  robotsBody?: string | undefined;
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function locations(value: unknown): string[] {
  const entries = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) => {
    const location = record(entry)?.loc;
    return typeof location === "string" ? [location] : [];
  });
}

function decodeSitemap(buffer: Buffer, url: string, contentType: string): string {
  const gzip = url.toLowerCase().endsWith(".gz") || contentType.includes("gzip") || (buffer[0] === 0x1f && buffer[1] === 0x8b);
  const decoded = gzip ? gunzipSync(buffer) : buffer;
  if (decoded.byteLength > MAX_SITEMAP_BYTES) throw new Error(`sitemap exceeds ${MAX_SITEMAP_BYTES} bytes after decompression: ${url}`);
  return decoded.toString("utf8").replace(/^\uFEFF/, "");
}

function parseSitemap(xml: string, url: string): { kind: "index" | "urlset"; locations: string[] } {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`invalid sitemap XML at ${url}: ${validation.err.msg}`);
  const data = record(parser.parse(xml));
  const sitemapIndex = record(data?.sitemapindex);
  if (sitemapIndex) {
    return { kind: "index", locations: locations(sitemapIndex.sitemap) };
  }
  const urlSet = record(data?.urlset);
  if (urlSet) {
    return { kind: "urlset", locations: locations(urlSet.url) };
  }
  throw new Error(`XML is not a sitemap urlset or sitemapindex: ${url}`);
}

function policy(options: SitemapOptions) {
  return {
    fetch: options.fetch ?? globalThis.fetch,
    timeout: options.timeout,
    maxRedirects: options.maxRedirects ?? 10,
    retries: options.retries ?? 2,
    signal: options.signal,
    gate: options.requestGate ? async (url: string) => options.requestGate?.(url) : undefined,
    onEvent: options.onEvent,
  };
}

async function fetchSitemap(url: string, options: SitemapOptions): Promise<string> {
  const { response } = await fetchWithRetry(url, {
    headers: { accept: "application/xml,text/xml,application/gzip,text/plain;q=0.9,*/*;q=0.1", "user-agent": options.userAgent },
  }, policy(options));
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`sitemap returned HTTP ${response.status}: ${url}`);
  }
  const { buffer } = await readResponseBody(response, MAX_SITEMAP_BYTES);
  return decodeSitemap(buffer, url, response.headers.get("content-type")?.toLowerCase() ?? "");
}

async function isSitemapResponse(url: string, options: SitemapOptions): Promise<boolean> {
  try {
    const xml = await fetchSitemap(url, options);
    parseSitemap(xml, url);
    return true;
  } catch {
    return false;
  }
}

export async function discoverSitemapUrl(inputUrl: string, options: Omit<SitemapOptions, "siteOrigin"> & { siteOrigin?: string | undefined }): Promise<string | null> {
  const startUrl = normalizeUrl(inputUrl, undefined);
  if (!startUrl) throw new Error(`invalid start URL: ${inputUrl}`);
  const origin = new URL(startUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).href;
  try {
    if (options.robotsBody !== undefined) {
      for (const match of options.robotsBody.matchAll(/^sitemap:\s*(\S+)\s*$/gim)) {
        const location = match[1];
        if (!location) continue;
        const candidate = normalizeUrl(location, robotsUrl, { includeQuery: true });
        if (candidate && isSameOrigin(candidate, origin)) return candidate;
      }
    } else {
    const { response } = await fetchWithRetry(robotsUrl, {
      headers: { accept: "text/plain,*/*;q=0.1", "user-agent": options.userAgent },
    }, policy({ ...options, siteOrigin: origin }));
    if (response.ok) {
      const { text } = await readResponseBody(response, 512 * 1024);
      for (const match of text.matchAll(/^sitemap:\s*(\S+)\s*$/gim)) {
        const location = match[1];
        if (!location) continue;
        const candidate = normalizeUrl(location, robotsUrl, { includeQuery: true });
        if (candidate && isSameOrigin(candidate, origin)) return candidate;
      }
      } else await response.body?.cancel();
    }
  } catch {
    // Fall through to conventional sitemap locations.
  }
  for (const path of ["/sitemap.xml", "/sitemap.xml.gz", "/sitemap_index.xml"]) {
    const candidate = new URL(path, origin).href;
    if (await isSitemapResponse(candidate, { ...options, siteOrigin: origin })) return candidate;
  }
  return null;
}

export async function loadSitemapUrls(inputUrl: string, options: SitemapOptions): Promise<SitemapState> {
  const sitemapUrl = normalizeUrl(inputUrl, undefined, { includeQuery: true });
  if (!sitemapUrl) throw new Error(`invalid sitemap URL: ${inputUrl}`);
  const sitemapOrigin = new URL(sitemapUrl).origin;
  const sitemapQueue = [sitemapUrl];
  const visitedSitemaps = new Set<string>();
  const pageUrls: string[] = [];
  const pageSet = new Set<string>();
  const limit = options.maxUrls ?? DEFAULT_SITEMAP_LIMIT;
  let truncated = false;

  while (sitemapQueue.length > 0 && visitedSitemaps.size < MAX_SITEMAPS && pageUrls.length < limit) {
    const currentUrl = sitemapQueue.shift()!;
    if (visitedSitemaps.has(currentUrl)) continue;
    visitedSitemaps.add(currentUrl);
    const parsed = parseSitemap(await fetchSitemap(currentUrl, options), currentUrl);
    if (parsed.kind === "index") {
      for (const location of parsed.locations) {
        const child = normalizeUrl(location, currentUrl, { includeQuery: true });
        if (child && isSameOrigin(child, sitemapOrigin) && !visitedSitemaps.has(child) && !sitemapQueue.includes(child)) sitemapQueue.push(child);
      }
      sitemapQueue.sort();
      continue;
    }
    for (const location of parsed.locations) {
      const pageUrl = normalizeUrl(location, currentUrl, { includeQuery: options.includeQuery ?? false });
      if (!pageUrl || pageSet.has(pageUrl) || !isSameOrigin(pageUrl, options.siteOrigin) || !isCrawlableUrl(pageUrl)) continue;
      pageSet.add(pageUrl);
      pageUrls.push(pageUrl);
      if (pageUrls.length >= limit) { truncated = true; break; }
    }
  }
  if (sitemapQueue.length > 0 || visitedSitemaps.size >= MAX_SITEMAPS) truncated = true;
  return { url: sitemapUrl, urls: pageUrls.sort(), sitemapCount: visitedSitemaps.size, truncated, error: null };
}
