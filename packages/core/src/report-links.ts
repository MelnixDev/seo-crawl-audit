import type { PageSnapshot } from "./types.js";

export interface ObservedPageLinks {
  incoming: string[];
  broken: string[];
  redirects: string[];
}

function normalize(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Observed links only: unchecked targets and blocked pages are never errors. */
export function buildObservedLinks(pages: readonly PageSnapshot[]): Map<string, ObservedPageLinks> {
  const targets = new Map<string, PageSnapshot>();
  const graph = new Map<string, ObservedPageLinks>();
  const sources = new Map<string, Set<string>>();
  for (const page of pages) {
    const url = normalize(page.url);
    if (url) targets.set(url, page);
    graph.set(page.url, { incoming: [], broken: [], redirects: [] });
  }
  for (const page of pages) {
    const links = graph.get(page.url)!;
    const unique = new Set(page.internalLinks.map((url) => normalize(url, page.finalUrl ?? page.url)));
    for (const url of unique) {
      if (!url || url === normalize(page.url) || url === normalize(page.finalUrl ?? page.url)) continue;
      const target = targets.get(url);
      if (!target) continue;
      const incoming = sources.get(target.url) ?? new Set<string>();
      incoming.add(page.url);
      sources.set(target.url, incoming);
      if (!target.blockedByRobots && (target.error || (target.status !== null && target.status >= 400))) links.broken.push(target.url);
      if (target.redirectChain.length || (target.finalUrl && target.finalUrl !== target.url) || (target.status !== null && target.status >= 300 && target.status < 400)) links.redirects.push(target.url);
    }
  }
  for (const [url, links] of graph) {
    links.incoming = [...(sources.get(url) ?? [])].sort();
    links.broken.sort();
    links.redirects.sort();
  }
  return graph;
}
