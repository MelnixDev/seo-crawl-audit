import { writeFile } from "node:fs/promises";
import { audit, diff, renderReport } from "../packages/core/dist/index.js";
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
  generatedAt: "2026-08-02T09:00:00.000Z",
};
const previous = createBaseline({
  ...common,
  pages: [
    basePage("/", "Quotes to Scrape"),
    basePage("/page/2/", "Quotes · Page 2"),
    basePage("/page/3/", "Quotes · Page 3"),
    basePage("/tag/love/", "Love Quotes"),
  ],
});
const current = createBaseline({
  ...common,
  pages: [
    basePage("/", "Quotes to Scrape", { description: null }),
    basePage("/page/2/", "Quotes to Scrape", { canonical: null, wordCount: 120 }),
    basePage("/page/3/", "Quotes to Scrape", { h1Count: 2 }),
    basePage("/tag/love/", "Love Quotes", { xRobotsTag: "noindex" }),
  ],
});
const lifecycle = diff(previous, current);
const html = renderReport({
  mode: "check",
  startUrl: url,
  generatedAt: current.generatedAt,
  pages: current.pages,
  issues: audit(current),
  ...lifecycle,
  engineVersion: current.engineVersion,
  ruleSetVersion: current.ruleSetVersion,
  branding: { agencyName: "SEO Crawl Audit", primaryColor: "#3157d5" },
});
await writeFile(new URL("../examples/quotes-toscrape-report.html", import.meta.url), html, "utf8");
