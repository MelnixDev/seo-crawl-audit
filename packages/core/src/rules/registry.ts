import { createHash } from "node:crypto";
import type { Issue, IssueScope } from "../types.js";
import type { RuleDefinition } from "./types.js";

const DOCS_BASE = "https://github.com/MelnixDev/seo-crawl-audit/blob/main/docs/rules.md";

const definitions: RuleDefinition[] = [
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

export const RULE_REGISTRY: readonly RuleDefinition[] = Object.freeze(
  definitions.map((definition) => Object.freeze({ ...definition })),
);

const RULES = new Map(RULE_REGISTRY.map((rule) => [rule.id, rule]));

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${key}:${stableStringify(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function getRuleDefinitions(): readonly RuleDefinition[] {
  return RULE_REGISTRY;
}

export function issueFingerprint(ruleId: string, scope: IssueScope, url: string, identity?: unknown): string {
  return createHash("sha256").update(`${ruleId}\n${scope}\n${url}\n${stableStringify(identity ?? null)}`).digest("hex").slice(0, 24);
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
