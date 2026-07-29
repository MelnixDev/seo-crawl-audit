import { readFile, writeFile } from "node:fs/promises";

const SCHEMA_VERSION = 1;

function serializePage(page) {
  return {
    url: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    contentType: page.contentType,
    blockedByRobots: page.blockedByRobots,
    error: page.error,
    title: page.title,
    description: page.description,
    canonical: page.canonical,
    robots: page.robots,
    lang: page.lang,
    h1Count: page.h1Count,
    openGraph: page.openGraph,
  };
}

export function createBaseline(scan) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      startUrl: scan.startUrl,
      maxPages: scan.options.maxPages,
      includeQuery: scan.options.includeQuery,
      respectRobots: scan.options.respectRobots,
      sitemap: scan.options.sitemap,
    },
    sitemap: scan.sitemap
      ? {
          url: scan.sitemap.url,
          sitemapCount: scan.sitemap.sitemapCount,
          truncated: scan.sitemap.truncated,
        }
      : null,
    robots: {
      url: scan.robots.url,
      status: scan.robots.status,
      sha256: scan.robots.sha256,
      error: scan.robots.error,
    },
    truncated: scan.truncated,
    pages: scan.pages.map(serializePage),
  };
}

export async function writeBaseline(path, baseline) {
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

export async function readBaseline(path) {
  const data = JSON.parse(await readFile(path, "utf8"));

  if (data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.pages)) {
    throw new Error(`unsupported or invalid baseline: ${path}`);
  }

  return data;
}
