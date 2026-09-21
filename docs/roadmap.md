# Product roadmap

SEO Crawl Audit remains a free, open-source, local-first crawler. CLI, MCP,
GitHub Action, SnapshotV2, issue fingerprints, and report contracts remain
backward compatible while the product grows.

## Delivery status (September 2026)

Version `0.12.0` is released on GitHub and npm.
It includes scan preflight and
progress, checkpoint/resume diagnostics, Site Metrics, the loopback-only local
web interface, opt-in Playwright rendering, MCP and agent documentation,
English/Ukrainian reports, refreshed screenshots, public RDAP data, and clearly
labelled Google `site:` and local indexability estimates.

Authenticated Search Console/Bing adapters and animated demonstrations remain
intentionally deferred. They are not prerequisites for the local product.

## 0.11.x — completed stabilization

- Restore persisted external Site Metrics consistently in CLI reports and UI restarts.
- Require parameter-bound confirmation for every UI and MCP scan above 5,000 pages.
- Measure sampled peak heap/RSS and separate crawl, audit, and report timings.
- Keep the durable NDJSON journal recoverable while preserving SnapshotV2 compatibility.

## 0.12.0 — completed Page Explorer

- Add a per-URL view for status, redirects, observed crawl indexability,
  available metadata, transfer size, depth, links, and issues.
- Reuse existing SnapshotV2 data and avoid fetching pages from the report.
- Keep H1 text and per-page timing deferred because SnapshotV2 does not store them.
- Provide deterministic sorting, combined filters, pagination, accessible page
  details, Pages ↔ Issues navigation, and safe filtered CSV export.

## 0.13.0 — site architecture

Implemented on the development branch; not yet released.

- Surface inlinks, low-linked and orphan pages, broken-link sources, redirect
  chains, deep pages, and URL-template distributions.
- Provide practical tables and exports before considering a heavy graph view.
- Count only observed sources and distinguish unchecked targets from confirmed
  errors. See [site architecture](site-architecture.md).

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
