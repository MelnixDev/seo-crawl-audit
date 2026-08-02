import { createHash } from "node:crypto";
import { extractSeoData } from "./html.js";
import { createRequestGate } from "./request-gate.js";
import { isAllowedByRobots, parseRobots } from "./robots.js";
import { loadSitemapUrls } from "./sitemap.js";
import {
  isCrawlableUrl,
  isSameOrigin,
  normalizeUrl,
} from "./urls.js";

const DEFAULT_USER_AGENT = "seo-crawl-audit/0.1.2";
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;

async function readBody(response, maxBytes) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function loadRobots(startUrl, options) {
  const robotsUrl = new URL("/robots.txt", startUrl).href;

  try {
    await options.requestGate();
    const response = await fetch(robotsUrl, {
      headers: {
        accept: "text/plain,*/*;q=0.1",
        "user-agent": options.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeout),
    });
    const body = await readBody(response, MAX_ROBOTS_BYTES);

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
    return {
      url: robotsUrl,
      status: null,
      body: "",
      sha256: null,
      rules: [],
      denyAll: false,
      error: error.message,
    };
  }
}

async function fetchPage(requestUrl, options) {
  if (
    options.respectRobots &&
    !isAllowedByRobots(requestUrl, options.robots)
  ) {
    return {
      url: requestUrl,
      finalUrl: null,
      status: null,
      contentType: null,
      blockedByRobots: true,
      error: null,
      title: null,
      description: null,
      canonical: null,
      robots: null,
      lang: null,
      h1Count: 0,
      openGraph: { title: null, description: null, image: null },
      links: [],
    };
  }

  try {
    await options.requestGate();
    const response = await fetch(requestUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "user-agent": options.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeout),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml");
    const finalUrl = normalizeUrl(response.url, undefined, {
      includeQuery: options.includeQuery,
    });

    let seo = {
      title: null,
      description: null,
      canonical: null,
      robots: null,
      lang: null,
      h1Count: 0,
      openGraph: { title: null, description: null, image: null },
      links: [],
    };

    if (isHtml) {
      const body = await readBody(response, MAX_HTML_BYTES);
      seo = extractSeoData(body);
    } else {
      await response.body?.cancel();
    }

    const canonical = seo.canonical
      ? normalizeUrl(seo.canonical, finalUrl ?? requestUrl, {
          includeQuery: true,
        })
      : null;
    const links = [
      ...new Set(
        seo.links
          .map((link) =>
            normalizeUrl(link, finalUrl ?? requestUrl, {
              includeQuery: options.includeQuery,
            }),
          )
          .filter(Boolean),
      ),
    ];

    return {
      url: requestUrl,
      finalUrl,
      status: response.status,
      contentType: contentType || null,
      blockedByRobots: false,
      error: null,
      ...seo,
      canonical,
      links,
    };
  } catch (error) {
    return {
      url: requestUrl,
      finalUrl: null,
      status: null,
      contentType: null,
      blockedByRobots: false,
      error: error.message,
      title: null,
      description: null,
      canonical: null,
      robots: null,
      lang: null,
      h1Count: 0,
      openGraph: { title: null, description: null, image: null },
      links: [],
    };
  }
}

function withDefaults(options = {}) {
  const requestDelay = options.requestDelay ?? 100;

  return {
    maxPages: options.maxPages ?? 100,
    concurrency: options.concurrency ?? 5,
    timeout: options.timeout ?? 10_000,
    includeQuery: options.includeQuery ?? false,
    respectRobots: options.respectRobots ?? true,
    sitemap: options.sitemap ?? null,
    sitemapData: options.sitemapData ?? null,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    requestDelay,
    requestGate:
      options.requestGate ?? createRequestGate(requestDelay),
  };
}

export async function fetchPages(urls, rawOptions = {}) {
  const options = withDefaults(rawOptions);
  const robots =
    rawOptions.robots ?? (await loadRobots(urls[0], options));
  const pages = [];
  const cached = new Map(
    (rawOptions.cachedPages ?? []).map((page) => [page.url, page]),
  );

  for (let index = 0; index < urls.length; index += options.concurrency) {
    const batch = urls.slice(index, index + options.concurrency);
    const freshUrls = batch.filter((url) => !cached.has(url));
    const freshResults = await Promise.all(
      freshUrls.map((url) => fetchPage(url, { ...options, robots })),
    );
    await rawOptions.onBatch?.(freshResults);
    const fresh = new Map(freshResults.map((page) => [page.url, page]));
    const results = batch.map((url) => cached.get(url) ?? fresh.get(url));
    pages.push(...results);
    rawOptions.onProgress?.(pages.length, urls.length);
  }

  return { pages, robots };
}

export async function crawlSite(inputUrl, rawOptions = {}) {
  const options = withDefaults(rawOptions);
  const startUrl = normalizeUrl(inputUrl, undefined, {
    includeQuery: options.includeQuery,
  });

  if (!startUrl) {
    throw new Error(`invalid start URL: ${inputUrl}`);
  }

  const origin = new URL(startUrl).origin;
  const robots = await loadRobots(startUrl, options);
  const sitemap = options.sitemapData ?? (options.sitemap
    ? await loadSitemapUrls(options.sitemap, {
        ...options,
        maxUrls: options.sitemapMaxUrls ?? 50_000,
        siteOrigin: origin,
      })
    : null);
  const queue = [
    ...new Set([startUrl, ...(sitemap?.urls ?? [])]),
  ].slice(0, options.maxPages);
  const scheduled = new Set(queue);
  const cached = new Map(
    (rawOptions.cachedPages ?? []).map((page) => [page.url, page]),
  );
  const pages = [];
  let cursor = 0;
  const maxQueueSize = Math.max(options.maxPages * 10, options.maxPages);

  while (cursor < queue.length && pages.length < options.maxPages) {
    const remaining = options.maxPages - pages.length;
    const batch = queue.slice(
      cursor,
      cursor + Math.min(options.concurrency, remaining),
    );
    cursor += batch.length;

    const freshUrls = batch.filter((url) => !cached.has(url));
    const freshResults = await Promise.all(
      freshUrls.map((url) => fetchPage(url, { ...options, robots })),
    );
    await rawOptions.onBatch?.(freshResults);
    const fresh = new Map(freshResults.map((page) => [page.url, page]));
    const results = batch.map((url) => cached.get(url) ?? fresh.get(url));
    pages.push(...results);
    rawOptions.onProgress?.(pages.length, options.maxPages);

    for (const page of results) {
      for (const link of page.links ?? []) {
        if (
          scheduled.size >= maxQueueSize ||
          scheduled.has(link) ||
          !isSameOrigin(link, origin) ||
          !isCrawlableUrl(link)
        ) {
          continue;
        }
        scheduled.add(link);
        queue.push(link);
      }
    }
  }

  pages.sort((left, right) => left.url.localeCompare(right.url));

  return {
    startUrl,
    pages,
    robots,
    sitemap,
    truncated:
      cursor < queue.length ||
      (sitemap ? sitemap.urls.length > pages.length : false) ||
      (sitemap?.truncated ?? false),
    options,
  };
}
