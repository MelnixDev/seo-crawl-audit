# Product roadmap

SEO Crawl Audit remains a free, open-source, local-first crawler. CLI, MCP,
GitHub Action, SnapshotV2, issue fingerprints, and report contracts remain
backward compatible while the product grows.

## Delivery status (September 2026)

Version `0.10.3` is the current stable release. It includes scan preflight and
progress, checkpoint/resume diagnostics, Site Metrics, the loopback-only local
web interface, opt-in Playwright rendering, MCP and agent documentation,
English/Ukrainian reports, refreshed screenshots, public RDAP data, and clearly
labelled Google `site:` and local indexability estimates.

Authenticated Search Console/Bing adapters and animated demonstrations remain
intentionally deferred. They are not prerequisites for the local product.

## 0.11.0 — scale and local-product reliability

- Support safe full-sitemap scans of up to 50,000 pages from the local UI and
  MCP, with preflight estimates and explicit confirmation above 5,000 pages.
- Add Quick, Standard, Full sitemap, and Custom scan profiles while keeping HTTP
  as the default and Playwright as a separate opt-in rendering mode.
- Use the durable NDJSON page journal for large scans and preserve reliable
  interruption/resume behaviour.
- Persist external Site Metrics in a separate versioned local file without
  changing SnapshotV2.
- Split the local UI template, browser runtime, controllers, and HTTP routing
  into maintainable modules that are still bundled into the CLI package.
- Keep self-contained HTML reports responsive with tens of thousands of issues.

## 0.12.0 — Page Explorer

- Add a per-URL view for status, redirects, indexability, metadata, headings,
  structured data, response timing, transfer size, depth, links, and issues.
- Reuse existing SnapshotV2 data and avoid fetching pages from the report.

## 0.13.0 — site architecture

- Surface inlinks, low-linked and orphan pages, broken-link sources, redirect
  chains, deep pages, and URL-template distributions.
- Provide practical tables and exports before considering a heavy graph view.

## 0.14.0 — regression workflow

- Add rule and template trends, local run comparison, a focused "what became
  worse" view, and concise change-summary exports.

## Deferred

- Google Search Console and Bing Webmaster authentication;
- GIF/WebM demonstrations;
- cloud crawling, accounts, billing, telemetry, paid features, or an opaque SEO
  score;
- JavaScript rendering by default;
- low-confidence rules added only to increase the rule count.

## Quality gates

- Preserve current public contracts and complete automated checks.
- Cover full-sitemap confirmation, 50k journals, resume, metrics persistence,
  large-report interaction, localhost isolation, cancellation, and Playwright.
- Dogfood short and full scans only on explicitly permitted sites.
