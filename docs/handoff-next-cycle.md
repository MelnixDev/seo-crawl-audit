# Handoff: next SEO Crawl Audit cycle

This document is the execution brief for the next implementation model. The
current branch is `feat/0.10-user-experience`; the worktree is clean and the
latest commits are already part of the branch.

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
- opt-in Playwright renderer package;
- favicon/product mark in the UI, reports, and demo;
- MCP, GitHub Action, English/Ukrainian report output, and existing API
  compatibility.

The latest targeted UI/report/history tests pass. A post-change full gate must
still be run when the execution environment allows localhost integration tests.

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

## P1 — authoritative search metrics

Implement local-only, opt-in providers behind the existing
`SiteMetricProvider` contract:

- Google Search Console provider using explicit local OAuth/device setup;
- Bing Webmaster provider using an explicitly supplied local credential;
- credentials only in process memory or the OS credential mechanism;
- no credentials in snapshots, reports, history, checkpoints, logs, telemetry,
  or MCP responses;
- provider failures remain visible as `unavailable`/`error` while local metrics
  remain usable;
- without a provider, keep the value as `null` and explain why.

Add unit tests with mocked provider responses and tests proving secret
isolation. Do not scrape Google or Bing result pages.

## P1 — local UI polish

- Make the report preview resizable or openable in a dedicated full-size view.
- Show the active domain and snapshot timestamp in the scan panel.
- Add a read-only history list and links to previous local reports.
- Keep artifacts namespaced or clearly warn before cross-domain replacement.
- Keep all UI network requests same-origin and bound to loopback.

## P2 — public demonstration and release

- Regenerate `examples/quotes-toscrape-report.html` after every renderer
  change and refresh README/GitHub Pages screenshots.
- Add a short scan/filter GIF or WebM using only public demo data.
- Perform browser QA on the Pages demo.
- Decide whether the Playwright adapter is published as a scoped package or a
  standalone unscoped package; do not publish it accidentally.
- Update versions/changelog, create the release PR, preserve logical commits,
  run clean-install smoke tests, publish through trusted npm publishing, move
  the compatible Action tag, and delete the merged feature branch.

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
