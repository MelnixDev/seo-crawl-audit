import type { Issue, PageSnapshot, SnapshotV2 } from "../types.js";
import { createIssue } from "./registry.js";

function hasDirective(value: string | null | undefined, directive: string): boolean {
  return new RegExp(`(^|[\\s,])${directive}($|[\\s,])`, "i").test(value ?? "");
}

function validLanguage(language: string): boolean {
  if (language.toLowerCase() === "x-default") return true;
  try { new Intl.Locale(language); return true; } catch { return false; }
}

function duplicateMap(pages: PageSnapshot[], select: (page: PageSnapshot) => string | null): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const value = select(page)?.trim().toLowerCase();
    if (!value) continue;
    const urls = groups.get(value) ?? [];
    urls.push(page.url);
    groups.set(value, urls);
  }
  return new Map([...groups].filter(([, urls]) => urls.length > 1));
}

export function evaluateCurrentRules(snapshot: SnapshotV2): Issue[] {
  const issues: Issue[] = [];
  const add = (candidate: Issue): void => { issues.push(candidate); };
  const pageByUrl = new Map(snapshot.pages.map((page) => [page.url, page]));
  const sitemapUrls = new Set(snapshot.sitemap?.urls ?? []);
  const titles = duplicateMap(snapshot.pages, (page) => page.title);
  const descriptions = duplicateMap(snapshot.pages, (page) => page.description);
  const content = duplicateMap(snapshot.pages, (page) => page.contentHash);

  if (snapshot.sitemap?.error) add(createIssue("sitemap-unavailable", snapshot.sitemap.url, "The configured sitemap could not be loaded", { actual: snapshot.sitemap.error }));

  for (const page of snapshot.pages) {
    if (page.blockedByRobots) { add(createIssue("robots-blocked", page.url, "Page is blocked by robots.txt", { actual: true })); continue; }
    if (page.error) {
      add(createIssue(page.error.includes("redirect loop") ? "redirect-loop" : "page-unreachable", page.url, `Page request failed: ${page.error}`, { actual: page.error, redirectChain: page.redirectChain }));
      continue;
    }
    if (page.status === null || page.status >= 400) add(createIssue("http-error", page.url, `Page returned HTTP ${page.status ?? "unknown"}`, { actual: page.status }));
    if (hasDirective(page.robots, "noindex")) add(createIssue("noindex", page.url, "Page contains a noindex meta directive", { actual: page.robots }));
    if (hasDirective(page.xRobotsTag, "noindex")) add(createIssue("x-robots-noindex", page.url, "Page contains a noindex X-Robots-Tag", { actual: page.xRobotsTag }));
    if (!page.canonicalRaw && !page.canonical) add(createIssue("missing-canonical", page.url, "Page does not declare a canonical URL", { actual: null }));
    if (page.canonicalRaw && !page.canonical) add(createIssue("invalid-canonical", page.url, "Canonical URL is invalid", { actual: page.canonicalRaw }));
    if (page.canonical && new URL(page.canonical).origin !== new URL(snapshot.siteUrl).origin) add(createIssue("cross-domain-canonical", page.url, "Canonical points to another origin", { actual: page.canonical }));
    if (page.canonical) {
      const target = pageByUrl.get(page.canonical);
      if (target && (target.error || (target.status ?? 500) >= 400)) add(createIssue("canonical-target-error", page.url, "Canonical target is unavailable", { target: page.canonical, actual: target.status ?? target.error }, page.canonical));
    }
    if (page.redirectChain.length > 3) add(createIssue("long-redirect-chain", page.url, `Page uses ${page.redirectChain.length} redirects`, { actual: page.redirectChain.length, redirectChain: page.redirectChain }));
    if (sitemapUrls.has(page.url) && (hasDirective(page.robots, "noindex") || hasDirective(page.xRobotsTag, "noindex"))) add(createIssue("noindex-in-sitemap", page.url, "Sitemap URL is marked noindex", { actual: page.robots ?? page.xRobotsTag }));
    if (sitemapUrls.has(page.url) && page.redirectChain.length > 0) add(createIssue("redirect-in-sitemap", page.url, "Sitemap URL redirects", { actual: page.finalUrl, redirectChain: page.redirectChain }));
    if (!page.title) add(createIssue("missing-title", page.url, "Page does not have a title", { actual: null }));
    else {
      if (titles.get(page.title.trim().toLowerCase())) add(createIssue("duplicate-title", page.url, "Title is shared by multiple pages", { actual: page.title, urls: titles.get(page.title.trim().toLowerCase()) }, page.title.trim().toLowerCase()));
      if (page.title.length < 10 || page.title.length > 60) add(createIssue("title-length", page.url, `Title length is ${page.title.length} characters`, { actual: page.title.length, value: page.title }));
    }
    if (!page.description) add(createIssue("missing-description", page.url, "Page does not have a meta description", { actual: null }));
    else {
      if (descriptions.get(page.description.trim().toLowerCase())) add(createIssue("duplicate-description", page.url, "Meta description is shared by multiple pages", { actual: page.description, urls: descriptions.get(page.description.trim().toLowerCase()) }, page.description.trim().toLowerCase()));
      if (page.description.length < 50 || page.description.length > 160) add(createIssue("description-length", page.url, `Description length is ${page.description.length} characters`, { actual: page.description.length, value: page.description }));
    }
    if (page.h1Count === 0) add(createIssue("missing-h1", page.url, "Page does not contain an H1 heading", { actual: 0 }));
    else if (page.h1Count > 1) add(createIssue("multiple-h1", page.url, `Page contains ${page.h1Count} H1 headings`, { actual: page.h1Count }));
    for (const targetUrl of page.internalLinks) {
      const target = pageByUrl.get(targetUrl);
      if (target && (target.error || (target.status ?? 500) >= 400)) add(createIssue("broken-internal-link", page.url, "Internal link points to an unavailable page", { target: targetUrl, actual: target.status ?? target.error }, targetUrl));
    }
    if (sitemapUrls.has(page.url) && page.url !== snapshot.siteUrl && snapshot.linkGraph.orphanUrls.includes(page.url)) add(createIssue("orphan-sitemap-page", page.url, "Sitemap page has no discovered internal links", { actual: true }));
    if (snapshot.sitemap && !sitemapUrls.has(page.url) && !hasDirective(page.robots, "noindex") && (page.status ?? 500) < 400) add(createIssue("crawlable-not-in-sitemap", page.url, "Crawlable page is absent from the sitemap", { actual: false }));
    for (const alternate of page.hreflang) if (!validLanguage(alternate.lang) || !alternate.url) add(createIssue("invalid-hreflang", page.url, "Hreflang declaration is invalid", { actual: alternate }, alternate));
    for (const [index, block] of page.jsonLd.entries()) if (!block.valid) add(createIssue("malformed-json-ld", page.url, "JSON-LD block contains invalid JSON", { actual: block.error, index }, index));
    if (snapshot.siteUrl.startsWith("https:") && [page.url, page.canonical, ...page.internalLinks].some((url) => url?.startsWith("http:"))) add(createIssue("http-on-https-site", page.url, "HTTPS site references an internal HTTP URL", { actual: [page.url, page.canonical, ...page.internalLinks].filter((url) => url?.startsWith("http:")) }));
    if (page.lang && !validLanguage(page.lang)) add(createIssue("invalid-language", page.url, "HTML language declaration is invalid", { actual: page.lang }));
    if (page.contentHash && content.get(page.contentHash)) add(createIssue("duplicate-content", page.url, "Main text is an exact duplicate of another page", { urls: content.get(page.contentHash) }, page.contentHash));
    if (!page.openGraph.title || !page.openGraph.description || !page.openGraph.image) add(createIssue("missing-open-graph", page.url, "Open Graph metadata is incomplete", { actual: page.openGraph }));
    if (!page.twitter.card || !page.twitter.title || !page.twitter.description || !page.twitter.image) add(createIssue("missing-twitter-metadata", page.url, "Twitter card metadata is incomplete", { actual: page.twitter }));
    const missingAlt = page.images.filter((image) => image.alt === null).map((image) => image.src);
    if (missingAlt.length > 0) add(createIssue("image-missing-alt", page.url, `${missingAlt.length} image(s) do not have an alt attribute`, { actual: missingAlt }));
    if (page.wordCount < 200) add(createIssue("low-word-count", page.url, `Page contains approximately ${page.wordCount} visible words`, { actual: page.wordCount }));
  }

  return issues;
}
