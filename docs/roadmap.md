# Product roadmap

SEO Crawl Audit remains a free, open-source, local-first crawler. Existing CLI,
JSON, SnapshotV2, issue fingerprints, MCP, and GitHub Action contracts remain
backward compatible while the following phases are delivered.

## 0.10.x — clearer local workflows

- Add a scan preflight summary and actionable large-scan warning.
- Show crawl phase, elapsed time, throughput, ETA, retries, failures, and the
  current URL without contaminating JSON stdout.
- Make checkpoint discovery and resume behaviour explicit and add a read-only
  `seo-audit status` command.
- Add actionable network, configuration, sitemap, and filesystem diagnostics.
- Add a "What to fix first" summary to terminal and HTML reports.
- Add a `Site Metrics` report view with local crawl, sitemap, image, product,
  indexability, status, link, depth, response-time, and transfer metrics.
- Collect public-first metrics without credentials. Every external value must
  expose its source, observation time, confidence, and availability; estimates
  must never be presented as exact values.
- Offer optional local Google Search Console and Bing Webmaster connections
  only when public data is unavailable or the user asks for authoritative data.
  Credentials must never enter snapshots, reports, history, checkpoints, logs,
  or telemetry.

## 0.11.0 — local web interface

- Add `seo-audit serve`, bound to `127.0.0.1` only.
- Reuse the existing core for setup, scans, cancellation, issues, history,
  metrics, and report previews.
- Stream live progress to the browser and keep all artifacts on the device.
- Do not introduce a hosted backend, accounts, billing, or telemetry.

## 0.12.0 — optional JavaScript rendering

- Keep the HTTP crawler as the fast default.
- Ship Playwright support as the separate opt-in
  `@seo-crawl-audit/renderer-playwright` package.
- Apply the selected renderer consistently to every page in a scan.
- Reuse one browser with default browser concurrency 2; allow CSS, fonts, and
  images while blocking video, audio, and downloads.
- Fail with an actionable installation message when Playwright or its browser
  binary is unavailable. Never silently fall back to HTTP.

## Brand and demonstration

- Add a self-contained inline SVG product mark with a text fallback while
  preserving local agency name, custom logo, and primary-colour branding.
- After the UI is stable, refresh README screenshots, the GitHub Pages demo,
  and add short GIF/WebM demonstrations of scanning and report filtering.
- Public examples must not contain private or customer data.

## Quality gates

- Keep all existing compatibility and coverage gates green.
- Cover interactive and JSON progress, checkpoint status and resume, partial
  reports, public/connected metric states, localhost isolation, cancellation,
  Playwright SSR/SPA behaviour, missing browser dependencies, and safe SVG
  rendering.
- Dogfood short and full scans on explicitly permitted sites before each
  release.
