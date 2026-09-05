import type { PageSnapshot, SiteMetric, SiteMetrics, SnapshotV2 } from "./types.js";

function metric(
  id: string,
  label: { en: string; uk: string },
  value: number,
  observedAt: string,
  unit: SiteMetric["unit"] = "count",
  detail?: SiteMetric["detail"],
): SiteMetric {
  return {
    id,
    label,
    value,
    unit,
    source: { id: "crawl", label: "SEO Crawl Audit" },
    observedAt,
    confidence: "high",
    status: "available",
    ...(detail ? { detail } : {}),
  };
}

function notConnected(id: string, label: SiteMetric["label"], source: SiteMetric["source"], observedAt: string, detail: SiteMetric["detail"]): SiteMetric {
  return { id, label, value: null, unit: "count", source, observedAt, confidence: "high", status: "not-connected", ...(detail ? { detail } : {}) };
}

function hasNoindex(page: PageSnapshot): boolean {
  return [page.robots, page.xRobotsTag].some((value) => /(^|[\s,])noindex($|[\s,])/i.test(value ?? ""));
}

function countType(value: unknown, expected: string): number {
  if (Array.isArray(value)) return value.reduce((total, child) => total + countType(child, expected), 0);
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const declared = record["@type"];
  const own = Array.isArray(declared) ? declared.filter((item) => item === expected).length : declared === expected ? 1 : 0;
  return own + Object.entries(record).filter(([key]) => key !== "@type").reduce((total, [, child]) => total + countType(child, expected), 0);
}

function statusCount(pages: PageSnapshot[], lower: number, upper: number): number {
  return pages.filter((page) => page.status !== null && page.status >= lower && page.status <= upper).length;
}

/** Builds deterministic, local-only site metrics from an existing snapshot. */
export function buildSiteMetrics(snapshot: SnapshotV2): SiteMetrics {
  const pages = snapshot.pages;
  const observedAt = snapshot.generatedAt;
  const htmlPages = pages.filter((page) => /(?:text\/html|application\/xhtml\+xml)/i.test(page.contentType ?? ""));
  const noindexPages = pages.filter(hasNoindex);
  const indexablePages = htmlPages.filter((page) => !page.error && !page.blockedByRobots && page.status !== null && page.status >= 200 && page.status < 300 && !hasNoindex(page));
  const images = new Set(pages.flatMap((page) => page.images.map((image) => image.src).filter((src): src is string => Boolean(src))));
  const products = pages.reduce((total, page) => total + page.jsonLd.reduce((sum, item) => sum + (item.valid ? countType(item.value, "Product") : 0), 0), 0);
  const totalBytes = pages.reduce((total, page) => total + page.responseBytes, 0);
  const averageMs = pages.length > 0 ? Math.round(snapshot.statistics.durationMs / pages.length) : 0;
  return {
    schemaVersion: 1,
    siteUrl: snapshot.siteUrl,
    observedAt,
    metrics: [
      metric("pages.sitemap", { en: "Sitemap URLs", uk: "URL у sitemap" }, snapshot.sitemap?.urls.length ?? 0, observedAt),
      metric("pages.checked", { en: "Pages checked", uk: "Перевірено сторінок" }, pages.length, observedAt),
      metric("pages.html", { en: "HTML pages", uk: "HTML-сторінки" }, htmlPages.length, observedAt),
      metric(
        "pages.indexable",
        { en: "Crawlable HTML pages", uk: "Доступні HTML-сторінки" },
        indexablePages.length,
        observedAt,
        "count",
        {
          en: "Successful HTML pages without a detected noindex directive. This is not the Google index count.",
          uk: "Успішні HTML-сторінки без виявленої директиви noindex. Це не кількість сторінок в індексі Google.",
        },
      ),
      notConnected("search.google-indexed", { en: "Indexed by Google", uk: "Проіндексовано Google" }, { id: "google-search-console", label: "Google Search Console" }, observedAt, { en: "Connect an authoritative provider to confirm this value; crawlability is not proof of indexing.", uk: "Підключіть авторитетне джерело для підтвердження; доступність для crawl не доводить індексацію." }),
      notConnected("search.bing-indexed", { en: "Indexed by Bing", uk: "Проіндексовано Bing" }, { id: "bing-webmaster", label: "Bing Webmaster Tools" }, observedAt, { en: "Connect an authoritative provider to confirm this value.", uk: "Підключіть авторитетне джерело для підтвердження значення." }),
      metric("pages.noindex", { en: "Noindex pages", uk: "Сторінки noindex" }, noindexPages.length, observedAt),
      metric("pages.robots-blocked", { en: "Blocked by robots.txt", uk: "Заблоковано robots.txt" }, pages.filter((page) => page.blockedByRobots).length, observedAt),
      metric("assets.images", { en: "Unique images", uk: "Унікальні зображення" }, images.size, observedAt),
      metric("commerce.products", { en: "Product entities", uk: "Товари Product" }, products, observedAt),
      metric("links.internal", { en: "Internal links", uk: "Внутрішні посилання" }, snapshot.linkGraph.internalEdges, observedAt),
      metric("links.external", { en: "External links", uk: "Зовнішні посилання" }, snapshot.linkGraph.externalEdges, observedAt),
      metric("crawl.max-depth", { en: "Maximum crawl depth", uk: "Максимальна глибина" }, Math.max(0, ...pages.map((page) => page.depth)), observedAt),
      metric("crawl.transfer", { en: "HTML transferred", uk: "Передано HTML" }, totalBytes, observedAt, "bytes"),
      metric("crawl.average-time", { en: "Average crawl time per page", uk: "Середній час на сторінку" }, averageMs, observedAt, "milliseconds"),
      metric("status.2xx", { en: "HTTP 2xx", uk: "HTTP 2xx" }, statusCount(pages, 200, 299), observedAt),
      metric("status.3xx", { en: "HTTP 3xx", uk: "HTTP 3xx" }, statusCount(pages, 300, 399), observedAt),
      metric("status.4xx", { en: "HTTP 4xx", uk: "HTTP 4xx" }, statusCount(pages, 400, 499), observedAt),
      metric("status.5xx", { en: "HTTP 5xx", uk: "HTTP 5xx" }, statusCount(pages, 500, 599), observedAt),
    ],
  };
}
