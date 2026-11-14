import { writeFile } from "node:fs/promises";
import { audit, buildHistorySeries, buildSiteMetrics, diff, renderReport } from "../packages/core/dist/index.js";
import { createBaseline } from "../packages/core/dist/baseline.js";

const url = "https://quotes.toscrape.com/";
const basePage = (path, title, overrides = {}) => ({
  url: new URL(path, url).href,
  finalUrl: new URL(path, url).href,
  status: 200,
  contentType: "text/html",
  title,
  description: `A useful educational quotes page description for ${title}, prepared as a deterministic report example.`,
  canonical: new URL(path, url).href,
  h1Count: 1,
  lang: "en",
  wordCount: 280,
  contentHash: `content-${path}`,
  openGraph: { title, description: "Educational quotes", image: `${url}static/cover.jpg` },
  twitter: { card: "summary", title, description: "Educational quotes", image: `${url}static/cover.jpg` },
  ...overrides,
});
const common = {
  startUrl: url,
  robots: { url: `${url}robots.txt`, status: 200, sha256: "demo-robots", error: null },
  sitemap: { url: `${url}sitemap.xml`, urls: [url, `${url}page/2/`, `${url}page/3/`, `${url}tag/love/`], sitemapCount: 1, truncated: false },
  options: { maxPages: 4, requestDelay: 100 },
};
const previous = createBaseline({
  ...common,
  generatedAt: "2026-07-20T09:00:00.000Z",
  pages: [
    basePage("/", "Quotes to Scrape"),
    basePage("/page/2/", "Quotes · Page 2"),
    basePage("/page/3/", "Quotes · Page 3"),
    basePage("/tag/love/", "Love Quotes"),
  ],
});
const current = createBaseline({
  ...common,
  generatedAt: "2026-08-02T09:00:00.000Z",
  pages: [
    basePage("/", "Quotes to Scrape", { description: null }),
    basePage("/page/2/", "Quotes to Scrape", { canonical: null, wordCount: 120 }),
    basePage("/page/3/", "Quotes to Scrape", { h1Count: 2 }),
    basePage("/tag/love/", "Love Quotes", { xRobotsTag: "noindex" }),
  ],
});
const lifecycle = diff(previous, current);
// A longer, fully synthetic history makes the trend chart useful in screenshots.
// These fixtures are not live measurements of quotes.toscrape.com.
const historicalRuns = [
  ["2026-06-01T09:00:00.000Z", 4, 3, 2, 1],
  ["2026-06-08T09:00:00.000Z", 3, 2, 1, 2],
  ["2026-06-15T09:00:00.000Z", 2, 3, 0, 3],
  ["2026-06-22T09:00:00.000Z", 3, 1, 1, 1],
  ["2026-06-29T09:00:00.000Z", 1, 2, 0, 2],
  ["2026-07-06T09:00:00.000Z", 2, 1, 1, 3],
].map(([generatedAt, missingDescriptions, duplicateTitles, brokenPages, thinPages]) => {
  const paths = ["/", "/page/2/", "/page/3/", "/tag/love/"];
  return createBaseline({
    ...common,
    generatedAt,
    pages: paths.map((path, index) => basePage(path, index < duplicateTitles ? "Quotes to Scrape" : `Quotes · ${index + 1}`, {
      description: index < missingDescriptions ? null : `A useful description for ${path}.`,
      status: index > 0 && index <= brokenPages ? 404 : 200,
      wordCount: index < thinPages ? 100 : 280,
    })),
  });
});
const history = buildHistorySeries([...historicalRuns, previous, current]);
const html = renderReport({
  mode: "check",
  startUrl: url,
  generatedAt: current.generatedAt,
  pages: current.pages,
  pageDetails: current.pages,
  issues: audit(current),
  ...lifecycle,
  engineVersion: current.engineVersion,
  ruleSetVersion: current.ruleSetVersion,
  branding: { agencyName: "SEO Crawl Audit" },
  siteMetrics: buildSiteMetrics(current),
  ...(history ? { history } : {}),
});
await writeFile(new URL("../examples/quotes-toscrape-report.html", import.meta.url), html.replace(/^[\t ]+$/gm, ""), "utf8");
