import type { Issue, PageSnapshot } from "../types.js";
import { createIssue } from "./registry.js";

export function indexableTitlePage(page: PageSnapshot): boolean {
  return Boolean(page.title && !page.error && !page.blockedByRobots && page.status === 200
    && !/(^|[\s,])noindex($|[\s,])/i.test(`${page.robots ?? ""},${page.xRobotsTag ?? ""}`)
    && (!page.canonical || page.canonical === (page.finalUrl || page.url)));
}
function normalize(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function family(page: PageSnapshot): string {
  const url = new URL(page.finalUrl || page.url);
  for (const key of ["page", "paged", "p"]) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
/** Bounded candidate search, not exhaustive semantic similarity. */
export function evaluateTitleSimilarity(pages: PageSnapshot[]): Issue[] {
  const issues: Issue[] = [];
  const candidates = new Map<string, PageSnapshot[]>();
  const pagination = new Map<string, PageSnapshot[]>();
  for (const page of [...pages].filter(indexableTitlePage).sort((a, b) => a.url.localeCompare(b.url))) {
    const normalized = normalize(page.title!); const base = family(page);
    const key = `${base}\n${normalized}`;
    const peers = pagination.get(key) ?? []; peers.push(page); pagination.set(key, peers);
    const tokens = normalized.split(" ");
    if (tokens.length < 6 || tokens.length > 40) continue;
    const signatures = new Set([normalized, ...tokens.map((_, i) => tokens.filter((__, j) => i !== j).join(" "))]);
    const matches = new Map<string, PageSnapshot>();
    for (const signature of signatures) {
      for (const peer of candidates.get(signature) ?? []) {
        if (peer.title!.trim().toLowerCase() === page.title!.trim().toLowerCase() || family(peer) === base) continue;
        const other = normalize(peer.title!).split(" ");
        const shared = tokens.filter((token) => other.includes(token)).length;
        if (2 * shared / (tokens.length + other.length) >= 0.9) matches.set(peer.url, peer);
      }
      const bucket = candidates.get(signature) ?? [];
      if (bucket.length < 20) bucket.push(page);
      candidates.set(signature, bucket);
    }
    const peer = [...matches.values()].sort((a, b) => a.url.localeCompare(b.url))[0];
    if (peer) issues.push(createIssue("near-duplicate-title", page.url, "Title is very similar to another checked page; review page intent", {
      actual: page.title, target: peer.url, otherTitle: peer.title, method: "normalized punctuation or one-token edit, token overlap >= 90%", candidateLimit: 20,
    }, [normalized, peer.url]));
  }
  for (const group of pagination.values()) {
    const distinct = [...new Map(group.map((page) => [page.finalUrl || page.url, page])).values()];
    if (distinct.length < 2 || !distinct.some((page) => ["page", "paged", "p"].some((key) => new URL(page.url).searchParams.has(key)))) continue;
    for (const page of distinct) issues.push(createIssue("pagination-title-duplicate", page.url, "Critical pagination title duplication across indexable URLs", {
      actual: page.title, urls: distinct.slice(0, 20).map((peer) => peer.url), affectedCount: distinct.length,
      interpretation: "Critical risk to distinguishing pages in search; not proof of Google exclusion. Pager offsets may be zero- or one-based.",
    }, normalize(page.title!)));
  }
  return issues;
}
