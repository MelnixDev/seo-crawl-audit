# Handoff: next SEO Crawl Audit cycle

This document records the remaining work after the `0.10.1` release.

## Current baseline

Already implemented:

- local HTTP crawler with progress, cancellation, checkpoint/resume, and
  deterministic output;
- `seo-audit serve [url]`, automatic browser opening, and `--no-open`;
- local browser UI with scan controls, SSE progress, embedded report preview,
  local history, and confirmation before replacing another domain's snapshot;
- grouped Site Metrics with primary indicators, sitemap coverage, HTTP status
  distribution, bilingual labels, and explicit Google/Bing `not-connected`
  states;
- optional RDAP domain metrics;
- a separate post-scan public metrics action with Google `site:` approximation,
  manual fallback, and no repeated page crawl;
- opt-in Playwright renderer package;
- favicon/product mark in the UI, reports, and demo;
- MCP, GitHub Action, English/Ukrainian report output, and existing API
  compatibility.

The complete automated quality gate passes.

## P0 — finish local product reliability

1. Run a real short and full HTTP scan against an explicitly permitted site.
   Verify the target URL, sitemap count, crawlable HTML count, issue links,
   history, interrupted scan, and resume. Never treat crawlability as Google
   index coverage.
2. Install Chromium and run the same fixture through `--render playwright`.
   Verify SSR/SPA content, media blocking, redirect handling, cancellation,
   and the actionable missing-browser error. Do not add an automatic fallback.
3. Run `npm run check` and `npm audit --omit=dev`. Record versions, runtime,
   test count, coverage, tarball size, and any environment blocker.

## Deferred — authoritative search metrics

Google Search Console and Bing Webmaster integrations are explicitly deferred.
The current product keeps public estimates visibly separate from authoritative
provider data and does not request search-account credentials.

## Completed — local UI polish

- The compact preview opens a dedicated full report.
- History remains local and cross-domain replacement requires confirmation.
- UI requests remain same-origin and the server remains loopback-only.
- Public metrics run separately from the crawler against the saved snapshot.

## Deferred demonstration and remaining release maintenance

- Keep the existing public screenshots current after material renderer changes.
- GIF/WebM capture is deferred.
- Perform browser QA on the Pages demo.
- Decide whether the Playwright adapter is published as a scoped package or a
  standalone unscoped package; do not publish it accidentally.
- Continue using trusted npm publishing and preserve logical commits.

## Non-goals

Do not add cloud crawling, accounts, billing, telemetry, paid features,
JavaScript rendering as the default, or an opaque SEO score in this cycle.

## Suggested verification commands

```bash
cd /Users/mvi/Projects/GitHub/seo-crawl-audit
npm install
npm run check
npm audit --omit=dev
npm pack --workspace seo-crawl-audit --dry-run
```

```bash
cd /Users/mvi/Projects/CP/Balachky/Balachky.org
seo-audit serve https://balachky.org/
```

For Playwright, install the optional adapter and Chromium first, then repeat
the scan with `--render playwright` and a small page limit.
