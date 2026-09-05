import test from "node:test";
import assert from "node:assert/strict";
import { buildSiteMetrics, collectSiteMetrics, createRdapDomainProvider, migrateSnapshot } from "../packages/core/dist/index.js";

test("builds deterministic local site metrics from a snapshot", () => {
  const snapshot = migrateSnapshot({
    schemaVersion: 1,
    generatedAt: "2026-09-05T10:00:00.000Z",
    startUrl: "https://example.com/",
    durationMs: 400,
    sitemap: { url: "https://example.com/sitemap.xml", urls: ["https://example.com/", "https://example.com/product"], sitemapCount: 1, truncated: false },
    pages: [
      {
        url: "https://example.com/", finalUrl: "https://example.com/", status: 200, contentType: "text/html", depth: 0, responseBytes: 1_024,
        internalLinks: ["https://example.com/product"], externalLinks: ["https://outside.example/"], images: [{ src: "https://example.com/image.jpg", alt: "Image" }],
      },
      {
        url: "https://example.com/product", finalUrl: "https://example.com/product", status: 200, contentType: "text/html", depth: 1, responseBytes: 2_048,
        robots: "noindex", images: [{ src: "https://example.com/image.jpg", alt: "Image" }], jsonLd: [{ valid: true, value: { "@type": "Product", name: "Example" } }],
      },
    ],
  });
  const metrics = buildSiteMetrics(snapshot);
  const values = Object.fromEntries(metrics.metrics.map((metric) => [metric.id, metric.value]));
  assert.equal(metrics.schemaVersion, 1);
  assert.equal(values["pages.sitemap"], 2);
  assert.equal(values["pages.indexable"], 1);
  const crawlable = metrics.metrics.find((metric) => metric.id === "pages.indexable");
  assert.equal(crawlable.label.en, "Crawlable HTML pages");
  assert.match(crawlable.detail.en, /not the Google index count/);
  assert.equal(values["search.google-indexed"], null);
  assert.equal(metrics.metrics.find((metric) => metric.id === "search.google-indexed").status, "not-connected");
  assert.equal(values["pages.noindex"], 1);
  assert.equal(values["assets.images"], 1);
  assert.equal(values["commerce.products"], 1);
  assert.equal(values["crawl.max-depth"], 1);
  assert.equal(values["crawl.transfer"], 3_072);
  assert.equal(values["crawl.average-time"], 200);
});

test("crawlable page count excludes redirects and non-HTML responses", () => {
  const snapshot = migrateSnapshot({
    schemaVersion: 1,
    startUrl: "https://example.com/",
    pages: [
      { url: "https://example.com/", status: 200, contentType: "text/html" },
      { url: "https://example.com/redirect", status: 301, contentType: "text/html" },
      { url: "https://example.com/feed", status: 200, contentType: "application/json" },
    ],
  });
  const metrics = buildSiteMetrics(snapshot);
  assert.equal(metrics.metrics.find((metric) => metric.id === "pages.indexable").value, 1);
});

test("collects public RDAP domain dates and registrar without credentials", async () => {
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [] });
  const requests = [];
  const fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      events: [
        { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
        { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
      ],
      entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar"]]] }],
    }), { status: 200, headers: { "content-type": "application/rdap+json" } });
  };
  const metrics = await collectSiteMetrics(snapshot, { providers: [createRdapDomainProvider()], fetch });
  const values = Object.fromEntries(metrics.metrics.map((metric) => [metric.id, metric.value]));
  assert.deepEqual(requests, ["https://rdap.org/domain/example.com"]);
  assert.equal(values["domain.registration-date"], "1995-08-14T04:00:00Z");
  assert.equal(values["domain.expiration-date"], "2027-08-13T04:00:00Z");
  assert.equal(values["domain.registrar"], "Example Registrar");
});

test("RDAP metrics remain explicit when public data is unavailable", async () => {
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [] });
  const metrics = await collectSiteMetrics(snapshot, {
    providers: [createRdapDomainProvider({ endpoint: "https://rdap.test/domain" })],
    fetch: async () => new Response("not found", { status: 404 }),
  });
  const domainMetrics = metrics.metrics.filter((metric) => metric.id.startsWith("domain."));
  assert.equal(domainMetrics.length, 3);
  assert.equal(domainMetrics.every((metric) => metric.status === "unavailable" && metric.value === null), true);
});

test("an optional metric provider failure does not discard local metrics", async () => {
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [] });
  const metrics = await collectSiteMetrics(snapshot, {
    providers: [{ id: "example", collect: async () => { throw new Error("temporarily unavailable"); } }],
  });
  assert.ok(metrics.metrics.some((metric) => metric.id === "pages.checked"));
  const failed = metrics.metrics.find((metric) => metric.id === "provider.example");
  assert.equal(failed.status, "error");
  assert.equal(failed.detail.en, "temporarily unavailable");
});

test("an authoritative provider replaces a matching not-connected metric", async () => {
  const snapshot = migrateSnapshot({ schemaVersion: 1, startUrl: "https://example.com/", pages: [] });
  const authoritative = {
    id: "search.google-indexed",
    label: { en: "Indexed by Google", uk: "Проіндексовано Google" },
    value: 42,
    unit: "count",
    source: { id: "gsc", label: "Google Search Console" },
    observedAt: "2026-09-05T00:00:00.000Z",
    confidence: "high",
    status: "available",
  };
  const metrics = await collectSiteMetrics(snapshot, { providers: [{ id: "gsc", collect: async () => [authoritative] }] });
  const matches = metrics.metrics.filter((metric) => metric.id === "search.google-indexed");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].value, 42);
  assert.equal(matches[0].source.id, "gsc");
});
