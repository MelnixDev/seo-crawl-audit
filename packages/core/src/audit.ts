import { createHash } from "node:crypto";
import { createBaseline } from "./baseline.js";
import type { Issue, IssueOwner, IssueScope, PageSnapshot, Severity, SnapshotV2, Suppression } from "./types.js";

export interface RuleDefinition {
  id: string;
  severity: Severity;
  owner: IssueOwner;
  scope: IssueScope;
  remediation: string;
}

export interface RuleSet {
  enabledRules?: string[] | null;
  severityOverrides?: Record<string, Severity>;
  suppressions?: Suppression[];
  now?: Date | string;
}

const DOCS_BASE = "https://github.com/MelnixDev/seo-crawl-audit/blob/main/docs/rules.md";

export const RULE_REGISTRY: RuleDefinition[] = [
  { id: "page-unreachable", severity: "error", owner: "developer", scope: "page", remediation: "Restore the page or remove references to it." },
  { id: "http-error", severity: "error", owner: "developer", scope: "page", remediation: "Return a successful response or a deliberate redirect." },
  { id: "noindex", severity: "info", owner: "seo", scope: "page", remediation: "Remove noindex when the page should appear in search." },
  { id: "x-robots-noindex", severity: "error", owner: "developer", scope: "page", remediation: "Remove the noindex X-Robots-Tag when indexing is intended." },
  { id: "robots-blocked", severity: "error", owner: "developer", scope: "page", remediation: "Allow the URL in robots.txt when it should be crawled." },
  { id: "missing-canonical", severity: "warning", owner: "seo", scope: "page", remediation: "Declare the preferred canonical URL when duplicate URL variants are possible." },
  { id: "invalid-canonical", severity: "error", owner: "developer", scope: "page", remediation: "Use an absolute or valid relative HTTP(S) canonical URL." },
  { id: "cross-domain-canonical", severity: "error", owner: "seo", scope: "page", remediation: "Confirm the external canonical or point it to the intended same-site URL." },
  { id: "canonical-target-error", severity: "error", owner: "developer", scope: "page", remediation: "Point the canonical to an accessible, indexable URL." },
  { id: "redirect-loop", severity: "error", owner: "developer", scope: "page", remediation: "Remove the circular redirect path." },
  { id: "long-redirect-chain", severity: "warning", owner: "developer", scope: "page", remediation: "Redirect directly to the final destination." },
  { id: "sitemap-unavailable", severity: "error", owner: "developer", scope: "site", remediation: "Restore a valid, reachable XML sitemap." },
  { id: "noindex-in-sitemap", severity: "error", owner: "seo", scope: "page", remediation: "Remove the URL from the sitemap or make it indexable." },
  { id: "redirect-in-sitemap", severity: "error", owner: "seo", scope: "page", remediation: "Replace the sitemap URL with its final canonical destination." },
  { id: "missing-title", severity: "error", owner: "content", scope: "page", remediation: "Add a unique, descriptive HTML title." },
  { id: "duplicate-title", severity: "warning", owner: "content", scope: "page", remediation: "Write a title that uniquely describes this page." },
  { id: "title-length", severity: "warning", owner: "content", scope: "page", remediation: "Keep the title concise and descriptive, usually 10–60 characters." },
  { id: "missing-description", severity: "warning", owner: "content", scope: "page", remediation: "Add a useful meta description." },
  { id: "duplicate-description", severity: "warning", owner: "content", scope: "page", remediation: "Write a unique meta description for this page." },
  { id: "description-length", severity: "warning", owner: "content", scope: "page", remediation: "Keep the description useful and usually between 50 and 160 characters." },
  { id: "missing-h1", severity: "warning", owner: "content", scope: "page", remediation: "Add one clear primary heading." },
  { id: "broken-internal-link", severity: "error", owner: "developer", scope: "page", remediation: "Update or remove the internal link, or restore its target." },
  { id: "orphan-sitemap-page", severity: "warning", owner: "seo", scope: "page", remediation: "Add meaningful internal links to the sitemap page." },
  { id: "crawlable-not-in-sitemap", severity: "warning", owner: "seo", scope: "page", remediation: "Add the indexable page to the sitemap or intentionally exclude it." },
  { id: "invalid-hreflang", severity: "warning", owner: "seo", scope: "page", remediation: "Use valid language tags and resolvable HTTP(S) alternate URLs." },
  { id: "malformed-json-ld", severity: "warning", owner: "developer", scope: "page", remediation: "Fix JSON syntax in the structured-data block." },
  { id: "http-on-https-site", severity: "warning", owner: "developer", scope: "page", remediation: "Use HTTPS for internal URLs and metadata references." },
  { id: "invalid-language", severity: "warning", owner: "developer", scope: "page", remediation: "Set a valid BCP 47 language tag on the html element." },
  { id: "duplicate-content", severity: "warning", owner: "content", scope: "page", remediation: "Consolidate duplicate pages or differentiate their main content." },
  { id: "multiple-h1", severity: "info", owner: "content", scope: "page", remediation: "Review whether one primary H1 would make the hierarchy clearer." },
  { id: "missing-open-graph", severity: "info", owner: "content", scope: "page", remediation: "Add Open Graph title, description, and image for social sharing." },
  { id: "missing-twitter-metadata", severity: "info", owner: "content", scope: "page", remediation: "Add Twitter card metadata when social previews matter." },
  { id: "image-missing-alt", severity: "info", owner: "content", scope: "page", remediation: "Add meaningful alt text, or an empty alt for decorative images." },
  { id: "low-word-count", severity: "info", owner: "content", scope: "page", remediation: "Review whether the page provides enough useful primary content." },
  { id: "robots-changed", severity: "warning", owner: "developer", scope: "site", remediation: "Review the robots.txt change and confirm that crawl access is intentional." },
  { id: "page-missing", severity: "error", owner: "developer", scope: "page", remediation: "Include the page in the scan or confirm that its removal is intentional." },
  { id: "status-regression", severity: "error", owner: "developer", scope: "page", remediation: "Restore the previous successful HTTP response." },
  { id: "new-noindex", severity: "error", owner: "seo", scope: "page", remediation: "Remove the newly introduced noindex unless it is intentional." },
  { id: "title-removed", severity: "error", owner: "content", scope: "page", remediation: "Restore a descriptive title." },
  { id: "title-changed", severity: "warning", owner: "content", scope: "page", remediation: "Review and approve the changed title." },
  { id: "description-removed", severity: "warning", owner: "content", scope: "page", remediation: "Restore a useful meta description." },
  { id: "canonical-removed", severity: "error", owner: "seo", scope: "page", remediation: "Restore the canonical declaration." },
  { id: "canonical-changed", severity: "warning", owner: "seo", scope: "page", remediation: "Confirm the new canonical target is deliberate and valid." },
  { id: "h1-removed", severity: "warning", owner: "content", scope: "page", remediation: "Restore a clear primary heading." },
  { id: "redirect-changed", severity: "warning", owner: "developer", scope: "page", remediation: "Confirm the new redirect destination is intentional." },
  { id: "sitemap-url-count-drop", severity: "error", owner: "seo", scope: "site", remediation: "Investigate the sitemap URL loss and restore omitted indexable pages." },
];

const RULES = new Map(RULE_REGISTRY.map((rule) => [rule.id, rule]));
const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function hasDirective(value: string | null | undefined, directive: string): boolean {
  return new RegExp(`(^|[\\s,])${directive}($|[\\s,])`, "i").test(value ?? "");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${key}:${stableStringify(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function issueFingerprint(ruleId: string, scope: IssueScope, url: string, identity?: unknown): string {
  return createHash("sha256").update(`${ruleId}\n${scope}\n${url}\n${stableStringify(identity ?? null)}`).digest("hex").slice(0, 24);
}

function globMatches(url: string, pattern: string): boolean {
  const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  const regex = new RegExp(`^${expression}$`);
  return regex.test(pathname) || regex.test(url);
}

function activeSuppression(issue: Issue, suppressions: Suppression[], now: Date): Suppression | null {
  return suppressions.find((suppression) => {
    if (suppression.rule !== issue.ruleId || !globMatches(issue.url, suppression.urlPattern)) return false;
    if (!suppression.expiresAt) return true;
    return new Date(`${suppression.expiresAt}T23:59:59.999Z`).getTime() >= now.getTime();
  }) ?? null;
}

export function createIssue(
  ruleId: string,
  url: string,
  message: string,
  evidence: Record<string, unknown> = {},
  identity?: unknown,
): Issue {
  const definition = RULES.get(ruleId);
  if (!definition) throw new Error(`unknown rule: ${ruleId}`);
  return {
    fingerprint: issueFingerprint(ruleId, definition.scope, url, identity),
    ruleId,
    rule: ruleId,
    severity: definition.severity,
    scope: definition.scope,
    url,
    message,
    evidence,
    owner: definition.owner,
    remediation: definition.remediation,
    documentationUrl: `${DOCS_BASE}#${ruleId}`,
    after: evidence.actual,
  };
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

function asSnapshot(input: SnapshotV2 | { pages: PageSnapshot[]; [key: string]: any }): SnapshotV2 {
  if ((input as SnapshotV2).schemaVersion === 2) return input as SnapshotV2;
  const legacy = input as { pages: PageSnapshot[]; [key: string]: any };
  const firstUrl = input.pages[0]?.url ?? "https://invalid.local/";
  return createBaseline({
    ...input,
    startUrl: legacy.siteUrl ?? legacy.source?.startUrl ?? firstUrl,
    robots: legacy.robots ?? { url: new URL("/robots.txt", firstUrl).href, status: null, sha256: null, error: null },
    options: legacy.config ?? legacy.options ?? {},
  });
}

export function audit(snapshotInput: SnapshotV2 | { pages: PageSnapshot[]; [key: string]: any }, ruleSet: RuleSet = {}): Issue[] {
  const snapshot = asSnapshot(snapshotInput);
  const enabled = ruleSet.enabledRules ?? snapshot.config.enabledRules;
  const enabledSet = enabled ? new Set(enabled) : null;
  const overrides = { ...snapshot.config.severityOverrides, ...(ruleSet.severityOverrides ?? {}) };
  const suppressions = ruleSet.suppressions ?? snapshot.config.suppressions;
  const now = new Date(ruleSet.now ?? Date.now());
  const issues: Issue[] = [];
  const add = (candidate: Issue) => { if (!enabledSet || enabledSet.has(candidate.ruleId)) issues.push(candidate); };
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

  return issues
    .map((candidate) => ({ ...candidate, severity: overrides[candidate.ruleId] ?? candidate.severity }))
    .filter((candidate) => !activeSuppression(candidate, suppressions, now))
    .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.url.localeCompare(right.url) || left.ruleId.localeCompare(right.ruleId) || left.fingerprint.localeCompare(right.fingerprint));
}

export const auditBaseline = audit;
