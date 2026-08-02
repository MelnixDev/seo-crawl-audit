import {
  isCrawlableUrl,
  isSameOrigin,
  normalizeUrl,
} from "./urls.js";

const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;
const MAX_SITEMAPS = 100;
const DEFAULT_SITEMAP_LIMIT = 50_000;

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function extractLocations(xml) {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(Boolean);
}

async function fetchSitemap(url, options) {
  await options.requestGate?.();
  const response = await fetch(url, {
    headers: {
      accept: "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1",
      "user-agent": options.userAgent,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`sitemap returned HTTP ${response.status}: ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SITEMAP_BYTES) {
    throw new Error(`sitemap exceeds ${MAX_SITEMAP_BYTES} bytes: ${url}`);
  }

  return bytes.toString("utf8");
}

async function isSitemapResponse(url, options) {
  try {
    await options.requestGate?.();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": options.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeout),
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const reader = response.body?.getReader();
    const firstChunk = reader ? await reader.read() : { value: null };
    await reader?.cancel();
    const beginning = firstChunk.value
      ? Buffer.from(firstChunk.value).toString("utf8", 0, 512)
      : "";

    return (
      response.ok &&
      (contentType.includes("xml") ||
        /<(?:\?xml|urlset|sitemapindex)\b/i.test(beginning))
    );
  } catch {
    return false;
  }
}

export async function discoverSitemapUrl(inputUrl, options) {
  const startUrl = normalizeUrl(inputUrl);
  if (!startUrl) {
    throw new Error(`invalid start URL: ${inputUrl}`);
  }

  const origin = new URL(startUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).href;

  try {
    await options.requestGate?.();
    const response = await fetch(robotsUrl, {
      headers: {
        accept: "text/plain,*/*;q=0.1",
        "user-agent": options.userAgent,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeout),
    });

    if (response.ok) {
      const body = await response.text();
      for (const match of body.matchAll(/^sitemap:\s*(\S+)\s*$/gim)) {
        const candidate = normalizeUrl(match[1], robotsUrl, {
          includeQuery: true,
        });
        if (candidate && isSameOrigin(candidate, origin)) {
          return candidate;
        }
      }
    } else {
      await response.body?.cancel();
    }
  } catch {
    // Standard sitemap locations are checked below.
  }

  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const candidate = new URL(path, origin).href;
    if (await isSitemapResponse(candidate, options)) {
      return candidate;
    }
  }

  return null;
}

export async function loadSitemapUrls(inputUrl, options) {
  const sitemapUrl = normalizeUrl(inputUrl, undefined, { includeQuery: true });
  if (!sitemapUrl) {
    throw new Error(`invalid sitemap URL: ${inputUrl}`);
  }

  const sitemapOrigin = new URL(sitemapUrl).origin;
  const siteOrigin = options.siteOrigin;
  const sitemapQueue = [sitemapUrl];
  const visitedSitemaps = new Set();
  const pageUrls = [];
  const pageSet = new Set();
  let truncated = false;

  while (
    sitemapQueue.length > 0 &&
    visitedSitemaps.size < MAX_SITEMAPS &&
    pageUrls.length < (options.maxUrls ?? DEFAULT_SITEMAP_LIMIT)
  ) {
    const currentUrl = sitemapQueue.shift();
    if (visitedSitemaps.has(currentUrl)) {
      continue;
    }
    visitedSitemaps.add(currentUrl);

    const xml = await fetchSitemap(currentUrl, options);
    const locations = extractLocations(xml);
    const isIndex = /<sitemapindex\b/i.test(xml);

    if (isIndex) {
      for (const location of locations) {
        const child = normalizeUrl(location, currentUrl, {
          includeQuery: true,
        });
        if (
          child &&
          isSameOrigin(child, sitemapOrigin) &&
          !visitedSitemaps.has(child)
        ) {
          sitemapQueue.push(child);
        }
      }
      continue;
    }

    for (const location of locations) {
      const pageUrl = normalizeUrl(location, currentUrl, {
        includeQuery: options.includeQuery,
      });

      if (
        !pageUrl ||
        pageSet.has(pageUrl) ||
        !isSameOrigin(pageUrl, siteOrigin) ||
        !isCrawlableUrl(pageUrl)
      ) {
        continue;
      }

      pageSet.add(pageUrl);
      pageUrls.push(pageUrl);

      if (pageUrls.length >= (options.maxUrls ?? DEFAULT_SITEMAP_LIMIT)) {
        truncated = true;
        break;
      }
    }
  }

  if (sitemapQueue.length > 0 || visitedSitemaps.size >= MAX_SITEMAPS) {
    truncated = true;
  }

  return {
    url: sitemapUrl,
    urls: pageUrls,
    sitemapCount: visitedSitemaps.size,
    truncated,
  };
}
